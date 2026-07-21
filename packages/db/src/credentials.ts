import {
  createCipheriv,
  createDecipheriv,
  randomBytes as nodeRandomBytes,
  type BinaryLike
} from "node:crypto";

import {
  EncryptedCredentialEnvelopeSchema,
  type EncryptedCredentialEnvelope,
  type IntegrationId,
  type IntegrationProvider,
  type VeraUserId
} from "@vera/domain";

const ALGORITHM = "aes-256-gcm" as const;
const ENVELOPE_VERSION = 1 as const;
const KEY_BYTES = 32;
const NONCE_BYTES = 12;

export interface CredentialContext {
  readonly userId: VeraUserId;
  readonly integrationId: IntegrationId;
  readonly provider: IntegrationProvider;
}

export interface CredentialKey {
  readonly keyId: string;
  readonly key: Uint8Array;
}

export interface CredentialKeyProvider {
  current(): Promise<CredentialKey>;
  byId(keyId: string): Promise<Uint8Array | null>;
}

export class CredentialConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CredentialConfigurationError";
  }
}

export class CredentialDecryptionError extends Error {
  constructor() {
    super("Credential decryption failed; reconnect is required.");
    this.name = "CredentialDecryptionError";
  }
}

function copyAndValidateKey(key: Uint8Array): Uint8Array {
  if (key.byteLength !== KEY_BYTES) {
    throw new CredentialConfigurationError("Credential keys must contain exactly 32 bytes.");
  }

  return Uint8Array.from(key);
}

export class StaticCredentialKeyProvider implements CredentialKeyProvider {
  readonly #currentKeyId: string;
  readonly #keys: ReadonlyMap<string, Uint8Array>;

  constructor(currentKeyId: string, keys: ReadonlyMap<string, Uint8Array>) {
    if (!/^[a-zA-Z0-9._:-]{1,100}$/u.test(currentKeyId)) {
      throw new CredentialConfigurationError("The current credential key ID is invalid.");
    }

    const copied = new Map<string, Uint8Array>();
    for (const [keyId, key] of keys) {
      if (!/^[a-zA-Z0-9._:-]{1,100}$/u.test(keyId)) {
        throw new CredentialConfigurationError("A credential key ID is invalid.");
      }
      copied.set(keyId, copyAndValidateKey(key));
    }

    if (!copied.has(currentKeyId)) {
      throw new CredentialConfigurationError("The current credential key is unavailable.");
    }

    this.#currentKeyId = currentKeyId;
    this.#keys = copied;
  }

  async current(): Promise<CredentialKey> {
    const key = this.#keys.get(this.#currentKeyId);
    if (!key) throw new CredentialConfigurationError("The current credential key is unavailable.");
    return { keyId: this.#currentKeyId, key: Uint8Array.from(key) };
  }

  async byId(keyId: string): Promise<Uint8Array | null> {
    const key = this.#keys.get(keyId);
    return key ? Uint8Array.from(key) : null;
  }
}

function associatedData(context: CredentialContext): Buffer {
  return Buffer.from(
    JSON.stringify({
      version: ENVELOPE_VERSION,
      userId: context.userId,
      integrationId: context.integrationId,
      provider: context.provider
    }),
    "utf8"
  );
}

function asKey(value: Uint8Array): BinaryLike {
  return Buffer.from(copyAndValidateKey(value));
}

export async function encryptCredential(
  plaintext: string,
  context: CredentialContext,
  keyProvider: CredentialKeyProvider,
  dependencies: { readonly randomBytes?: (size: number) => Buffer } = {}
): Promise<EncryptedCredentialEnvelope> {
  if (plaintext.length === 0) {
    throw new CredentialConfigurationError("Credential plaintext cannot be empty.");
  }

  const current = await keyProvider.current();
  const nonce = (dependencies.randomBytes ?? nodeRandomBytes)(NONCE_BYTES);
  if (nonce.byteLength !== NONCE_BYTES) {
    throw new CredentialConfigurationError("Credential nonce generation failed.");
  }

  const plaintextBuffer = Buffer.from(plaintext, "utf8");
  try {
    const cipher = createCipheriv(ALGORITHM, asKey(current.key), nonce, { authTagLength: 16 });
    cipher.setAAD(associatedData(context));
    const ciphertext = Buffer.concat([cipher.update(plaintextBuffer), cipher.final()]);

    return EncryptedCredentialEnvelopeSchema.parse({
      version: ENVELOPE_VERSION,
      algorithm: ALGORITHM,
      keyId: current.keyId,
      nonce: nonce.toString("base64"),
      ciphertext: ciphertext.toString("base64"),
      authenticationTag: cipher.getAuthTag().toString("base64")
    });
  } finally {
    plaintextBuffer.fill(0);
  }
}

export async function decryptCredential(
  envelopeInput: EncryptedCredentialEnvelope,
  context: CredentialContext,
  keyProvider: CredentialKeyProvider
): Promise<string> {
  try {
    const envelope = EncryptedCredentialEnvelopeSchema.parse(envelopeInput);
    const key = await keyProvider.byId(envelope.keyId);
    if (!key) throw new CredentialDecryptionError();

    const decipher = createDecipheriv(
      envelope.algorithm,
      asKey(key),
      Buffer.from(envelope.nonce, "base64"),
      { authTagLength: 16 }
    );
    decipher.setAAD(associatedData(context));
    decipher.setAuthTag(Buffer.from(envelope.authenticationTag, "base64"));
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(envelope.ciphertext, "base64")),
      decipher.final()
    ]);

    try {
      return plaintext.toString("utf8");
    } finally {
      plaintext.fill(0);
    }
  } catch {
    throw new CredentialDecryptionError();
  }
}
