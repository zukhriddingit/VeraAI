import Link from "next/link";

export default function AccessPendingPage() {
  return (
    <main className="cockpit-main">
      <header className="cockpit-hero">
        <p className="eyebrow">Private beta</p>
        <h1>Your access is not active yet.</h1>
        <p className="lede">
          Vera uses Google for identity, but identity alone does not grant access. Sign in with the
          exact verified email from your invitation, or request a place in the private beta.
        </p>
        <div className="detail-actions">
          <Link className="primary-action" href="/sign-in">Try sign-in again</Link>
          <Link className="secondary-button" href="/beta">Request access</Link>
        </div>
      </header>
    </main>
  );
}
