import jwt, { type SignOptions } from "jsonwebtoken";

export function issueToken(userId: string, expiresIn: SignOptions["expiresIn"] = "7d") {
  return jwt.sign({ sub: userId }, process.env.JWT_SECRET!, { expiresIn });
}

export function verifyBearer(authHeader: string | undefined): string {
  if (!authHeader?.startsWith("Bearer ")) {
    throw new Error("Missing bearer token");
  }
  const payload = jwt.verify(authHeader.slice(7), process.env.JWT_SECRET!) as { sub: string };
  return payload.sub;
}
