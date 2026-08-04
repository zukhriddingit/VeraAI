import { timingSafeEqual } from "node:crypto";

import {
  BrowserResearchCheckpointRequestSchema,
  VeraUserIdSchema,
  ZillowResearchCheckpointRequestSchema
} from "@vera/domain";

import {
  checkBrowserResearchAction,
  createBrowserResearchCheckpointDependencies
} from "../../../../../lib/browser-research-checkpoint-service.ts";

import {
  checkZillowResearchAction,
  createZillowResearchCheckpointDependencies
} from "../../../../../lib/zillow-research-checkpoint-service.ts";
import { getHostedApplication } from "../../../../../lib/server/application.ts";
import {
  CrossOriginMutationError,
  MutationRequestError,
  readBoundedJson
} from "../../../../../lib/server/request-security.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const headers = {
  "Cache-Control": "no-store, max-age=0",
  "Content-Type": "application/json"
};

export function validCheckpointBearer(
  authorization: string | null,
  expectedToken: string
): boolean {
  if (!authorization?.startsWith("Bearer ")) return false;
  const suppliedToken = authorization.slice("Bearer ".length);
  const supplied = Buffer.from(suppliedToken, "utf8");
  const expected = Buffer.from(expectedToken, "utf8");
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}

export class CheckpointAuthorizationError extends Error {
  constructor() {
    super("The browser research checkpoint credential is invalid.");
    this.name = "CheckpointAuthorizationError";
  }
}

export function requireCheckpointBearer(authorization: string | null, expectedToken: string): void {
  if (!validCheckpointBearer(authorization, expectedToken)) {
    throw new CheckpointAuthorizationError();
  }
}

function configuredCheckpointOrigin(
  request: Request,
  environment: Readonly<Record<string, string | undefined>>
): string {
  const configured = environment.VERA_BROWSER_RESEARCH_CHECKPOINT_ORIGIN?.trim();
  if (!configured) {
    if (environment.NODE_ENV === "production") throw new CrossOriginMutationError();
    return new URL(request.url).origin;
  }
  const parsed = new URL(configured);
  if (
    parsed.origin !== configured ||
    parsed.protocol !== "https:" ||
    parsed.pathname !== "/" ||
    parsed.search ||
    parsed.hash ||
    parsed.username ||
    parsed.password
  ) {
    throw new CrossOriginMutationError();
  }
  return parsed.origin;
}

export function assertCheckpointRequestOrigin(
  request: Request,
  environment: Readonly<Record<string, string | undefined>> = process.env
): void {
  const supplied = request.headers.get("origin");
  if (supplied === null) throw new CrossOriginMutationError();
  try {
    const expectedOrigin = configuredCheckpointOrigin(request, environment);
    const suppliedUrl = new URL(supplied);
    if (
      suppliedUrl.origin !== supplied ||
      suppliedUrl.pathname !== "/" ||
      suppliedUrl.search ||
      suppliedUrl.hash ||
      suppliedUrl.username ||
      suppliedUrl.password ||
      suppliedUrl.origin !== expectedOrigin
    ) {
      throw new CrossOriginMutationError();
    }
  } catch (error) {
    if (error instanceof CrossOriginMutationError) throw error;
    throw new CrossOriginMutationError();
  }
}

function failure(code: string, status: number): Response {
  return Response.json(
    { code, message: "Browser research authorization stopped safely." },
    { status, headers }
  );
}

export async function POST(request: Request): Promise<Response> {
  try {
    const token = process.env.VERA_BROWSER_RESEARCH_CHECKPOINT_TOKEN?.trim() ?? "";
    if (token.length < 32) return failure("checkpoint_not_configured", 503);
    requireCheckpointBearer(request.headers.get("authorization"), token);
    assertCheckpointRequestOrigin(request, process.env);
    const founder = VeraUserIdSchema.safeParse(
      process.env.VERA_BROWSER_GATEWAY_FOUNDER_USER_ID?.trim()
    );
    if (!founder.success) return failure("founder_not_configured", 503);

    const rawInput = await readBoundedJson(request, { maxBytes: 16_000 });
    const repositories = getHostedApplication().repositoryProvider.forUser(founder.data);
    const genericInput = BrowserResearchCheckpointRequestSchema.safeParse(rawInput);
    const result = genericInput.success
      ? await checkBrowserResearchAction(
          createBrowserResearchCheckpointDependencies(founder.data, repositories, process.env),
          genericInput.data
        )
      : await checkZillowResearchAction(
          createZillowResearchCheckpointDependencies(founder.data, repositories, process.env),
          ZillowResearchCheckpointRequestSchema.parse(rawInput)
        );
    return Response.json(result, { status: 200, headers });
  } catch (error) {
    if (
      error instanceof MutationRequestError ||
      (error instanceof Error && error.name === "ZodError")
    ) {
      return failure(
        "malformed_request",
        error instanceof MutationRequestError ? error.status : 400
      );
    }
    if (error instanceof CheckpointAuthorizationError) {
      return failure("checkpoint_unauthorized", 401);
    }
    if (error instanceof CrossOriginMutationError) {
      return failure("cross_origin_request", 403);
    }
    return failure("checkpoint_unavailable", 503);
  }
}
