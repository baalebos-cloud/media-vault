import { Router, Request, Response } from "express";
import { PrismaClient } from "@prisma/client";
import * as IORedis from "ioredis";

const Redis = IORedis.default;

const router = Router();
const prisma = new PrismaClient();
const redis = new Redis(process.env.REDIS_URL!);

router.get("/health", async (_req: Request, res: Response) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    await redis.ping();
    res.status(200).json({ status: "ok" });
  } catch (err) {
    res.status(503).json({
      status: "unavailable",
      error: err instanceof Error ? err.message : "unknown",
    });
  }
});

export default router;
