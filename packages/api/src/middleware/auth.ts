import type { Request, Response, NextFunction } from "express";
import { verifyBearer } from "../lib/jwt.js";

export interface AuthedRequest extends Request {
  userId?: string;
}

export function requireAuth(req: AuthedRequest, res: Response, next: NextFunction) {
  try {
    req.userId = verifyBearer(req.headers.authorization);
    next();
  } catch {
    return res.status(401).json({ error: "Invalid or expired token" });
  }
}
