"use client";

import {
  LiveSearchStatusSchema,
  type CanonicalListingSummary,
  type LiveSearchResultState,
  type LiveSearchStatus,
  type SearchProfile
} from "@vera/domain";
import { useEffect, useState } from "react";

import { ListingDashboard } from "./listing-dashboard";

const terminalStates = new Set<LiveSearchResultState>([
  "provider_unavailable",
  "provider_auth_failed",
  "provider_rate_limited",
  "maritime_unavailable",
  "agent_timeout",
  "agent_invalid_response",
  "no_matching_live_results",
  "completed"
]);

const stateLabels: Record<LiveSearchResultState, string> = {
  queued: "Queued",
  retrieving: "Retrieving RentCast inventory",
  analyzing: "OpenClaw analyzing candidates on Maritime",
  importing: "Importing, normalizing, and scoring",
  provider_unavailable: "RentCast unavailable",
  provider_auth_failed: "RentCast authentication failed",
  provider_rate_limited: "RentCast rate limit reached",
  maritime_unavailable: "Maritime unavailable",
  agent_timeout: "OpenClaw analysis timed out",
  agent_invalid_response: "OpenClaw returned an invalid response",
  no_matching_live_results: "No matching live results",
  completed: "Completed"
};

function milliseconds(value: number | null): string {
  return value === null ? "Pending" : `${String(value)} ms`;
}

export function LiveSearchPanel({
  profiles,
  initialListings
}: {
  profiles: readonly SearchProfile[];
  initialListings: readonly CanonicalListingSummary[];
}) {
  const [profileId, setProfileId] = useState(profiles[0]?.id ?? "");
  const [confirmed, setConfirmed] = useState(false);
  const [status, setStatus] = useState<LiveSearchStatus | null>(null);
  const [requestState, setRequestState] = useState<LiveSearchResultState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retryOf, setRetryOf] = useState<string | null>(null);
  const [retryUsed, setRetryUsed] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  const activeState = status?.state ?? requestState;
  const running = activeState !== null && !terminalStates.has(activeState);

  useEffect(() => {
    if (!status || terminalStates.has(status.state)) return;
    const controller = new AbortController();
    const timeout = window.setTimeout(async () => {
      try {
        const response = await fetch(`/api/live-search/${encodeURIComponent(status.searchRunId)}`, {
          cache: "no-store",
          signal: controller.signal
        });
        if (!response.ok) throw new Error("status unavailable");
        const next = LiveSearchStatusSchema.parse((await response.json()) as unknown);
        setStatus(next);
        if (next.state === "completed") setRefreshKey((value) => value + 1);
      } catch (caught: unknown) {
        if (!(caught instanceof DOMException && caught.name === "AbortError")) {
          setError(
            "Live-search status is temporarily unavailable. Your existing listings are safe."
          );
        }
      }
    }, 1_000);
    return () => {
      controller.abort();
      window.clearTimeout(timeout);
    };
  }, [status]);

  async function run() {
    setError(null);
    setRequestState("queued");
    try {
      const response = await fetch("/api/live-search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          searchProfileId: profileId,
          confirmedExternalUsage: true,
          ...(retryOf ? { retryOfSearchRunId: retryOf } : {})
        })
      });
      const body = (await response.json()) as unknown;
      if (!response.ok) {
        const safe = body as {
          code?: unknown;
          message?: unknown;
          searchRunId?: unknown;
          retryable?: unknown;
        };
        if (safe.retryable === true && typeof safe.searchRunId === "string" && !retryUsed) {
          setRetryOf(safe.searchRunId);
        }
        throw new Error(
          typeof safe.message === "string" ? safe.message : "Live search stopped safely."
        );
      }
      setStatus(LiveSearchStatusSchema.parse(body));
      setRequestState(null);
      if (retryOf) setRetryUsed(true);
      setRetryOf(null);
    } catch (caught: unknown) {
      setRequestState(null);
      setError(caught instanceof Error ? caught.message : "Live search stopped safely.");
    }
  }

  return (
    <>
      <section className="demo-search-card" aria-labelledby="live-search-heading">
        <div>
          <p className="eyebrow">Founder-only live inventory</p>
          <h2 id="live-search-heading">Run live agent search</h2>
          <p>
            Retrieves up to ten active RentCast rentals, then sends minimized candidate facts to
            OpenClaw on Maritime. Vera remains authoritative for hard constraints and scoring.
          </p>
          {profiles.length > 0 ? (
            <label>
              Active search profile
              <select
                value={profileId}
                disabled={running}
                onChange={(event) => setProfileId(event.target.value)}
              >
                {profiles.map((profile) => (
                  <option key={profile.id} value={profile.id}>
                    {profile.name} · {profile.locationText}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <p role="alert">Create a real search profile before running live search.</p>
          )}
          <label>
            <input
              type="checkbox"
              checked={confirmed}
              disabled={running}
              onChange={(event) => setConfirmed(event.target.checked)}
            />{" "}
            I understand this uses live RentCast and Maritime API capacity.
          </label>
        </div>
        <button
          className="primary-button demo-run-button"
          type="button"
          disabled={running || !confirmed || profileId.length === 0}
          onClick={() => void run()}
        >
          {running && activeState
            ? stateLabels[activeState]
            : retryOf
              ? "Retry live search once"
              : "Run live agent search"}
        </button>
      </section>

      {error ? (
        <div className="listing-message listing-message-warning" role="alert">
          <strong>Live search did not complete.</strong>
          <span>{error}</span>
        </div>
      ) : null}

      {status ? (
        <section className="profile-card" aria-label="Live search status">
          <div className="profile-card-copy">
            <p className="eyebrow">Live search status</p>
            <h2>{stateLabels[status.state]}</h2>
            {status.state === "completed" ? (
              <p>Live results — RentCast inventory analyzed by OpenClaw on Maritime.</p>
            ) : null}
          </div>
          <dl className="profile-facts">
            <div>
              <dt>Search run ID</dt>
              <dd>{status.searchRunId}</dd>
            </div>
            <div>
              <dt>Data provider</dt>
              <dd>{status.dataProvider}</dd>
            </div>
            <div>
              <dt>Maritime agent</dt>
              <dd>{status.maritimeAgent}</dd>
            </div>
            <div>
              <dt>Results</dt>
              <dd>
                {status.retrievedCount} retrieved · {status.importedCount} imported ·{" "}
                {status.rejectedCount} rejected
              </dd>
            </div>
            <div>
              <dt>Retrieval latency</dt>
              <dd>{milliseconds(status.retrievalLatencyMilliseconds)}</dd>
            </div>
            <div>
              <dt>Agent latency</dt>
              <dd>{milliseconds(status.agentLatencyMilliseconds)}</dd>
            </div>
            <div>
              <dt>Total latency</dt>
              <dd>{milliseconds(status.totalLatencyMilliseconds)}</dd>
            </div>
            <div>
              <dt>Completed</dt>
              <dd>{status.completedAt ?? "Pending normalization and scoring"}</dd>
            </div>
          </dl>
        </section>
      ) : null}

      <section
        className="listings-section cockpit-listings-section"
        aria-labelledby="listings-heading"
      >
        <div className="listings-heading">
          <div>
            <p className="eyebrow">Decision cockpit</p>
            <h2 id="listings-heading">Homes worth your attention</h2>
          </div>
          <p>Compare Vera fit scores, source freshness, missing facts, and agent notes.</p>
        </div>
        <ListingDashboard initialListings={initialListings} refreshKey={refreshKey} />
      </section>
    </>
  );
}
