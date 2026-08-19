import { Queue } from "bullmq";
import { Redis } from "ioredis";

export const connection = new Redis(process.env.REDIS_URL!, {
  maxRetriesPerRequest: null,
});

export interface MediaJobData {
  fileId: string;
  kind: "IMAGE" | "VIDEO";
}

export const mediaQueue = new Queue<MediaJobData>("media-processing", { connection });
