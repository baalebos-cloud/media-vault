import { Server } from "@tus/server";
import { S3Store } from "@tus/s3-store";
import { prisma } from "../lib/prisma.js";
import { verifyBearer } from "../lib/jwt.js";
import { mediaQueue } from "../worker/queue.js";
import { BUCKET } from "../lib/s3.js";

function kindFromMime(mime: string): "IMAGE" | "VIDEO" | "DOCUMENT" | "OTHER" {
  if (mime.startsWith("image/")) return "IMAGE";
  if (mime.startsWith("video/")) return "VIDEO";
  if (mime === "application/pdf" || mime.startsWith("text/")) return "DOCUMENT";
  return "OTHER";
}

const datastore = new S3Store({
  partSize: 8 * 1024 * 1024,
  s3ClientConfig: {
    bucket: BUCKET,
    endpoint: process.env.S3_ENDPOINT,
    region: "us-east-1",
    forcePathStyle: true,
    credentials: {
      accessKeyId: process.env.S3_ACCESS_KEY!,
      secretAccessKey: process.env.S3_SECRET_KEY!,
    },
  },
});

export const tusServer = new Server({
  path: "/api/tus",
  datastore,
  respectForwardedHeaders: true,
  onUploadCreate: async (req, res, upload) => {
    let userId: string;
    try {
      userId = verifyBearer(req.headers.authorization);
    } catch {
      throw { status_code: 401, body: "Invalid or missing bearer token" };
    }

    const meta = upload.metadata ?? {};
    const originalName = meta.filename ?? "untitled";
    const mimeType = meta.filetype ?? "application/octet-stream";
    const folderId = meta.folderId;

    // IMPORTANT: do not override upload.id with a custom multi-segment path
    // (e.g. "raw/<userId>/<uuid>-name"). @tus/server builds the Location
    // header from this ID and later re-derives the same ID from each PATCH
    // request's URL to look the upload back up in the store — a slash-
    // containing ID breaks that round-trip, so every chunk PATCH 404s even
    // though creation succeeds. Let tus assign its own flat, opaque ID and
    // use that directly as the S3 object key.
    const objectKey = upload.id;

    await prisma.file.create({
      data: {
        ownerId: userId,
        folderId: folderId || undefined,
        bucket: BUCKET,
        objectKey,
        originalName,
        mimeType,
        kind: kindFromMime(mimeType),
        sizeBytes: upload.size ?? 0,
        status: "PENDING",
      },
    });

    return { res, metadata: { ...meta, userId, objectKey } };
  },
  onUploadFinish: async (req, res, upload) => {
    const objectKey = upload.metadata?.objectKey as string;

    const file = await prisma.file.update({
      where: { objectKey },
      data: { status: "UPLOADED", sizeBytes: upload.size ?? 0 },
    });

    if (file.kind === "IMAGE" || file.kind === "VIDEO") {
      await mediaQueue.add("process-media", { fileId: file.id, kind: file.kind });
      await prisma.file.update({ where: { id: file.id }, data: { status: "PROCESSING" } });
    } else {
      await prisma.file.update({ where: { id: file.id }, data: { status: "READY" } });
    }

    return { res };
  },
});