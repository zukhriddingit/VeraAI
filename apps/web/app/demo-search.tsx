"use client";

import {
  DEMO_SEARCH_COMPLETION_SUMMARY,
  DemoRunResponseSchema,
  DemoStatusResponseSchema,
  type DemoStatusResponse
} from "@vera/domain";
import { useState } from "react";

import type { CockpitInitialState } from "../lib/cockpit-read-model";
import { ListingDashboard } from "./listing-dashboard";

type DemoState =
  | { kind: "loading" }
  | { kind: "ready"; status: DemoStatusResponse }
  | { kind: "error"; message: string };

const currency = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0
});

function money(cents: number | null): string {
  return cents === null ? "Unknown" : currency.format(cents / 100);
}

async function requestDemoStatus(signal?: AbortSignal): Promise<DemoStatusResponse> {
  const response = await fetch("/api/demo/status", {
    cache: "no-store",
    ...(signal ? { signal } : {})
  });
  if (!response.ok) throw new Error("status unavailable");
  return DemoStatusResponseSchema.parse((await response.json()) as unknown);
}

export function DemoSearch({ initialState }: { initialState: CockpitInitialState }) {
  const [state, setState] = useState<DemoState>(() =>
    initialState.kind === "unavailable"
      ? { kind: "error", message: initialState.message }
      : initialState.demoStatus
        ? { kind: "ready", status: initialState.demoStatus }
        : { kind: "error", message: "" }
  );
  const [running, setRunning] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  async function loadStatus(): Promise<void> {
    try {
      setState({ kind: "ready", status: await requestDemoStatus() });
    } catch {
      setState({
        kind: "error",
        message: "Demo data is not ready. Run pnpm demo:reset and pnpm demo:seed."
      });
    }
  }

  async function runSearch() {
    setRunning(true);
    try {
      const response = await fetch("/api/demo/run", { method: "POST" });
      if (!response.ok) throw new Error("search failed");
      const run = DemoRunResponseSchema.parse((await response.json()) as unknown);
      setState((current) =>
        current.kind === "ready"
          ? {
              kind: "ready",
              status: { ...current.status, status: "completed", run }
            }
          : current
      );
      setRefreshKey((current) => current + 1);
    } catch {
      setState({
        kind: "error",
        message:
          "Demo search stopped safely. Reset and seed the deterministic demo before retrying."
      });
    } finally {
      setRunning(false);
    }
  }

  if (!initialState.demoMode && initialState.kind === "ready") {
    return <ListingDashboard initialListings={initialState.listingCollection.listings} />;
  }

  if (state.kind === "loading") {
    return <div className="listing-message">Preparing the sanitized demo search…</div>;
  }

  if (state.kind === "error") {
    return (
      <div className="listing-message listing-message-warning" role="alert">
        <strong>Demo unavailable.</strong>
        <span>{state.message}</span>
        <button className="secondary-button" type="button" onClick={() => void loadStatus()}>
          Check again
        </button>
      </div>
    );
  }

  const { profile, run } = state.status;
  return (
    <>
      <section className="profile-card" aria-labelledby="profile-heading">
        <div className="profile-card-copy">
          <p className="eyebrow">Sanitized search profile</p>
          <h2 id="profile-heading">{profile.name}</h2>
          <p>
            A focused September search using only fictional Harbor City data and deterministic
            criteria.
          </p>
        </div>
        <dl className="profile-facts">
          <div>
            <dt>Budget</dt>
            <dd>
              {money(profile.targetMonthlyTotalCents)} target ·{" "}
              {money(profile.absoluteMonthlyMaximumCents)} max
            </dd>
          </div>
          <div>
            <dt>Home</dt>
            <dd>{String(profile.minimumBedrooms ?? 0)}+ bedroom · cat required</dd>
          </div>
          <div>
            <dt>Move-in</dt>
            <dd>September 2026</dd>
          </div>
          <div>
            <dt>Must-haves</dt>
            <dd>Laundry · bicycle storage preferred</dd>
          </div>
        </dl>
      </section>

      <section className="demo-search-card" aria-labelledby="demo-search-heading">
        <div>
          <p className="eyebrow">Offline fixture search</p>
          <h2 id="demo-search-heading">
            {run ? "Your strongest matches are ready." : "See what Vera finds."}
          </h2>
          <p>
            {run
              ? `${DEMO_SEARCH_COMPLETION_SUMMARY}.`
              : "Run the sanitized fixture connector through Vera’s normal policy and ingestion path."}
          </p>
        </div>
        <button
          className="primary-button demo-run-button"
          type="button"
          disabled={running || run !== null}
          onClick={() => void runSearch()}
        >
          {running ? "Analyzing 12 records…" : run ? "Demo search complete" : "Run demo search"}
        </button>
      </section>

      <section className="listings-section" aria-labelledby="listings-heading">
        <div className="listings-heading">
          <div>
            <p className="eyebrow">Canonical listing inbox</p>
            <h2 id="listings-heading">Homes worth reviewing</h2>
          </div>
          <p>Compare fit, missing facts, risk evidence, and duplicate sources before deciding.</p>
        </div>
        <ListingDashboard
          initialListings={
            initialState.kind === "ready" ? initialState.listingCollection.listings : []
          }
          refreshKey={refreshKey}
          demoMode
        />
      </section>
    </>
  );
}
