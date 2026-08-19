import { Router } from "express";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { randomBytes } from "crypto";
import { prisma } from "../lib/prisma.js";
import { issueToken } from "../lib/jwt.js";
import { sendVerificationEmail, sendPasswordResetEmail } from "../lib/mailer.js";
import { requireAuth, type AuthedRequest } from "../middleware/auth.js";

export const authRouter = Router();

const credentialsSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8).max(128),
});

function newToken() {
  return randomBytes(32).toString("hex");
}

authRouter.post("/register", async (req, res) => {
  const parsed = credentialsSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const { email, password } = parsed.data;

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) return res.status(409).json({ error: "Email already registered" });

  const passwordHash = await bcrypt.hash(password, 12);
  const verificationToken = newToken();

  const user = await prisma.user.create({
    data: {
      email,
      passwordHash,
      role: "MEMBER",
      verificationToken,
      verificationExpires: new Date(Date.now() + 24 * 60 * 60 * 1000), // 24h
    },
  });

  // Registration succeeds and issues a usable session token even before the
  // email is verified — verification is tracked separately (emailVerified)
  // rather than gating login, so a slow/lost email doesn't lock someone out.
  // Flip this to block login until verified if you'd rather enforce it.
  try {
    await sendVerificationEmail(email, verificationToken);
  } catch (err) {
    console.error("Failed to send verification email:", err);
    // Don't fail registration just because the email send failed — the user
    // can still request a resend later.
  }

  res.status(201).json({ token: issueToken(user.id), userId: user.id, emailVerified: false });
});

authRouter.get("/verify-email", async (req, res) => {
  const token = typeof req.query.token === "string" ? req.query.token : undefined;
  if (!token) return res.status(400).json({ error: "Missing token" });

  const user = await prisma.user.findUnique({ where: { verificationToken: token } });
  if (!user || !user.verificationExpires || user.verificationExpires < new Date()) {
    return res.status(400).json({ error: "Invalid or expired verification link" });
  }

  await prisma.user.update({
    where: { id: user.id },
    data: { emailVerified: true, verificationToken: null, verificationExpires: null },
  });

  res.json({ status: "verified" });
});

authRouter.post("/resend-verification", requireAuth, async (req: AuthedRequest, res) => {
  const user = await prisma.user.findUnique({ where: { id: req.userId } });
  if (!user) return res.status(404).json({ error: "User not found" });
  if (user.emailVerified) return res.status(400).json({ error: "Email already verified" });

  const verificationToken = newToken();
  await prisma.user.update({
    where: { id: user.id },
    data: { verificationToken, verificationExpires: new Date(Date.now() + 24 * 60 * 60 * 1000) },
  });

  // Wrapped like /register and /forgot-password below — an SMTP failure here
  // must not crash the process. Previously unwrapped, this took down the
  // whole api container on every SMTP auth failure.
  try {
    await sendVerificationEmail(user.email, verificationToken);
    res.json({ status: "sent" });
  } catch (err) {
    console.error("Failed to resend verification email:", err);
    res.status(502).json({ error: "Failed to send verification email" });
  }
});

authRouter.post("/login", async (req, res) => {
  const parsed = credentialsSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const { email, password } = parsed.data;

  const user = await prisma.user.findUnique({ where: { email } });
  // Same generic error whether the email is unknown or the password is wrong,
  // so login responses don't leak which accounts exist.
  if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
    return res.status(401).json({ error: "Invalid email or password" });
  }

  res.json({ token: issueToken(user.id), userId: user.id, emailVerified: user.emailVerified });
});

authRouter.get("/me", requireAuth, async (req: AuthedRequest, res) => {
  const user = await prisma.user.findUnique({
    where: { id: req.userId },
    select: { id: true, email: true, role: true, emailVerified: true, createdAt: true },
  });
  if (!user) return res.status(404).json({ error: "User not found" });
  res.json(user);
});

// --- Password reset ---

const emailSchema = z.object({ email: z.string().email() });

authRouter.post("/forgot-password", async (req, res) => {
  const parsed = emailSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const user = await prisma.user.findUnique({ where: { email: parsed.data.email } });

  // Always return 200 regardless of whether the email matched a user — a
  // different response here would let an attacker enumerate registered
  // emails by checking which addresses return "not found".
  if (user) {
    const resetToken = newToken();
    await prisma.user.update({
      where: { id: user.id },
      data: { resetToken, resetTokenExpires: new Date(Date.now() + 60 * 60 * 1000) }, // 1h
    });
    try {
      await sendPasswordResetEmail(user.email, resetToken);
    } catch (err) {
      console.error("Failed to send password reset email:", err);
    }
  }

  res.json({ status: "ok" });
});

const resetPasswordSchema = z.object({
  token: z.string().min(1),
  password: z.string().min(8).max(128),
});

authRouter.post("/reset-password", async (req, res) => {
  const parsed = resetPasswordSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const { token, password } = parsed.data;

  const user = await prisma.user.findUnique({ where: { resetToken: token } });
  if (!user || !user.resetTokenExpires || user.resetTokenExpires < new Date()) {
    return res.status(400).json({ error: "Invalid or expired reset link" });
  }

  const passwordHash = await bcrypt.hash(password, 12);
  await prisma.user.update({
    where: { id: user.id },
    data: { passwordHash, resetToken: null, resetTokenExpires: null },
  });

  res.json({ status: "reset" });
});
