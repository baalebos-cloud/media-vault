import { Worker } from "bullmq";
import { mkdtempSync, createWriteStream, readFileSync, readdirSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import ffmpeg from "fluent-ffmpeg";
import sharp from "sharp";
import { GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { s3, BUCKET } from "../lib/s3.js";
import { prisma } from "../lib/prisma.js";
import { connection, type MediaJobData } from "./queue.js";

async function downloadToTmp(objectKey: string): Promise<string> {
  const dir = mkdtempSync(path.join(tmpdir(), "vault-"));
  const localPath = path.join(dir, path.basename(objectKey));
  const obj = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: objectKey }));
  await new Promise<void>((resolve, reject) => {
    const ws = createWriteStream(localPath);
    // @ts-expect-error - Body is a Node readable stream at runtime
    obj.Body.pipe(ws).on("finish", resolve).on("error", reject);
  });
  return localPath;
}

async function uploadBuffer(objectKey: string, body: Buffer | Uint8Array, contentType: string) {
  await s3.send(new PutObjectCommand({ Bucket: BUCKET, Key: objectKey, Body: body, ContentType: contentType }));
}

async function processImage(fileId: string, objectKey: string) {
  const localPath = await downloadToTmp(objectKey);
  const img = sharp(localPath);
  const meta = await img.metadata();

  const thumbBuffer = await sharp(localPath)
    .resize(640, 640, { fit: "inside" })
    .jpeg({ quality: 82 })
    .toBuffer();

  const thumbnailKey = objectKey.replace("raw/", "derived/").replace(/\.\w+$/, "-thumb.jpg");
  await uploadBuffer(thumbnailKey, thumbBuffer, "image/jpeg");

  await prisma.file.update({
    where: { id: fileId },
    data: { status: "READY", thumbnailKey },
  });

  await prisma.fileMetadata.upsert({
    where: { fileId },
    create: {
      fileId,
      width: meta.width,
      height: meta.height,
      cameraMake: meta.exif ? undefined : undefined, // extend with exif-parser if deeper EXIF needed
      raw: { format: meta.format, space: meta.space, hasAlpha: meta.hasAlpha },
    },
    update: { width: meta.width, height: meta.height },
  });
}

async function processVideo(fileId: string, objectKey: string) {
  const localPath = await downloadToTmp(objectKey);
  const outDir = path.join(path.dirname(localPath), "hls");

  await new Promise<void>((resolve, reject) => {
    ffmpeg(localPath)
      .outputOptions([
        "-preset veryfast",
        "-g 48",
        "-sc_threshold 0",
        "-map 0:v:0 -map 0:a:0 -map 0:v:0 -map 0:a:0 -map 0:v:0 -map 0:a:0",
        "-s:v:0 640x360 -b:v:0 800k",
        "-s:v:1 1280x720 -b:v:1 2800k",
        "-s:v:2 1920x1080 -b:v:2 5000k",
        "-var_stream_map", "v:0,a:0 v:1,a:1 v:2,a:2",
        "-master_pl_name", "master.m3u8",
        "-f hls",
        "-hls_time 6",
        "-hls_playlist_type vod",
        "-hls_segment_filename", `${outDir}/v%v/seg_%03d.ts`,
      ])
      .output(`${outDir}/v%v/playlist.m3u8`)
      .on("end", () => resolve())
      .on("error", reject)
      .run();
  });

  // Also grab a poster frame as the thumbnail
  const thumbLocal = path.join(outDir, "poster.jpg");
  await new Promise<void>((resolve, reject) => {
    ffmpeg(localPath)
      .screenshots({ timestamps: ["10%"], filename: "poster.jpg", folder: outDir, size: "640x?" })
      .on("end", () => resolve())
      .on("error", reject);
  });

  const baseKey = objectKey.replace("raw/", "derived/").replace(/\.\w+$/, "") + "/";
  const walk = (dir: string, prefix = ""): { local: string; key: string }[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
      entry.isDirectory()
        ? walk(path.join(dir, entry.name), `${prefix}${entry.name}/`)
        : [{ local: path.join(dir, entry.name), key: `${baseKey}${prefix}${entry.name}` }]
    );

  for (const { local, key } of walk(outDir)) {
    const contentType = key.endsWith(".m3u8")
      ? "application/vnd.apple.mpegurl"
      : key.endsWith(".ts")
      ? "video/mp2t"
      : "image/jpeg";
    await uploadBuffer(key, readFileSync(local), contentType);
  }

  const probe = await new Promise<any>((resolve, reject) =>
    ffmpeg.ffprobe(localPath, (err, data) => (err ? reject(err) : resolve(data)))
  );
  const videoStream = probe.streams.find((s: any) => s.codec_type === "video");

  await prisma.file.update({
    where: { id: fileId },
    data: {
      status: "READY",
      thumbnailKey: `${baseKey}poster.jpg`,
      hlsManifestKey: `${baseKey}master.m3u8`,
    },
  });

  await prisma.fileMetadata.upsert({
    where: { fileId },
    create: {
      fileId,
      width: videoStream?.width,
      height: videoStream?.height,
      durationSec: parseFloat(probe.format.duration ?? "0"),
      videoCodec: videoStream?.codec_name,
      videoBitrate: parseInt(probe.format.bit_rate ?? "0", 10),
      raw: probe.format,
    },
    update: {
      width: videoStream?.width,
      height: videoStream?.height,
      durationSec: parseFloat(probe.format.duration ?? "0"),
    },
  });
}

export const mediaWorker = new Worker<MediaJobData>(
  "media-processing",
  async (job) => {
    const { fileId, kind } = job.data;
    const file = await prisma.file.findUniqueOrThrow({ where: { id: fileId } });

    try {
      if (kind === "IMAGE") await processImage(fileId, file.objectKey);
      else await processVideo(fileId, file.objectKey);
    } catch (err) {
      await prisma.file.update({ where: { id: fileId }, data: { status: "FAILED" } });
      throw err;
    }
  },
  { connection, concurrency: 2 }
);

mediaWorker.on("failed", (job, err) => {
  console.error(`Media job ${job?.id} failed:`, err);
});

console.log("Media worker listening for jobs...");
