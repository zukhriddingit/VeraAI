import { StaticCredentialKeyProvider, type CredentialKeyProvider } from "@vera/db";
import { z } from "zod";

const KeyIdSchema = z.string().regex(/^[a-zA-Z0-9._:-]{1,100}$/u);
const PublicKeySchema = z
  .string()
  .trim()
  .min(40)
  .max(512)
  .regex(/^[A-Za-z0-9_-]+$/u);

export interface NotificationEnvironment {
  readonly publicVapidKey: string;
  readonly credentialKeyProvider: CredentialKeyProvider;
}

export function parseNotificationEnvironment(
  environment: Readonly<Record<string, string | undefined>> = process.env
): NotificationEnvironment | null {
  const publicKey = environment.NEXT_PUBLIC_VERA_VAPID_PUBLIC_KEY?.trim();
  if (!publicKey) return null;
  const keyId = KeyIdSchema.parse(environment.VERA_CREDENTIAL_KEY_ID);
  const encoded = environment.VERA_CREDENTIAL_KEYS_JSON?.trim();
  if (!encoded) throw new Error("Credential encryption keys are required for Web Push.");
  const parsed = z.record(KeyIdSchema, z.string().min(4)).parse(JSON.parse(encoded) as unknown);
  const keys = new Map<string, Uint8Array>();
  for (const [candidateId, value] of Object.entries(parsed)) {
    const key = Buffer.from(value, "base64");
    if (key.byteLength !== 32) throw new Error("Credential keys must contain exactly 32 bytes.");
    keys.set(candidateId, key);
  }
  return {
    publicVapidKey: PublicKeySchema.parse(publicKey),
    credentialKeyProvider: new StaticCredentialKeyProvider(keyId, keys)
  };
}
