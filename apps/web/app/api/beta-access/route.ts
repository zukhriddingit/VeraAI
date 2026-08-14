import { BetaAccessAcceptedResponseSchema, BetaAccessSubmissionSchema } from "@vera/domain";

import { getHostedApplication } from "../../../lib/server/application.ts";
import {
  BetaRateLimitError,
  requirePublicBetaSubmissionBoundary
} from "../../../lib/server/beta-access-security.ts";
import {
  CrossOriginMutationError,
  MutationRequestError,
  readBoundedJson
} from "../../../lib/server/request-security.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const responseHeaders = {
  "Cache-Control": "no-store, max-age=0",
  "Content-Type": "application/json"
};
const acceptedBody = BetaAccessAcceptedResponseSchema.parse({
  accepted: true,
  code: "request_received"
});

export async function POST(request: Request): Promise<Response> {
  const requestId = crypto.randomUUID();
  const startedAt = performance.now();
  let outcomeCode = "try_again";
  try {
    const application = getHostedApplication();
    const repository = application.betaAccess;
    if (!repository) throw new Error("Beta access repository is unavailable.");

    await requirePublicBetaSubmissionBoundary(request, repository);
    const untrusted = await readBoundedJson(request, { maxBytes: 2_048 });
    const website =
      typeof untrusted === "object" && untrusted !== null && "website" in untrusted
        ? Reflect.get(untrusted, "website")
        : undefined;
    if (typeof website === "string" && website !== "") {
      outcomeCode = "request_received";
      return Response.json(acceptedBody, { status: 202, headers: responseHeaders });
    }
    const submission = BetaAccessSubmissionSchema.parse(untrusted);
    await repository.submit({
      email: submission.email,
      consentVersion: submission.consentVersion,
      now: new Date()
    });
    outcomeCode = "request_received";
    return Response.json(acceptedBody, { status: 202, headers: responseHeaders });
  } catch (error: unknown) {
    if (error instanceof BetaRateLimitError) {
      outcomeCode = "rate_limited";
      return Response.json(
        { accepted: false, code: "try_again" },
        { status: 429, headers: responseHeaders }
      );
    }
    if (error instanceof CrossOriginMutationError) {
      outcomeCode = "cross_origin_request";
      return Response.json(
        { accepted: false, code: "try_again" },
        { status: 403, headers: responseHeaders }
      );
    }
    if (
      error instanceof MutationRequestError ||
      (error instanceof Error && error.name === "ZodError")
    ) {
      outcomeCode = "malformed_request";
      return Response.json(
        { accepted: false, code: "invalid_request" },
        {
          status: error instanceof MutationRequestError ? error.status : 400,
          headers: responseHeaders
        }
      );
    }
    outcomeCode = "try_again";
    return Response.json(
      { accepted: false, code: "try_again" },
      { status: 503, headers: responseHeaders }
    );
  } finally {
    console.info("beta_access_submission", {
      requestId,
      outcomeCode,
      durationMs: Math.round(performance.now() - startedAt)
    });
  }
}
