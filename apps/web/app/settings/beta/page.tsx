import Link from "next/link";
import { notFound } from "next/navigation";

import { getHostedApplication } from "../../../lib/server/application.ts";
import { BetaAdminRequiredError, requireBetaAdmin } from "../../../lib/server/beta-admin-auth.ts";
import { requireVeraPageSession } from "../../../lib/server/page-session.ts";
import { BetaReviewQueue } from "./review-queue.tsx";

export const dynamic = "force-dynamic";

export default async function BetaReviewPage() {
  const application = getHostedApplication();
  const session = await requireVeraPageSession();
  try {
    requireBetaAdmin(session.userId);
  } catch (error: unknown) {
    if (error instanceof BetaAdminRequiredError) notFound();
    throw error;
  }
  if (!application.betaAccess) notFound();
  const requests = await application.betaAccess.listRequests();
  return (
    <main>
      <nav className="page-nav" aria-label="Private beta navigation">
        <Link href="/">Listings</Link>
        <Link href="/settings/beta" aria-current="page">
          Beta review
        </Link>
      </nav>
      <header className="subpage-hero settings-hero">
        <p className="eyebrow">Founder only</p>
        <h1>Review every invitation explicitly.</h1>
        <p className="lede">
          A request is only contact consent. Invite is a separate, audited action.
        </p>
      </header>
      <BetaReviewQueue initialRequests={requests} />
    </main>
  );
}
