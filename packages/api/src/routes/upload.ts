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
  mimeType: z.string().min(1),
  sizeBytes: z.number().int().positive(),
  folderId: z.string().uuid().optional(),
});

function kindFromMime(mime: string): "IMAGE" | "VIDEO" | "DOCUMENT" | "OTHER" {
  if (mime.startsWith("image/")) return "IMAGE";
  if (mime.startsWith("video/")) return "VIDEO";
  if (mime === "application/pdf" || mime.startsWith("text/")) return "DOCUMENT";
  return "OTHER";
}

/**
 * Step 1: client asks for a place to upload.
 * Server creates a PENDING File row + returns a presigned PUT URL.
 * The actual bytes never touch this API process.
 */
uploadRouter.post("/initiate", async (req: AuthedRequest, res) => {
  const parsed = initiateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const { originalName, mimeType, sizeBytes, folderId } = parsed.data;
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
});

/**
 * Step 2: client confirms the PUT succeeded.
 * Server verifies the object actually exists (never trust the client),
 * flips status to UPLOADED, and enqueues async processing.
 */
uploadRouter.post("/:fileId/confirm", async (req: AuthedRequest, res) => {
  const file = await prisma.file.findFirst({
    where: { id: req.params.fileId, ownerId: req.userId },
  });
  if (!file) return res.status(404).json({ error: "File not found" });

  const { exists, size } = await objectExists(file.objectKey);
  if (!exists) {
    return res.status(409).json({ error: "Object not found in storage yet" });
  }

  await prisma.file.update({
    where: { id: file.id },
    data: { status: "UPLOADED", sizeBytes: size ?? file.sizeBytes },
  });

  // Only image/video need the async pipeline; documents go straight to READY.
  if (file.kind === "IMAGE" || file.kind === "VIDEO") {
    await mediaQueue.add("process-media", { fileId: file.id, kind: file.kind });
    await prisma.file.update({ where: { id: file.id }, data: { status: "PROCESSING" } });
  } else {
    await prisma.file.update({ where: { id: file.id }, data: { status: "READY" } });
  }

  res.json({ status: "ok" });
});
