import { timingSafeEqual } from "node:crypto";

import { VeraUserIdSchema, ZillowResearchCheckpointRequestSchema } from "@vera/domain";

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

export function assertCheckpointRequestOrigin(request: Request): void {
  const supplied = request.headers.get("origin");
  if (supplied === null) throw new CrossOriginMutationError();
  try {
    const requestOrigin = new URL(request.url).origin;
    const suppliedUrl = new URL(supplied);
    if (
      suppliedUrl.origin !== supplied ||
      suppliedUrl.pathname !== "/" ||
      suppliedUrl.search ||
      suppliedUrl.hash ||
      suppliedUrl.username ||
      suppliedUrl.password ||
      suppliedUrl.origin !== requestOrigin
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
    assertCheckpointRequestOrigin(request);
    const founder = VeraUserIdSchema.safeParse(
      process.env.VERA_BROWSER_GATEWAY_FOUNDER_USER_ID?.trim()
    );
    if (!founder.success) return failure("founder_not_configured", 503);

    const input = ZillowResearchCheckpointRequestSchema.parse(
      await readBoundedJson(request, { maxBytes: 4_000 })
    );
    const repositories = getHostedApplication().repositoryProvider.forUser(founder.data);
    const result = await checkZillowResearchAction(
      createZillowResearchCheckpointDependencies(founder.data, repositories, process.env),
      input
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
