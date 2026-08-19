import nodemailer from "nodemailer";

// Reuses your existing baalebo.xyz Private Email mailbox (e.g. noreply@baalebo.xyz)
// rather than standing up a separate transactional email provider.
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST, // mail.privateemail.com
  port: Number(process.env.SMTP_PORT ?? 587),
  secure: Number(process.env.SMTP_PORT ?? 587) === 465, // true for 465, false for 587 (STARTTLS)
  auth: {
    user: process.env.SMTP_USER, // e.g. noreply@baalebo.xyz
    pass: process.env.SMTP_PASS,
  },
});

const FROM = process.env.EMAIL_FROM ?? "Media Vault <noreply@baalebo.xyz>";
const FRONTEND_URL = process.env.FRONTEND_URL ?? "http://localhost:3000";

export async function sendVerificationEmail(to: string, token: string) {
  const link = `${FRONTEND_URL}/verify-email?token=${token}`;
  await transporter.sendMail({
    from: FROM,
    to,
    subject: "Verify your Media Vault account",
    text: `Verify your email by visiting: ${link}\n\nThis link expires in 24 hours.`,
    html: `<p>Welcome to Media Vault.</p><p><a href="${link}">Click here to verify your email</a></p><p>This link expires in 24 hours.</p>`,
  });
}

export async function sendPasswordResetEmail(to: string, token: string) {
  const link = `${FRONTEND_URL}/reset-password?token=${token}`;
  await transporter.sendMail({
    from: FROM,
    to,
    subject: "Reset your Media Vault password",
    text: `Reset your password by visiting: ${link}\n\nThis link expires in 1 hour. If you didn't request this, ignore this email.`,
    html: `<p><a href="${link}">Click here to reset your password</a></p><p>This link expires in 1 hour. If you didn't request this, ignore this email.</p>`,
  });
}
