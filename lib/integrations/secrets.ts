import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

import { getSecretsEncryptionKey } from "@/lib/env";

// AES-256-GCM at rest. Stored format: v1.<iv>.<ciphertext>.<authTag>, base64url.
const VERSION_PREFIX = "v1";

export class SecretsNotConfiguredError extends Error {
  constructor() {
    super(
      "SECRETS_ENCRYPTION_KEY is not configured. Set a base64-encoded 32-byte key.",
    );
    this.name = "SecretsNotConfiguredError";
  }
}

function loadKey(): Buffer {
  const raw = getSecretsEncryptionKey();

  if (!raw) {
    throw new SecretsNotConfiguredError();
  }

  const key = Buffer.from(raw, "base64");

  if (key.length !== 32) {
    throw new SecretsNotConfiguredError();
  }

  return key;
}

export function isSecretsEncryptionConfigured(): boolean {
  const raw = getSecretsEncryptionKey();

  if (!raw) {
    return false;
  }

  return Buffer.from(raw, "base64").length === 32;
}

export function encryptSecret(plaintext: string): string {
  const key = loadKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);

  return [
    VERSION_PREFIX,
    iv.toString("base64url"),
    ciphertext.toString("base64url"),
    cipher.getAuthTag().toString("base64url"),
  ].join(".");
}

export function decryptSecret(stored: string): string {
  const key = loadKey();
  const [version, iv, ciphertext, authTag] = stored.split(".");

  if (version !== VERSION_PREFIX || !iv || !ciphertext || !authTag) {
    throw new Error("Stored secret has an unrecognized format.");
  }

  const decipher = createDecipheriv(
    "aes-256-gcm",
    key,
    Buffer.from(iv, "base64url"),
  );
  decipher.setAuthTag(Buffer.from(authTag, "base64url"));

  return Buffer.concat([
    decipher.update(Buffer.from(ciphertext, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}

export function generateWebhookToken(): string {
  return `whk_${randomBytes(32).toString("base64url")}`;
}

export function secretLastFour(secret: string): string {
  return secret.slice(-4);
}

export function safeEqualSecrets(expected: string, provided: string): boolean {
  const expectedBuffer = Buffer.from(expected, "utf8");
  const providedBuffer = Buffer.from(provided, "utf8");

  if (expectedBuffer.length !== providedBuffer.length) {
    return false;
  }

  return timingSafeEqual(expectedBuffer, providedBuffer);
}
