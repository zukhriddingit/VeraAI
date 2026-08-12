"use client";

import {
  BOSTON_CRAIGSLIST_CONFIGURATION,
  BU_OFF_CAMPUS_CONFIGURATION,
  BrowserExtensionReadinessMessageSchema,
  RentalResearchRunStatusSchema,
  SelectedHousingSourceConfigurationSchema,
  browserExtensionReadyForResearch,
  type BrowserExtensionReadinessMessage,
  type CanonicalListingSummary,
  type HousingSourceLoginRequirement,
  type RentalResearchProgressPhase,
  type RentalResearchRunStatus,
  type RentalResearchSource,
  type RentalResearchSourceState,
  type SearchProfile,
  type SelectedHousingSourceConfiguration
} from "@vera/domain";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";

import { ListingDashboard } from "./listing-dashboard";
import {
  rentalResearchRecoveryLabel,
  rentalResearchRecoveryReady,
  rentalResearchRecoverySources
} from "./live-search-recovery";
import { SearchComposer } from "./search-composer";
import { STATIC_ACCEPTANCE_SNAPSHOT_WARNING } from "./static-acceptance-warning";

const phaseLabels: Record<RentalResearchProgressPhase, string> = {
  connecting_browser: "Connecting browser",
  checking_sources: "Checking sources",
  searching_rentcast: "Searching RentCast",
  searching_zillow: "Searching Zillow",
  searching_apartments_com: "Searching Apartments.com",
  searching_facebook_marketplace: "Searching Facebook Marketplace",
  searching_bu_off_campus: "Searching BU Off-Campus Housing",
  searching_custom_website: "Searching custom housing website",
  searching_craigslist: "Searching Craigslist",
  importing: "Importing",
  deduplicating: "Deduplicating",
  scoring: "Scoring",
  completed: "Completed"
};

const sourceLabels: Record<RentalResearchSource, string> = {
  rentcast: "RentCast",
  zillow: "Zillow",
  apartments_com: "Apartments.com",
  facebook_marketplace: "Facebook Marketplace",
  bu_off_campus: "BU Off-Campus Housing",
  custom_website: "Custom housing website",
  craigslist: "Craigslist"
};

const sourceDescriptions: Record<RentalResearchSource, string> = {
  rentcast: "Official API",
  zillow: "Founder browser experiment",
  apartments_com: "Founder browser experiment",
  facebook_marketplace: "Manual account may be required",
  bu_off_campus: "Configurable Off Campus Partners adapter",
  custom_website: "Generic read-only browser mode",
  craigslist: "Experimental browser search"
};

const sourceStateLabels: Record<RentalResearchSourceState, string> = {
  ready: "Ready",
  login_required: "Login required",
  account_recommended: "Account recommended",
  browser_offline: "Browser offline",
  tab_required: "Tab required",
  excluded_by_user: "Excluded by user",
  searching: "Searching",
  completed: "Completed",
  partial: "Partial",
  no_results: "No results",
  manual_action_required: "Manual action required",
  failed: "Failed"
};

const browserSources = new Set<RentalResearchSource>([
  "zillow",
  "apartments_com",
  "facebook_marketplace",
  "bu_off_campus",
  "custom_website",
  "craigslist"
]);

const CUSTOM_SOURCE_STORAGE_KEY = "vera.custom-housing-source.v1";

const selectableSources = [
  "rentcast",
  "zillow",
  "apartments_com",
  "facebook_marketplace",
  "bu_off_campus",
  "craigslist",
  "custom_website"
] as const satisfies readonly RentalResearchSource[];

function browserReadinessCopy(message: BrowserExtensionReadinessMessage | null): string {
  if (message === null) {
    return "Vera OpenClaw is not detected. Open the extension and prepare a Vera Search tab.";
  }
  if (!message.paired) return "Pair Vera OpenClaw with the Browser Gateway first.";
  if (message.relayState !== "on") return "Vera OpenClaw is paired but the Gateway is offline.";
  if (message.readiness === "ready" && message.sharedTabCount === 1) {
    return "Browser ready — recording and bounded browser research may start.";
  }
  if (message.readiness === "browser_extension_conflict") {
    return "A browser extension blocked that tab. Choose Prepare Vera Search tab in OpenClaw.";
  }
  if (message.readiness === "debugger_conflict") {
    return "Another debugger owns that tab. Close DevTools, then prepare a clean search tab.";
  }
  if (message.sharedTabCount > 1) {
    return "More than one tab is shared. Prepare one clean Vera Search tab.";
  }
  return "Open Vera OpenClaw and choose Prepare Vera Search tab before searching.";
}

