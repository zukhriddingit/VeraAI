import Link from "next/link";
import { notFound } from "next/navigation";

import { getHostedApplication } from "../../../lib/server/application.ts";
import { OperatorAuthorizationError, requireOperator } from "../../../lib/server/operator-auth.ts";
import { loadOperationsSnapshot } from "../../../lib/server/operations-service.ts";
import { requireVeraPageSession } from "../../../lib/server/page-session.ts";
import { OperationsPanel } from "./operations-panel.tsx";

export const dynamic = "force-dynamic";

export default async function OperationsPage() {
  const application = getHostedApplication();
  const context = await requireVeraPageSession();
  try {
    requireOperator(context.userId);
  } catch (error: unknown) {
    if (error instanceof OperatorAuthorizationError) notFound();
    throw error;
  }
  const snapshot = await loadOperationsSnapshot({
    repositories: context.repositories,
    ...(application.maritimeOperations ? { globalOperations: application.maritimeOperations } : {})
  });
  const activeJobs = (await context.repositories.sourceJobs.list()).filter(
    (job) => !["completed", "cancelled_by_policy"].includes(job.status)
  );
  const jobs = await Promise.all(
    activeJobs.map(async (job) => {
      const dispatch =
        job.status === "queued"
          ? await context.repositories.maritimeDispatches.getBySourceJobId(job.id)
          : null;
      return {
        id: job.id,
        status: job.status,
        attempts: job.attempts,
        source: job.source,
        canRetry:
          ["retryable_failed", "deferred_node_offline", "manual_action_required"].includes(
            job.status
          ) ||
          (dispatch?.state === "rejected" &&
            ["maritime_rate_limited", "maritime_unavailable"].includes(
              dispatch.rejectionCode ?? ""
            ))
      };
    })
  );

  return (
    <main>
      <nav className="page-nav" aria-label="Operator navigation">
        <Link href="/">Listings</Link>
        <Link href="/settings/operations" aria-current="page">
          Operations
        </Link>
      </nav>
      <header className="subpage-hero settings-hero">
        <p className="eyebrow">Operator only</p>
        <h1>Execution health and fail-closed controls.</h1>
        <p className="lede">
          PostgreSQL is canonical. Maritime status is execution evidence; retries recheck source
          policy before any job returns to the queue.
        </p>
      </header>
      <OperationsPanel snapshot={snapshot} jobs={jobs} />
    </main>
  );
}
