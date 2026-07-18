import { EntityIdSchema } from "@vera/domain";
import Link from "next/link";
import { notFound } from "next/navigation";

import { ListingDetail } from "./listing-detail";

interface ListingDetailPageProps {
  readonly params: Promise<{ id: string }>;
}

export default async function ListingDetailPage({ params }: ListingDetailPageProps) {
  const parsed = EntityIdSchema.safeParse((await params).id);
  if (!parsed.success) notFound();

  return (
    <main>
      <nav className="page-nav" aria-label="Vera navigation">
        <Link href="/">Listings</Link>
        <Link href="/capture">Capture a listing</Link>
        <Link href="/activity">Activity</Link>
        <Link href="/connectors">Connector status</Link>
      </nav>
      <header className="subpage-hero evidence-hero">
        <p className="eyebrow">Canonical listing evidence</p>
        <h1>Know why this home stands out.</h1>
        <p className="lede">
          Review stitched facts, every retained source, fit factors, and risk indicators before
          deciding what to do next.
        </p>
      </header>
      <ListingDetail listingId={parsed.data} />
    </main>
  );
}