export function LiveSearchPanel({
  profiles: initialProfiles,
  initialListings,
  staticAcceptanceSnapshot = false
}: {
  profiles: readonly SearchProfile[];
  initialListings: readonly CanonicalListingSummary[];
  staticAcceptanceSnapshot?: boolean;
}) {
  const [profiles, setProfiles] = useState<readonly SearchProfile[]>(initialProfiles);
  const [profileId, setProfileId] = useState(initialProfiles[0]?.id ?? "");
  const [selectedSources, setSelectedSources] = useState<readonly RentalResearchSource[]>([
    "rentcast",
    "zillow",
    "apartments_com",
    "facebook_marketplace"
  ]);
  const [confirmed, setConfirmed] = useState(false);
  const [status, setStatus] = useState<RentalResearchRunStatus | null>(null);
  const [runId, setRunId] = useState<string | null>(null);
  const [localPhase, setLocalPhase] = useState<RentalResearchProgressPhase | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [observedSince, setObservedSince] = useState<string | null>(null);
  const [browserReadiness, setBrowserReadiness] = useState<BrowserExtensionReadinessMessage | null>(
    null
  );
  const [customSourceName, setCustomSourceName] = useState("");
  const [customStartingUrl, setCustomStartingUrl] = useState("");
  const [customAllowedDomain, setCustomAllowedDomain] = useState("");
  const [customLoginRequired, setCustomLoginRequired] =
    useState<HousingSourceLoginRequirement>("unknown");
  const [customDefaultInclude, setCustomDefaultInclude] = useState(false);
  const [customConfiguration, setCustomConfiguration] =
    useState<SelectedHousingSourceConfiguration | null>(null);
  const [customSourceError, setCustomSourceError] = useState<string | null>(null);
  const browserReadinessObservedAt = useRef<number | null>(null);

  const selectedProfile = profiles.find((profile) => profile.id === profileId) ?? null;
  const phase = status?.phase ?? localPhase;
  const running = runId !== null && phase !== "completed";
  const browserSourceSelected = selectedSources.some((source) => browserSources.has(source));
  const browserReady = browserExtensionReadyForResearch(browserReadiness);
  const failedSources = useMemo(
    () => (status === null ? [] : rentalResearchRecoverySources(status.sources)),
    [status]
  );
  const recoveryReady = status !== null && rentalResearchRecoveryReady(status.sources);
  const customSourceStatus = status?.sources.find((source) => source.source === "custom_website");
  const showCurrentPageFallback =
    customConfiguration !== null &&
    (customSourceStatus?.manualAction === "layout_changed" ||
      customSourceStatus?.state === "failed");

  useEffect(() => {
    const hydration = window.setTimeout(() => {
      const stored = window.localStorage.getItem(CUSTOM_SOURCE_STORAGE_KEY);
      if (stored === null) return;
      try {
        const parsed = SelectedHousingSourceConfigurationSchema.parse(JSON.parse(stored));
        if (parsed.source !== "custom_website") return;
        setCustomConfiguration(parsed);
        setCustomSourceName(parsed.displayName);
        setCustomStartingUrl(parsed.startingUrl);
        setCustomAllowedDomain(parsed.allowedDomain);
        setCustomLoginRequired(parsed.loginRequired);
        setCustomDefaultInclude(parsed.defaultInclude);
        if (parsed.defaultInclude) {
          setSelectedSources((current) =>
            current.includes("custom_website") ? current : [...current, "custom_website"]
          );
        }
      } catch {
        window.localStorage.removeItem(CUSTOM_SOURCE_STORAGE_KEY);
      }
    }, 0);
    return () => window.clearTimeout(hydration);
  }, []);

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

  useEffect(() => {
    const receiveReadiness = (event: MessageEvent<unknown>) => {
      if (event.source !== window || event.origin !== window.location.origin) return;
      const parsed = BrowserExtensionReadinessMessageSchema.safeParse(event.data);
      if (!parsed.success) return;
      setBrowserReadiness(parsed.data);
      browserReadinessObservedAt.current = Date.now();
    };
    window.addEventListener("message", receiveReadiness);
    const staleCheck = window.setInterval(() => {
      const observedAt = browserReadinessObservedAt.current;
      if (observedAt !== null && Date.now() - observedAt > 3_500) {
        browserReadinessObservedAt.current = null;
        setBrowserReadiness(null);
      }
    }, 1_000);
    return () => {
      window.removeEventListener("message", receiveReadiness);
      window.clearInterval(staleCheck);
    };
  }, []);

  function toggleSource(source: RentalResearchSource) {
    setSelectedSources((current) =>
      current.includes(source)
        ? current.filter((candidate) => candidate !== source)
        : [...current, source]
    );
    setConfirmed(false);
  }

  function saveCustomSource() {
    setCustomSourceError(null);
    try {
      const allowedDomain = customAllowedDomain.trim().toLowerCase();
      const sourceIdSuffix = allowedDomain.replace(/[^a-z0-9.-]/gu, "-").slice(0, 120);
      const configuration = SelectedHousingSourceConfigurationSchema.parse({
        source: "custom_website",
        sourceId: `custom:${sourceIdSuffix}`,
        displayName: customSourceName,
        adapterKind: "generic",
        startingUrl: customStartingUrl,
        allowedDomain,
        loginRequired: customLoginRequired,
        defaultInclude: customDefaultInclude,
        captureCurrentPage: false
      });
      window.localStorage.setItem(CUSTOM_SOURCE_STORAGE_KEY, JSON.stringify(configuration));
      setCustomConfiguration(configuration);
      setSelectedSources((current) => {
        const withoutCustom = current.filter((source) => source !== "custom_website");
        return configuration.defaultInclude ? [...withoutCustom, "custom_website"] : withoutCustom;
      });
      setConfirmed(false);
    } catch {
      setCustomSourceError(
        "Use a public HTTPS starting URL whose hostname exactly matches the allowed domain."
      );
    }
  }

  function housingConfigurationsFor(
    sources: readonly RentalResearchSource[],
    captureCurrentPage: boolean
  ): SelectedHousingSourceConfiguration[] {
    const configurations: SelectedHousingSourceConfiguration[] = [];
    if (sources.includes("bu_off_campus")) {
      configurations.push({
        ...BU_OFF_CAMPUS_CONFIGURATION,
        source: "bu_off_campus",
        captureCurrentPage: false
      });
    }
    if (sources.includes("craigslist")) {
      configurations.push({
        ...BOSTON_CRAIGSLIST_CONFIGURATION,
        source: "craigslist",
        captureCurrentPage: false
      });
    }
    if (sources.includes("custom_website") && customConfiguration !== null) {
      configurations.push({ ...customConfiguration, captureCurrentPage });
    }
    return configurations;
  }

  async function run(
    sources: readonly RentalResearchSource[] = selectedSources,
    retryOfSearchRunId: string | null = null,
    captureCurrentPage = false
  ) {
    if (sources.length === 0) return;
    if (sources.includes("custom_website") && customConfiguration === null) {
      setError("Save a valid custom housing website before selecting it.");
      return;
    }
    if (sources.some((source) => browserSources.has(source)) && !browserReady) {
      setError("Prepare one Browser ready Vera Search tab before running browser sources.");
      return;
    }
    const nextRunId = crypto.randomUUID();
    if (retryOfSearchRunId === null) {
      setObservedSince(new Date().toISOString());
    }
    setError(null);
    setStatus(null);
    setRunId(nextRunId);
    setLocalPhase("connecting_browser");
    try {
      const response = await fetch("/api/live-search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          veraRunId: nextRunId,
          searchProfileId: profileId,
          selectedSources: sources,
          housingSourceConfigurations: housingConfigurationsFor(sources, captureCurrentPage),
          confirmedExternalUsage: true,
          ...(retryOfSearchRunId === null ? {} : { retryOfSearchRunId })
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
      {staticAcceptanceSnapshot ? (
        <div className="listing-message listing-message-warning" role="alert">
          <strong>{STATIC_ACCEPTANCE_SNAPSHOT_WARNING}</strong>
        </div>
      ) : null}
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
            RentCast is Vera’s official API source. Browser sources are opt-in founder experiments
            that use one explicitly shared Vera Search tab through bounded OpenClaw research.
          </p>
          <div className="source-selector" role="group" aria-label="Rental sources">
            {selectableSources.map((source) => {
              const selected = selectedSources.includes(source);
              const current = status?.sources.find((candidate) => candidate.source === source);
              const unavailable = source === "custom_website" && customConfiguration === null;
              return (
                <label className="source-selector-option" key={source}>
                  <input
                    type="checkbox"
                    checked={selected}
                    disabled={running || unavailable}
                    onChange={() => toggleSource(source)}
                  />
                  <span>
                    <strong>
                      {source === "custom_website" && customConfiguration !== null
                        ? customConfiguration.displayName
                        : sourceLabels[source]}
                    </strong>
                    <small>
                      {current
                        ? sourceStateLabels[current.state]
                        : unavailable
                          ? "Configure below"
                          : sourceDescriptions[source]}
                    </small>
                  </span>
                </label>
              );
            })}
          </div>
          <div className="source-fallback-row" aria-label="Craigslist fallback options">
            <span>
              <strong>Craigslist fallback:</strong> Search alerts connected
            </span>
            <Link href="/capture">Capture listing manually</Link>
          </div>
          <details className="custom-source-configurator">
            <summary>Add another housing website</summary>
            <div className="custom-source-form">
              <label>
                <span>Source name</span>
                <input
                  type="text"
                  value={customSourceName}
                  disabled={running}
                  maxLength={160}
                  onChange={(event) => setCustomSourceName(event.target.value)}
                />
              </label>
              <label>
                <span>Starting URL</span>
                <input
                  type="url"
                  value={customStartingUrl}
                  disabled={running}
                  placeholder="https://housing.example.edu/search"
                  onChange={(event) => setCustomStartingUrl(event.target.value)}
                />
              </label>
              <label>
                <span>Allowed domain</span>
                <input
                  type="text"
                  value={customAllowedDomain}
                  disabled={running}
                  placeholder="housing.example.edu"
                  onChange={(event) => setCustomAllowedDomain(event.target.value)}
                />
              </label>
              <label>
                <span>Login required</span>
                <select
                  value={customLoginRequired}
                  disabled={running}
                  onChange={(event) =>
                    setCustomLoginRequired(event.target.value as HousingSourceLoginRequirement)
                  }
                >
                  <option value="yes">Yes</option>
                  <option value="no">No</option>
                  <option value="unknown">Unknown</option>
                </select>
              </label>
              <label className="custom-source-toggle">
                <input
                  type="checkbox"
                  checked={customDefaultInclude}
                  disabled={running}
                  onChange={(event) => setCustomDefaultInclude(event.target.checked)}
                />
                <span>Include by default</span>
              </label>
              <button
                className="secondary-button"
                type="button"
                disabled={running}
                onClick={saveCustomSource}
              >
                Save housing source
              </button>
            </div>
            {customConfiguration ? (
              <p className="custom-source-saved">
                Saved for <strong>{customConfiguration.allowedDomain}</strong>. Vera will remain on
                this exact domain.
              </p>
            ) : null}
            {customSourceError ? <p className="form-error">{customSourceError}</p> : null}
          </details>
          {showCurrentPageFallback ? (
            <div className="current-page-fallback" role="status">
              <p>Vera could not recognize repeated housing cards on this layout.</p>
              <button
                className="secondary-button"
                type="button"
                disabled={running || !browserReady}
                onClick={() => void run(["custom_website"], status?.searchRunId ?? null, true)}
              >
                Capture current listing page
              </button>
            </div>
          ) : null}
          {browserSourceSelected ? (
            <p
              className={`browser-readiness ${browserReady ? "browser-readiness-ready" : "browser-readiness-blocked"}`}
              role="status"
            >
              <strong>OpenClaw:</strong> {browserReadinessCopy(browserReadiness)}
            </p>
          ) : null}
          <label className="live-search-confirmation">
            <input
              type="checkbox"
              checked={confirmed}
              disabled={
                running ||
                selectedProfile === null ||
                selectedSources.length === 0 ||
                (browserSourceSelected && !browserReady)
              }
              onChange={(event) => setConfirmed(event.target.checked)}
            />
            <span>
              I am starting this read-only search now. I have explicitly shared exactly one
              dedicated Vera Search tab; source login remains a manual browser action.
            </span>
          </label>
        </div>
        <div className="live-search-actions">
          <button
            className="primary-button live-search-button"
            type="button"
            disabled={
              running ||
              !confirmed ||
              selectedProfile === null ||
              selectedSources.length === 0 ||
              (browserSourceSelected && !browserReady)
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
            {failedSources.length > 0 && (!running || recoveryReady) ? (
              <button
                className="secondary-button"
                type="button"
                onClick={() => void run(failedSources, status.searchRunId)}
              >
                {rentalResearchRecoveryLabel(
                  status.sources.filter((source) => failedSources.includes(source.source))
                )}
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
        <ListingDashboard
          initialListings={initialListings}
          refreshKey={refreshKey}
          researchRunning={running}
          observedSince={observedSince}
          freshSearch={!staticAcceptanceSnapshot}
        />
      </section>
    </>
  );
}
