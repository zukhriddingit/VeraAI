"use client";

import {
  RentalResearchRunStatusSchema,
  type CanonicalListingSummary,
  type RentalResearchProgressPhase,
  type RentalResearchRunStatus,
  type RentalResearchSource,
  type RentalResearchSourceState,
  type SearchProfile
} from "@vera/domain";
import { useEffect, useMemo, useState } from "react";

import { ListingDashboard } from "./listing-dashboard";
import { SearchComposer } from "./search-composer";

const phaseLabels: Record<RentalResearchProgressPhase, string> = {
  connecting: "Connecting",
  checking_login: "Checking login",
  searching: "Searching",
  opening_details: "Opening details",
  importing: "Importing",
  deduplicating: "Deduplicating",
  ranking: "Ranking",
  completed: "Completed"
};

const sourceLabels: Record<RentalResearchSource, string> = {
  rentcast: "RentCast",
  zillow: "Zillow"
};

const sourceStateLabels: Record<RentalResearchSourceState, string> = {
  ready: "Ready",
  login_required: "Login required",
  browser_offline: "Browser offline",
  excluded_by_user: "Excluded by user",
  searching: "Searching",
  completed: "Completed",
  partial: "Partial",
  failed: "Failed"
};

function sourceNeedsRetry(state: RentalResearchSourceState): boolean {
  return ["login_required", "browser_offline", "partial", "failed"].includes(state);
}

