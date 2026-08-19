import { Router } from "express";
import { prisma } from "../lib/prisma.js";
import { presignDownload } from "../lib/s3.js";
import { requireAuth, type AuthedRequest } from "../middleware/auth.js";

export const downloadRouter = Router();
downloadRouter.use(requireAuth);

downloadRouter.get("/:fileId", async (req: AuthedRequest, res) => {
  const file = await prisma.file.findFirst({
    where: { id: req.params.fileId, ownerId: req.userId },
    include: { metadata: true },
  });
  if (!file) return res.status(404).json({ error: "File not found" });

  const originalUrl = await presignDownload(file.objectKey);
  const thumbnailUrl = file.thumbnailKey ? await presignDownload(file.thumbnailKey) : null;
  // For video, hand back the HLS manifest key path — the player fetches segments
  // through /stream/:fileId/* below rather than one giant presigned URL.
  const hlsManifestUrl = file.hlsManifestKey
    ? `/api/stream/${file.id}/master.m3u8`
    : null;

  res.json({
    id: file.id,
    name: file.originalName,
    kind: file.kind,
    status: file.status,
    originalUrl,
    thumbnailUrl,
    hlsManifestUrl,
    metadata: file.metadata,
  });
});

/**
 * Streams individual HLS manifest/segment files. Kept server-side (rather than
 * one giant presigned URL) so we can enforce auth per-segment and support
 * short-lived, per-request signing without leaking a long-lived link.
 */
downloadRouter.get("/:fileId/stream/:segment", async (req: AuthedRequest, res) => {
  const file = await prisma.file.findFirst({
    where: { id: req.params.fileId, ownerId: req.userId },
  });
  if (!file || !file.hlsManifestKey) return res.status(404).end();

  const basePath = file.hlsManifestKey.replace(/master\.m3u8$/, "");
  const segmentUrl = await presignDownload(`${basePath}${req.params.segment}`, 300);
  res.redirect(302, segmentUrl);
});
