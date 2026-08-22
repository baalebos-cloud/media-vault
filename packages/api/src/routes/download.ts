import { Router } from "express";
import { prisma } from "../lib/prisma.js";
import { presignDownload } from "../lib/s3.js";
import { requireAuth, type AuthedRequest } from "../middleware/auth.js";

export const downloadRouter = Router();
downloadRouter.use(requireAuth);

// Registered BEFORE /:fileId — Express matches routes in registration
// order, and if this sat below the param route, "/by-key/<key>" would be
// swallowed by "/:fileId" (treating the literal "by-key" as a file ID),
// silently 404ing forever instead of resolving correctly.
downloadRouter.get("/by-key/:objectKey", async (req: AuthedRequest, res) => {
  const file = await prisma.file.findFirst({
    where: { objectKey: req.params.objectKey, ownerId: req.userId },
  });
  if (!file) return res.status(404).json({ error: "File not found" });
  res.json({ id: file.id, status: file.status });
});

downloadRouter.get("/:fileId", async (req: AuthedRequest, res) => {
  const file = await prisma.file.findFirst({
    where: { id: req.params.fileId, ownerId: req.userId },
    include: { metadata: true },
  });
  if (!file) return res.status(404).json({ error: "File not found" });

  const originalUrl = await presignDownload(file.objectKey);
  const thumbnailUrl = file.thumbnailKey ? await presignDownload(file.thumbnailKey) : null;
  const hlsManifestUrl = file.hlsManifestKey ? `/api/stream/${file.id}/master.m3u8` : null;

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

downloadRouter.get("/:fileId/stream/:segment", async (req: AuthedRequest, res) => {
  const file = await prisma.file.findFirst({
    where: { id: req.params.fileId, ownerId: req.userId },
  });
  if (!file || !file.hlsManifestKey) return res.status(404).end();

  const basePath = file.hlsManifestKey.replace(/master\.m3u8$/, "");
  const segmentUrl = await presignDownload(`${basePath}${req.params.segment}`, 300);
  res.redirect(302, segmentUrl);
});