import { S3Client, PutObjectCommand, GetObjectCommand, HeadObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

export const s3 = new S3Client({
  endpoint: process.env.S3_ENDPOINT,
  region: "us-east-1", // required by SDK, unused by MinIO
  forcePathStyle: true, // required for MinIO / self-hosted S3
  credentials: {
    accessKeyId: process.env.S3_ACCESS_KEY!,
    secretAccessKey: process.env.S3_SECRET_KEY!,
  },
});

export const BUCKET = process.env.S3_BUCKET || "vault-media";

/** Presigned PUT URL — client uploads the raw object directly to storage. */
export async function presignUpload(objectKey: string, contentType: string, expiresInSec = 900) {
  const cmd = new PutObjectCommand({
    Bucket: BUCKET,
    Key: objectKey,
    ContentType: contentType,
  });
  return getSignedUrl(s3, cmd, { expiresIn: expiresInSec });
}

/** Presigned GET URL — used for private downloads / video segment access. */
export async function presignDownload(objectKey: string, expiresInSec = 3600) {
  const cmd = new GetObjectCommand({ Bucket: BUCKET, Key: objectKey });
  return getSignedUrl(s3, cmd, { expiresIn: expiresInSec });
}

/** Confirms an object actually landed in storage before marking a File UPLOADED. */
export async function objectExists(objectKey: string): Promise<{ exists: boolean; size?: number }> {
  try {
    const head = await s3.send(new HeadObjectCommand({ Bucket: BUCKET, Key: objectKey }));
    return { exists: true, size: head.ContentLength };
  } catch {
    return { exists: false };
  }
}
