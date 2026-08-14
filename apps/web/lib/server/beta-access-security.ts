import { createHmac } from "node:crypto";

import type { BetaAccessRepository } from "@vera/db";

import { assertSameOriginMutation } from "./request-security.ts";

export class BetaRateLimitError extends Error {
  readonly status = 429;

  constructor() {
    super("rate_limited");
    this.name = "BetaRateLimitError";
  }
}

export function betaRateLimitDigest(
  value: string,
  environment: Readonly<Record<string, string | undefined>>
): string {
  const key = environment.VERA_BETA_RATE_LIMIT_KEY?.trim();
  if (!key || key.length < 32) {
    throw new Error("VERA_BETA_RATE_LIMIT_KEY must contain at least 32 characters.");
  }
  return createHmac("sha256", key).update(value, "utf8").digest("hex");
}

function trustedClientNetwork(
  request: Request,
  environment: Readonly<Record<string, string | undefined>>
): string {
  const requestUrl = new URL(request.url);
  if (requestUrl.hostname === "127.0.0.1" || requestUrl.hostname === "localhost") {
    return "loopback-development";
  }
  if (environment.NODE_ENV !== "production" || environment.VERA_TRUST_HEROKU_ROUTER !== "1") {
    throw new Error("Trusted production router configuration is required for beta intake.");
  }
  const value = request.headers.get("x-forwarded-for")?.split(",").at(-1)?.trim();
  if (!value || value.length > 64 || !/^[0-9a-f:.]+$/iu.test(value)) {
    throw new Error("Trusted client network is unavailable.");
  }
  return value;
}

export async function requirePublicBetaSubmissionBoundary(
  request: Request,
  repository: BetaAccessRepository,
  environment: Readonly<Record<string, string | undefined>> = process.env
): Promise<void> {
  assertSameOriginMutation(request);
  const allowed = await repository.consumeRateLimit({
    keyDigest: betaRateLimitDigest(trustedClientNetwork(request, environment), environment),
    now: new Date(),
    windowSeconds: 600,
    maximum: 5
  });
  if (!allowed) throw new BetaRateLimitError();
}
