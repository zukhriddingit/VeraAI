import {
  BrowserResearchCheckpointRequestSchema,
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
  BrowserGatewayAuthorizationError,
  type AuthenticatedBrowserCheckpoint,
  type BrowserGatewayRuntimeResolver
} from "../../../../../lib/server/browser-gateway-runtime-resolver.ts";
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

export class CheckpointConfigurationError extends Error {
  constructor() {
    super("The browser research checkpoint resolver is unavailable.");
    this.name = "CheckpointConfigurationError";
  }
}

export function parseCheckpointBearer(authorization: string | null): string {
  if (!authorization?.startsWith("Bearer ")) {
    throw new BrowserGatewayAuthorizationError();
  }
  const token = authorization.slice("Bearer ".length);
  if (!token || token.trim() !== token) throw new BrowserGatewayAuthorizationError();
  return token;
}

export function checkpointRequestOrigin(request: Request): string {
  const supplied = request.headers.get("origin");
  if (supplied === null) throw new CrossOriginMutationError();
  try {
    const suppliedUrl = new URL(supplied);
    if (
      suppliedUrl.origin !== supplied ||
      suppliedUrl.protocol !== "https:" ||
      suppliedUrl.pathname !== "/" ||
      suppliedUrl.search ||
      suppliedUrl.hash ||
      suppliedUrl.username ||
      suppliedUrl.password
    ) {
      throw new CrossOriginMutationError();
    }
    return suppliedUrl.origin;
  } catch (error) {
    if (error instanceof CrossOriginMutationError) throw error;
    throw new CrossOriginMutationError();
  }
}

export async function requireAssignedCheckpoint(
  request: Request,
  resolver: BrowserGatewayRuntimeResolver | null
): Promise<AuthenticatedBrowserCheckpoint> {
  if (resolver === null) throw new CheckpointConfigurationError();
  return resolver.authenticateCheckpoint({
    bearerToken: parseCheckpointBearer(request.headers.get("authorization")),
    origin: checkpointRequestOrigin(request)
  });
}

function failure(code: string, status: number): Response {
  return Response.json(
    { code, message: "Browser research authorization stopped safely." },
    { status, headers }
  );
}

export async function POST(request: Request): Promise<Response> {
  try {
    const application = getHostedApplication();
    const resolved = await requireAssignedCheckpoint(request, application.browserGatewayRuntime);
    const rawInput = await readBoundedJson(request, { maxBytes: 16_000 });
    const repositories = application.repositoryProvider.forUser(resolved.userId);
    const genericInput = BrowserResearchCheckpointRequestSchema.safeParse(rawInput);
    const result = genericInput.success
      ? await checkBrowserResearchAction(
          createBrowserResearchCheckpointDependencies(
            resolved.userId,
            repositories,
            resolved.runtime,
            process.env
          ),
          genericInput.data
        )
      : await checkZillowResearchAction(
          createZillowResearchCheckpointDependencies(
            resolved.userId,
            repositories,
            resolved.runtime,
            process.env
          ),
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
    if (error instanceof BrowserGatewayAuthorizationError) {
      return failure("checkpoint_unauthorized", 401);
    }
    if (error instanceof CrossOriginMutationError) {
      return failure("cross_origin_request", 403);
    }
    return failure(
      error instanceof CheckpointConfigurationError
        ? "checkpoint_not_configured"
        : "checkpoint_unavailable",
      503
    );
  }
}
