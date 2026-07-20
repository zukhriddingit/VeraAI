export type NormalizedPhone =
  | { readonly status: "known"; readonly e164: string; readonly extension: string | null }
  | {
      readonly status: "unknown";
      readonly reason: "empty" | "invalid" | "ambiguous_extension" | "unsupported_country";
    };

export type NormalizedEmail =
  | { readonly status: "known"; readonly email: string }
  | { readonly status: "unknown"; readonly reason: "empty" | "invalid" };

export function normalizeUsPhone(input: string): NormalizedPhone {
  const trimmed = input.normalize("NFKC").trim();
  if (trimmed.length === 0) return { status: "unknown", reason: "empty" };

  const markers = [...trimmed.matchAll(/(?:^|\s)(?:ext(?:ension)?\.?|x)(?=\s|\.|\d)/giu)];
  if (markers.length > 1) return { status: "unknown", reason: "ambiguous_extension" };

  const extensionMatch = /(?:^|\s)(?:ext(?:ension)?\.?|x)\s*[:.#-]?\s*(\d{1,8})\s*$/iu.exec(
    trimmed
  );
  if (markers.length === 1 && extensionMatch === null) {
    return { status: "unknown", reason: "ambiguous_extension" };
  }

  const phonePart =
    extensionMatch === null ? trimmed : trimmed.slice(0, extensionMatch.index).trim();
  if (/[a-z]/iu.test(phonePart)) return { status: "unknown", reason: "invalid" };
  const digits = phonePart.replace(/\D/gu, "");
  if (digits.length === 10) {
    return {
      status: "known",
      e164: `+1${digits}`,
      extension: extensionMatch?.[1] ?? null
    };
  }
  if (digits.length === 11 && digits.startsWith("1")) {
    return {
      status: "known",
      e164: `+${digits}`,
      extension: extensionMatch?.[1] ?? null
    };
  }
  return {
    status: "unknown",
    reason: phonePart.startsWith("+") ? "unsupported_country" : "invalid"
  };
}

export function normalizeEmail(input: string): NormalizedEmail {
  const email = input.normalize("NFKC").trim().toLowerCase();
  if (email.length === 0) return { status: "unknown", reason: "empty" };
  if (
    email.length > 254 ||
    !/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/u.test(
      email
    )
  ) {
    return { status: "unknown", reason: "invalid" };
  }
  return { status: "known", email };
}
