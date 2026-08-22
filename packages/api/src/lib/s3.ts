import { S3Client, PutObjectCommand, GetObjectCommand, HeadObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

const credentials = {
  accessKeyId: process.env.S3_ACCESS_KEY!,
  secretAccessKey: process.env.S3_SECRET_KEY!,
};

// Internal client — server-to-server calls only (HeadObject checks, the
// worker's own reads/writes). Talks to MinIO over the Docker-internal
// service name, which is never reachable from an actual browser.
export const s3 = new S3Client({
  endpoint: process.env.S3_ENDPOINT,
  region: "us-east-1",
  forcePathStyle: true,
  credentials,
});

// Public client — used ONLY to sign URLs that get handed to a browser.
// Must point at a hostname the browser can actually reach (e.g. a public
// Cloudflare Tunnel route to MinIO), never the internal "minio:9000" name —
// otherwise every presigned link times out for anyone outside Docker's
// internal network.
const publicS3 = new S3Client({
  endpoint: process.env.S3_PUBLIC_ENDPOINT,
  region: "us-east-1",
  forcePathStyle: true,
  credentials,
});

export const BUCKET = process.env.S3_BUCKET || "vault-media";

export async function presignUpload(objectKey: string, contentType: string, expiresInSec = 900) {
  const cmd = new PutObjectCommand({ Bucket: BUCKET, Key: objectKey, ContentType: contentType });
  return getSignedUrl(publicS3, cmd, { expiresIn: expiresInSec });
}

export async function presignDownload(objectKey: string, expiresInSec = 3600) {
  const cmd = new GetObjectCommand({ Bucket: BUCKET, Key: objectKey });
  return getSignedUrl(publicS3, cmd, { expiresIn: expiresInSec });
}

export async function objectExists(objectKey: string): Promise<{ exists: boolean; size?: number }> {
  try {
    const head = await s3.send(new HeadObjectCommand({ Bucket: BUCKET, Key: objectKey }));
    return { exists: true, size: head.ContentLength };
  } catch {
    return { exists: false };
  }
}