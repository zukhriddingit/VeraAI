import { describe, expect, it } from "vitest";

import {
  MaritimeDispatchSchema,
  ServiceHeartbeatSchema,
  transitionMaritimeDispatch
} from "./maritime.ts";

const NOW = "2026-07-22T12:00:00.000Z";
const LATER = "2026-07-22T12:05:00.000Z";
const HASH = "a".repeat(64);

function validDispatch() {
  return {
    id: "dispatch-1",
    userId: "00000000-0000-4000-8000-000000000001",
    sourceJobId: "job-1",
    issuer: "vera-control-plane" as const,
    audience: "vera-worker",
    nonceHash: HASH,
    payloadHash: HASH,
    state: "pending_wake" as const,
    maritimeAgentId: "vera-worker",
    maritimeRunId: null,
    issuedAt: NOW,
    expiresAt: LATER,
    acceptedAt: null,
    consumedAt: null,
    rejectedAt: null,
    rejectionCode: null,
    createdAt: NOW,
    updatedAt: NOW
  };
}

describe("Maritime execution contracts", () => {
  it("accepts only Vera-issued, hashed, minimum-data dispatches", () => {
    expect(MaritimeDispatchSchema.parse(validDispatch())).toMatchObject({
      issuer: "vera-control-plane",
      state: "pending_wake"
    });
    expect(() =>
      MaritimeDispatchSchema.parse({ ...validDispatch(), issuer: "attacker" })
    ).toThrow();
    expect(() =>
      MaritimeDispatchSchema.parse({ ...validDispatch(), nonceHash: "raw-nonce" })
    ).toThrow();
    expect(() =>
      MaritimeDispatchSchema.parse({ ...validDispatch(), payload: { cookie: "secret" } })
    ).toThrow();
  });

  it("enforces the dispatch lifecycle and terminal idempotency", () => {
    const accepted = transitionMaritimeDispatch(validDispatch(), "accepted", NOW);
    expect(accepted.state).toBe("accepted");
    expect(accepted.acceptedAt).toBe(NOW);
    expect(transitionMaritimeDispatch(accepted, "accepted", LATER)).toEqual(accepted);
    expect(transitionMaritimeDispatch(accepted, "consumed", LATER).state).toBe("consumed");
    expect(() => transitionMaritimeDispatch(validDispatch(), "consumed", NOW)).toThrow(
      /cannot transition/u
    );
  });

  it("keeps health projections explicit and secret-free", () => {
    expect(
      ServiceHeartbeatSchema.parse({
        id: "heartbeat-1",
        service: "vera-worker",
        deploymentId: "worker-deployment",
        status: "ready",
        version: "0.1.0",
        checkedAt: NOW,
        expiresAt: LATER,
        safeCode: null
      })
    ).toMatchObject({ status: "ready" });
    expect(() =>
      ServiceHeartbeatSchema.parse({
        id: "heartbeat-1",
        service: "vera-worker",
        deploymentId: "worker-deployment",
        status: "ready",
        version: "0.1.0",
        checkedAt: NOW,
        expiresAt: LATER,
        safeCode: null,
        databaseUrl: "postgresql://secret"
      })
    ).toThrow();
  });
});
