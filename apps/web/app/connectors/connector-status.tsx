"use client";

import { ConnectorStatusCollectionResponseSchema, type ConnectorStatus } from "@vera/domain";
import { useEffect, useState } from "react";

type StatusState =
  | { kind: "loading" }
  | { kind: "ready"; connectors: readonly ConnectorStatus[] }
  | { kind: "error"; message: string };

export function ConnectorStatusList() {
  const [state, setState] = useState<StatusState>({ kind: "loading" });

  useEffect(() => {
    const controller = new AbortController();

    async function loadStatus(): Promise<void> {
      try {
        const response = await fetch("/api/connectors", {
          cache: "no-store",
          signal: controller.signal
        });

        if (!response.ok) {
          throw new Error("Connector policy status is unavailable.");
        }

        const body: unknown = await response.json();
        const result = ConnectorStatusCollectionResponseSchema.parse(body);
        setState({ kind: "ready", connectors: result.connectors });
      } catch (error: unknown) {
        if (error instanceof DOMException && error.name === "AbortError") {
          return;
        }

        setState({
          kind: "error",
          message: error instanceof Error ? error.message : "Connector status is unavailable."
        });
      }
    }

    void loadStatus();
    return () => controller.abort();
  }, []);

  if (state.kind === "loading") {
    return (
      <div className="listing-message" role="status">
        Loading connector policy…
      </div>
    );
  }

  if (state.kind === "error") {
    return (
      <div className="listing-message listing-message-warning" role="alert">
        {state.message}
      </div>
    );
  }

  return (
    <div className="connector-grid" aria-live="polite">
      {state.connectors.map((connector) => (
        <article className="connector-card" key={connector.connectorId}>
          <div className="connector-card-heading">
            <h2>{connector.displayName}</h2>
            <span className={`connector-state connector-state-${connector.status}`}>
              {connector.status}
            </span>
          </div>
          <p>{connector.detail}</p>
          <dl>
            <div>
              <dt>Network access</dt>
              <dd>{connector.networkAccess ? "enabled" : "disabled"}</dd>
            </div>
            <div>
              <dt>Capabilities</dt>
              <dd>{connector.capabilities.join(", ") || "none"}</dd>
            </div>
          </dl>
        </article>
      ))}
    </div>
  );
}
