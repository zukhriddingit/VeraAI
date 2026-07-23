"use client";

import {
  BrowserAgentStatusResponseSchema,
  CreateCurrentTabCaptureResponseSchema,
  type BrowserAgentStatusResponse
} from "@vera/domain";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

const readinessLabels: Record<BrowserAgentStatusResponse["readiness"], string> = {
  not_configured: "Not configured",
  pairing_required: "Pairing required",
  capability_approval_required: "Capability approval required",
  online_ready: "Online and ready",
  offline: "Offline",
  manual_login_required: "Manual login required",
  manual_blocker: "Manual action required",
  version_incompatible: "Version incompatible",
  disabled_by_policy: "Disabled by policy"
};

async function requestHash(): Promise<string> {
  const input = new TextEncoder().encode(crypto.randomUUID());
  const digest = await crypto.subtle.digest("SHA-256", input);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function BrowserAgentPanel({
  initialStatus
}: {
  readonly initialStatus: BrowserAgentStatusResponse;
}) {
  const [status, setStatus] = useState(initialStatus);
  const [url, setUrl] = useState("");
  const [confirmations, setConfirmations] = useState([false, false, false, false]);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const node = status.node;
  const allConfirmed = confirmations.every(Boolean);
  const canCapture = status.readiness === "online_ready" && node?.selectedProfileId && allConfirmed;
  const currentJobId = status.currentJob?.id ?? null;

  useEffect(() => {
    if (
      !currentJobId ||
      [
        "completed",
        "permanently_failed",
        "manual_action_required",
        "deferred_node_offline",
        "cancelled_by_policy"
      ].includes(status.currentJob?.status ?? "")
    )
      return;
    const timer = window.setInterval(() => {
      void fetch("/api/integrations/browser-agent/status", { cache: "no-store" })
        .then((response) => response.json())
        .then((body: unknown) => {
          const parsed = BrowserAgentStatusResponseSchema.safeParse(body);
          if (parsed.success) setStatus(parsed.data);
        });
    }, 1_500);
    return () => window.clearInterval(timer);
  }, [currentJobId, status.currentJob?.status]);

  const recovery = useMemo(() => {
    if (status.currentJob?.manualAction) return status.currentJob.manualAction.instruction;
    if (status.readiness === "offline")
      return "Start the selected local node and wait for a fresh heartbeat.";
    if (status.readiness === "pairing_required")
      return "Approve both the OpenClaw device and node pairing requests.";
    if (status.readiness === "capability_approval_required")
      return "Approve only browser.proxy for this node.";
    return null;
  }, [status]);

  async function enable(): Promise<void> {
    setPending(true);
    setMessage(null);
    try {
      const response = await fetch("/api/integrations/browser-agent/controls", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userBrowserEnabled: true, zillowSourceEnabled: true })
      });
      const parsed = BrowserAgentStatusResponseSchema.safeParse(await response.json());
      if (!response.ok || !parsed.success) throw new Error("Browser capture could not be enabled.");
      setStatus(parsed.data);
    } catch (error: unknown) {
      setMessage(error instanceof Error ? error.message : "Browser capture could not be enabled.");
    } finally {
      setPending(false);
    }
  }

  async function capture(): Promise<void> {
    if (!node?.selectedProfileId || !canCapture) return;
    setPending(true);
    setMessage(null);
    try {
      const response = await fetch("/api/integrations/browser-agent/captures", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          nodeId: node.nodeId,
          profileId: node.selectedProfileId,
          expectedUrl: url,
          confirmation: {
            openedIntendedListing: true,
            approvesVisiblePageCapture: true,
            understandsExperimentalStatus: true,
            understandsNoExternalAction: true
          },
          requestIdempotencyKey: await requestHash()
        })
      });
      const parsed = CreateCurrentTabCaptureResponseSchema.safeParse(await response.json());
      if (!response.ok || !parsed.success) throw new Error("Current-tab capture was not queued.");
      setStatus({ ...status, currentJob: parsed.data.job });
      setMessage(
        parsed.data.inserted
          ? "Capture queued. Keep the intended tab focused."
          : "This capture request is already queued."
      );
    } catch (error: unknown) {
      setMessage(error instanceof Error ? error.message : "Current-tab capture was not queued.");
    } finally {
      setPending(false);
    }
  }

  return (
    <section
      className="settings-section browser-agent-section"
      aria-labelledby="browser-agent-heading"
    >
      <div className="settings-account-card">
        <div>
          <p className="eyebrow">Unsupported · experimental personal</p>
          <h2 id="browser-agent-heading">OpenClaw local browser</h2>
          <p>{status.privacyNotice}</p>
        </div>
        <span
          className={`integration-health integration-health-${status.readiness === "online_ready" ? "connected" : "offline"}`}
        >
          {readinessLabels[status.readiness]}
        </span>
      </div>

      <div className="integration-card-grid">
        <article className="integration-card">
          <p className="eyebrow">Policy and kill switches</p>
          <h3>Zillow current-tab capture</h3>
          <p>System: {status.controls.systemBrowserDisabled ? "disabled" : "available"}</p>
          <p>User: {status.controls.userBrowserEnabled ? "enabled" : "disabled"}</p>
          <p>Source: {status.controls.zillowSourceEnabled ? "enabled" : "disabled"}</p>
          {!status.controls.userBrowserEnabled || !status.controls.zillowSourceEnabled ? (
            <button
              className="primary-button compact-button"
              type="button"
              disabled={pending || status.controls.systemBrowserDisabled}
              onClick={() => void enable()}
            >
              Enable founder experiment
            </button>
          ) : null}
        </article>
        <article className="integration-card">
          <p className="eyebrow">Selected local boundary</p>
          <h3>{node?.nodeName ?? "No browser node"}</h3>
          <p>Node: {node?.status ?? "not registered"}</p>
          <p>Pairing: {node?.pairingState ?? "not paired"}</p>
          <p>Capability: {node?.capabilityApprovalState ?? "not approved"}</p>
          <p>Profile: {node?.selectedProfileId ?? "not selected"}</p>
          <p>OpenClaw: {node?.reportedOpenClawVersion ?? "unknown"} (tested: 2026.6.33)</p>
          <p>Last heartbeat: {node ? new Date(node.lastHeartbeatAt).toLocaleString() : "never"}</p>
          <p>
            Last capture:{" "}
            {node?.lastSuccessfulCaptureAt
              ? new Date(node.lastSuccessfulCaptureAt).toLocaleString()
              : "never"}
          </p>
        </article>
      </div>

      {recovery ? (
        <div className="settings-error" role="status">
          <strong>Action needed</strong>
          <span>{recovery}</span>
        </div>
      ) : null}
      {message ? (
        <div className="settings-error" role="status">
          <span>{message}</span>
        </div>
      ) : null}

      <article className="integration-card browser-capture-card">
        <p className="eyebrow">User-triggered, current tab only</p>
        <h3>Capture this page in Vera</h3>
        <label>
          Exact Zillow listing URL
          <input
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            placeholder="https://www.zillow.com/homedetails/.../123_zpid/"
            inputMode="url"
          />
        </label>
        {[
          "I opened and focused the intended listing.",
          "I approve capture of the visible listing page.",
          "I understand this integration is unsupported and experimental.",
          "I understand Vera will not message, apply, pay, or change the site."
        ].map((label, index) => (
          <label className="browser-confirmation" key={label}>
            <input
              type="checkbox"
              checked={confirmations[index] ?? false}
              onChange={(event) =>
                setConfirmations((current) =>
                  current.map((value, itemIndex) =>
                    itemIndex === index ? event.target.checked : value
                  )
                )
              }
            />
            {label}
          </label>
        ))}
        <button
          className="primary-button"
          type="button"
          disabled={!canCapture || pending || url.trim() === ""}
          onClick={() => void capture()}
        >
          {pending ? "Working…" : "Capture current tab"}
        </button>
      </article>

      {status.currentJob ? (
        <article className="integration-card browser-job-card">
          <p className="eyebrow">Latest capture job</p>
          <h3>{status.currentJob.status.replaceAll("_", " ")}</h3>
          <p>Created {new Date(status.currentJob.createdAt).toLocaleString()}</p>
          {status.lastSuccessfulCanonicalListingId ? (
            <Link href={`/listings/${status.lastSuccessfulCanonicalListingId}`}>
              Open imported listing
            </Link>
          ) : null}
        </article>
      ) : null}
      <p className="integration-disclosure">
        Your authorization does not override Zillow’s terms. Vera stops on login, 2FA, CAPTCHA,
        consent, bot challenges, redirects, uploads/downloads, or page-layout uncertainty.
      </p>
    </section>
  );
}
