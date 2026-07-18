import { EntityIdSchema } from "@vera/domain";
import Link from "next/link";
import { notFound } from "next/navigation";

import { CaptureEvidence } from "./capture-evidence";

interface CaptureEvidencePageProps {
  readonly params: Promise<{ rawListingId: string }>;
}

export default async function CaptureEvidencePage({ params }: CaptureEvidencePageProps) {
  const parsedId = EntityIdSchema.safeParse((await params).rawListingId);
  if (!parsedId.success) notFound();

  return (
    <main>
      <nav className="page-nav" aria-label="Vera navigation">
        <Link href="/">Vera dashboard</Link>
        <Link href="/capture">Capture another listing</Link>
        <Link href="/activity">Activity</Link>
        <Link href="/connectors">Connector status</Link>
      </nav>
      <header className="subpage-hero evidence-hero">
        <p className="eyebrow">Local evidence record</p>
        <h1>Extraction evidence</h1>
        <p className="lede">
          Review what Vera normalized from the evidence you supplied. Unknown fields stay unknown,
          and this page does not open listing links or initiate contact.
        </p>
      </header>
      <CaptureEvidence rawListingId={parsedId.data} />
    </main>
  );
}
