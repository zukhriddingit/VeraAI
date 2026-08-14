"use client";

import type { BetaAccessRequest, BetaAccessReviewAction } from "@vera/domain";
import { useState } from "react";

export function BetaReviewQueue(props: { readonly initialRequests: readonly BetaAccessRequest[] }) {
  const [requests, setRequests] = useState(props.initialRequests);
  const [pending, setPending] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function review(requestId: string, action: BetaAccessReviewAction) {
    setPending(requestId);
    setMessage(null);
    const response = await fetch("/api/admin/beta-access", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ requestId, action })
    });
    const body = (await response.json()) as { request?: BetaAccessRequest; code?: string };
    if (!response.ok || !body.request) {
      setMessage(`Review was not saved: ${body.code ?? "unavailable"}.`);
      setPending(null);
      return;
    }
    setRequests((current) => current.map((item) => (item.id === requestId ? body.request! : item)));
    setPending(null);
  }

  return (
    <section className="settings-section" aria-label="Private beta requests">
      {requests.length === 0 ? (
        <article className="integration-card">
          <h2>No requests yet</h2>
        </article>
      ) : null}
      {requests.map((request) => (
        <article className="integration-card" key={request.id}>
          <p className="eyebrow">{request.status}</p>
          <h2>{request.normalizedEmail}</h2>
          <p>Requested {new Date(request.requestedAt).toLocaleString()}</p>
          {request.status === "requested" ? (
            <div className="detail-actions">
              <button
                className="primary-button"
                type="button"
                disabled={pending === request.id}
                onClick={() => void review(request.id, "invite")}
              >
                Invite
              </button>
              <button
                className="secondary-button"
                type="button"
                disabled={pending === request.id}
                onClick={() => void review(request.id, "decline")}
              >
                Decline
              </button>
            </div>
          ) : null}
        </article>
      ))}
      {message ? (
        <p className="settings-error" role="alert">
          {message}
        </p>
      ) : null}
    </section>
  );
}
