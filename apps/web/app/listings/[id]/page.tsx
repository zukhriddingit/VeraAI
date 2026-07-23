import Link from "next/link";
import { notFound } from "next/navigation";

import { getCalendarIntegrationStatus } from "../../../lib/calendar-service";
import { getListingDetail } from "../../../lib/listing-presentation";
import { parseRouteEntityId } from "../../../lib/route-entity-id";
import { requireVeraPageSession } from "../../../lib/server/page-session";
import { getHostedApplication } from "../../../lib/server/application";
import { ListingDetail } from "./listing-detail";

export const dynamic = "force-dynamic";

interface ListingDetailPageProps {
  readonly params: Promise<{ id: string }>;
}

export default async function ListingDetailPage({ params }: ListingDetailPageProps) {
  const context = await requireVeraPageSession();
  const listingId = parseRouteEntityId((await params).id);
  if (listingId === null) notFound();
  const initialDetail = await getListingDetail(context.repositories, listingId);
  if (initialDetail === null) notFound();
  const application = getHostedApplication();
  const calendarStatus = await getCalendarIntegrationStatus(
    context.repositories,
    application.calendar.configurationState,
    new Date().toISOString()
  );

  return (
    <main>
      <nav className="page-nav" aria-label="Vera navigation">
        <Link href="/">Listings</Link>
        <Link href="/capture">Capture a listing</Link>
        <Link href="/activity">Activity</Link>
        <Link href="/connectors">Connector status</Link>
        <Link href="/settings/integrations">Settings</Link>
      </nav>
      <header className="subpage-hero evidence-hero">
        <p className="eyebrow">Canonical listing evidence</p>
        <h1>Know why this home stands out.</h1>
        <p className="lede">
          Review stitched facts, every retained source, fit factors, and risk indicators before
          deciding what to do next.
        </p>
      </header>
      <ListingDetail
        listingId={listingId}
        initialDetail={initialDetail}
        demoMode={context.demoMode}
        holdCapabilityState={calendarStatus.holdCreation.state}
      />
    </main>
  );
}