export function LiveSearchPanel({
  profiles: initialProfiles,
  initialListings
}: {
  profiles: readonly SearchProfile[];
  initialListings: readonly CanonicalListingSummary[];
}) {
  const [profiles, setProfiles] = useState<readonly SearchProfile[]>(initialProfiles);
  const [profileId, setProfileId] = useState(initialProfiles[0]?.id ?? "");
  const [selectedSources, setSelectedSources] = useState<readonly RentalResearchSource[]>([
    "rentcast"
  ]);
  const [confirmed, setConfirmed] = useState(false);
  const [status, setStatus] = useState<RentalResearchRunStatus | null>(null);
  const [runId, setRunId] = useState<string | null>(null);
  const [localPhase, setLocalPhase] = useState<RentalResearchProgressPhase | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const selectedProfile = profiles.find((profile) => profile.id === profileId) ?? null;
  const phase = status?.phase ?? localPhase;
  const running = runId !== null && phase !== "completed";
  const failedSources = useMemo(
    () =>
      status?.sources
        .filter((source) => sourceNeedsRetry(source.state))
        .map((source) => source.source) ?? [],
    [status]
  );

  useEffect(() => {
    if (runId === null || phase === "completed") return;
    const controller = new AbortController();
    let polling = false;
    const poll = async () => {
      if (polling) return;
      polling = true;
      try {
        const response = await fetch(`/api/live-search/${encodeURIComponent(runId)}`, {
          cache: "no-store",
          signal: controller.signal
        });
        if (response.status === 404) return;
        if (!response.ok) throw new Error("status unavailable");
        const next = RentalResearchRunStatusSchema.parse((await response.json()) as unknown);
        setStatus(next);
        setLocalPhase(null);
        if (next.phase === "completed") setRefreshKey((value) => value + 1);
      } catch (caught: unknown) {
        if (!(caught instanceof DOMException && caught.name === "AbortError")) {
          setError("Research status is temporarily unavailable. Imported listings remain safe.");
        }
      } finally {
        polling = false;
      }
    };
    const interval = window.setInterval(() => void poll(), 1_000);
    void poll();
    return () => {
      controller.abort();
      window.clearInterval(interval);
    };
  }, [phase, runId]);

  function toggleSource(source: RentalResearchSource) {
    setSelectedSources((current) =>
      current.includes(source)
        ? current.filter((candidate) => candidate !== source)
        : [...current, source]
    );
    setConfirmed(false);
  }

  async function run(sources: readonly RentalResearchSource[] = selectedSources) {
    if (sources.length === 0) return;
    const nextRunId = crypto.randomUUID();
    setError(null);
    setStatus(null);
    setRunId(nextRunId);
    setLocalPhase("connecting");
    try {
      const response = await fetch("/api/live-search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          veraRunId: nextRunId,
          searchProfileId: profileId,
          selectedSources: sources,
          confirmedExternalUsage: true
        })
      });
      const body = (await response.json()) as unknown;
      if (!response.ok) {
        const safe = body as { message?: unknown };
        throw new Error(
          typeof safe.message === "string" ? safe.message : "Rental research stopped safely."
        );
      }
      const next = RentalResearchRunStatusSchema.parse(body);
      setStatus(next);
      setLocalPhase(null);
      if (next.phase === "completed") setRefreshKey((value) => value + 1);
    } catch (caught: unknown) {
      setRunId(null);
      setLocalPhase(null);
      setError(caught instanceof Error ? caught.message : "Rental research stopped safely.");
    }
  }

  async function stop() {
    if (runId === null) return;
    setError(null);
    try {
      const response = await fetch(`/api/live-search/${encodeURIComponent(runId)}/stop`, {
        method: "POST"
      });
      if (!response.ok) throw new Error("Stop request failed.");
      setStatus(RentalResearchRunStatusSchema.parse((await response.json()) as unknown));
      setLocalPhase(null);
    } catch {
      setError("Vera could not confirm Stop. Use the extension to unshare the tab immediately.");
    }
  }

  return (
    <>
      <SearchComposer
        profiles={profiles}
        selectedProfileId={profileId}
        disabled={running}
        onProfileSelected={(nextProfileId) => {
          setProfileId(nextProfileId);
          setConfirmed(false);
        }}
        onProfileCreated={(profile) => {
          setProfiles((current) => [...current, profile]);
          setProfileId(profile.id);
          setConfirmed(false);
        }}
      />

      <section className="live-search-launch" aria-labelledby="live-search-heading">
        <div className="live-search-launch-copy">
          <p className="eyebrow">Read-only rental research</p>
          <h2 id="live-search-heading">Choose sources</h2>
          <p>
            RentCast is Vera’s official API source. Zillow is an opt-in founder experiment that
            reads only one explicitly shared Zillow rental tab through the bounded OpenClaw tool.
          </p>
          <div className="source-selector" role="group" aria-label="Rental sources">
            {(["rentcast", "zillow"] as const).map((source) => {
              const selected = selectedSources.includes(source);
              const current = status?.sources.find((candidate) => candidate.source === source);
              return (
                <label className="source-selector-option" key={source}>
                  <input
                    type="checkbox"
                    checked={selected}
                    disabled={running}
                    onChange={() => toggleSource(source)}
                  />
                  <span>
                    <strong>{sourceLabels[source]}</strong>
                    <small>
                      {current
                        ? sourceStateLabels[current.state]
                        : selected
                          ? "Ready"
                          : "Excluded by user"}
                    </small>
                  </span>
                </label>
              );
            })}
          </div>
          <label className="live-search-confirmation">
            <input
              type="checkbox"
              checked={confirmed}
              disabled={running || selectedProfile === null || selectedSources.length === 0}
              onChange={(event) => setConfirmed(event.target.checked)}
            />
            <span>
              I am starting this read-only search now. If Zillow is selected, I have opened and
              explicitly shared exactly one Zillow rental tab.
            </span>
          </label>
        </div>
        <div className="live-search-actions">
          <button
            className="primary-button live-search-button"
            type="button"
            disabled={
              running || !confirmed || selectedProfile === null || selectedSources.length === 0
            }
            onClick={() => void run()}
          >
            {running && phase ? phaseLabels[phase] : "Search selected sources"}
          </button>
          {running ? (
            <button className="secondary-button" type="button" onClick={() => void stop()}>
              Stop search
            </button>
          ) : null}
        </div>
      </section>

      {error ? (
        <div className="listing-message listing-message-warning" role="alert">
          <strong>Rental research did not complete.</strong>
          <span>{error}</span>
        </div>
      ) : null}

      {status ? (
        <section className="profile-card" aria-label="Rental research status">
          <div className="profile-card-copy">
            <p className="eyebrow">Live progress</p>
            <h2>{phaseLabels[status.phase]}</h2>
            <p>
              {status.partial
                ? "Partial completion: successful source results were preserved."
                : "Each source progresses independently through Vera’s normal import pipeline."}
            </p>
            {failedSources.length > 0 && !running ? (
              <button
                className="secondary-button"
                type="button"
                onClick={() => void run(failedSources)}
              >
                Retry failed source{failedSources.length === 1 ? "" : "s"}
              </button>
            ) : null}
          </div>
          <div className="source-status-grid">
            {status.sources.map((source) => (
              <article className="source-status-card" key={source.source}>
                <div>
                  <strong>{sourceLabels[source.source]}</strong>
                  <span className={`source-state source-state-${source.state}`}>
                    {sourceStateLabels[source.state]}
                  </span>
                </div>
                <p>
                  {source.retrievedCount} observed · {source.importedCount} imported ·{" "}
                  {source.rejectedCount} rejected
                </p>
                {source.message ? <p>{source.message}</p> : null}
              </article>
            ))}
          </div>
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
          <p>Compare Vera fit scores, source freshness, missing facts, and research notes.</p>
        </div>
        <ListingDashboard initialListings={initialListings} refreshKey={refreshKey} />
      </section>
    </>
  );
}
