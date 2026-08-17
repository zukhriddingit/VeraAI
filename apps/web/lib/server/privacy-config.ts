export interface PrivacyEnvironment {
  readonly subjectHmacKey: string;
  readonly backupRetentionDays: number;
}

export function parsePrivacyEnvironment(
  environment: Readonly<Record<string, string | undefined>>
): PrivacyEnvironment {
  const subjectHmacKey = environment.VERA_PRIVACY_SUBJECT_HMAC_KEY?.trim() ?? "";
  if (subjectHmacKey.length < 32) {
    throw new Error("VERA_PRIVACY_SUBJECT_HMAC_KEY must contain at least 32 characters.");
  }
  const retentionInput = environment.VERA_PRIVACY_BACKUP_RETENTION_DAYS ?? "";
  const backupRetentionDays = /^\d{1,3}$/u.test(retentionInput)
    ? Number.parseInt(retentionInput, 10)
    : Number.NaN;
  if (
    !Number.isSafeInteger(backupRetentionDays) ||
    backupRetentionDays < 1 ||
    backupRetentionDays > 365
  ) {
    throw new Error("VERA_PRIVACY_BACKUP_RETENTION_DAYS must be an integer from 1 through 365.");
  }
  return { subjectHmacKey, backupRetentionDays };
}
