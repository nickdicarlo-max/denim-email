import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const ALGORITHM = "aes-256-gcm";

function getEncryptionKey(): Buffer {
  const key = process.env.TOKEN_ENCRYPTION_KEY;
  if (!key) {
    throw new Error("TOKEN_ENCRYPTION_KEY not set");
  }
  return Buffer.from(key, "hex");
}

export function encryptTokens(tokens: Record<string, unknown>): string {
  const key = getEncryptionKey();
  const iv = randomBytes(16);
  const cipher = createCipheriv(ALGORITHM, key, iv);

  const plaintext = JSON.stringify(tokens);
  let encrypted = cipher.update(plaintext, "utf8", "hex");
  encrypted += cipher.final("hex");
  const authTag = cipher.getAuthTag().toString("hex");

  return `${iv.toString("hex")}:${authTag}:${encrypted}`;
}

export function decryptTokens(encrypted: string): Record<string, unknown> {
  const key = getEncryptionKey();
  const [ivHex, authTagHex, data] = encrypted.split(":");

  const iv = Buffer.from(ivHex, "hex");
  const authTag = Buffer.from(authTagHex, "hex");
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);

  let decrypted = decipher.update(data, "hex", "utf8");
  decrypted += decipher.final("utf8");
  return JSON.parse(decrypted);
}
