import { Router } from "express";
import { z } from "zod";
import { randomUUID } from "crypto";
import { prisma } from "../lib/prisma.js";
import { presignUpload, objectExists, BUCKET } from "../lib/s3.js";
import { mediaQueue } from "../worker/queue.js";
import { requireAuth, type AuthedRequest } from "../middleware/auth.js";

export const uploadRouter = Router();
uploadRouter.use(requireAuth);

const initiateSchema = z.object({
  originalName: z.string().min(1).max(512),
  mimeType: z.string().min(1).max(255),
  sizeBytes: z.number().int().positive().max(5_000_000_000_000),
  folderId: z.string().uuid().optional(),
});

function kindFromMime(mime: string): "IMAGE" | "VIDEO" | "DOCUMENT" | "OTHER" {
  if (mime.startsWith("image/")) return "IMAGE";
  if (mime.startsWith("video/")) return "VIDEO";
  if (mime === "application/pdf" || mime.startsWith("text/")) return "DOCUMENT";
  return "OTHER";
}

function sanitizeFilename(name: string): string {
  return name.replace(/[/\\]/g, "_").replace(/[\x00-\x1f]/g, "").slice(0, 512);
}

uploadRouter.post("/initiate", async (req: AuthedRequest, res) => {
  const parsed = initiateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const { mimeType, sizeBytes, folderId } = parsed.data;
  const originalName = sanitizeFilename(parsed.data.originalName);

  try {
    if (folderId) {
      const folder = await prisma.folder.findFirst({
        where: { id: folderId, ownerId: req.userId },
      });
      if (!folder) {
        return res.status(403).json({ error: "Folder not found or not owned by this user" });
      }
    }

    const objectKey = `raw/${req.userId}/${randomUUID()}-${originalName}`;

    const file = await prisma.file.create({
      data: {
        ownerId: req.userId!,
        folderId,
        bucket: BUCKET,
        objectKey,
        originalName,
        mimeType,
        kind: kindFromMime(mimeType),
        sizeBytes,
        status: "PENDING",
      },
    });

    const uploadUrl = await presignUpload(objectKey, mimeType);

    res.status(201).json({ fileId: file.id, uploadUrl, objectKey, expiresInSec: 900 });
  } catch (err) {
    console.error("upload/initiate failed:", err);
    res.status(500).json({ error: "Failed to initiate upload" });
  }
});

uploadRouter.post("/:fileId/confirm", async (req: AuthedRequest, res) => {
  try {
    const file = await prisma.file.findFirst({
      where: { id: req.params.fileId, ownerId: req.userId },
    });
    if (!file) return res.status(404).json({ error: "File not found" });

    const { exists, size } = await objectExists(file.objectKey);
    if (!exists) {
      return res.status(409).json({ error: "Object not found in storage yet" });
    }

    // Checked directly here (not via a separate boolean) so TypeScript can
    // narrow file.kind to "IMAGE" | "VIDEO" at the mediaQueue.add call below —
    // narrowing through an indirect boolean doesn't propagate to later reads.
    if (file.kind === "IMAGE" || file.kind === "VIDEO") {
      await prisma.file.update({
        where: { id: file.id },
        data: { sizeBytes: size ?? file.sizeBytes, status: "PROCESSING" },
      });
      await mediaQueue.add("process-media", { fileId: file.id, kind: file.kind });
    } else {
      await prisma.file.update({
        where: { id: file.id },
        data: { sizeBytes: size ?? file.sizeBytes, status: "READY" },
      });
    }

    res.json({ status: "ok" });
  } catch (err) {
    console.error("upload/confirm failed:", err);
    res.status(500).json({ error: "Failed to confirm upload" });
  }
});