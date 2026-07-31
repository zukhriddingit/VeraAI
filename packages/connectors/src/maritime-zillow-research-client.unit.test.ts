import { ZillowRentalResearchOutputSchema, type ZillowRentalResearchInput } from "@vera/domain";
import { describe, expect, it, vi } from "vitest";

import {
  MaritimeZillowResearchClient,
  MaritimeZillowResearchError,
  ZILLOW_RESEARCH_PROMPT_VERSION
} from "./maritime-zillow-research-client.ts";
import { REMOTE_EXTENSION_MARITIME_API_ORIGIN } from "./maritime-remote-extension-client.ts";

const now = new Date("2026-07-30T20:00:00.000Z");
const input: ZillowRentalResearchInput = {
  version: "1",
  veraRunId: "4b41df90-c5a0-4c45-94ef-1d73e6fa57bc",
  profile: {
    location: "Boston, MA",
    maximumRentUsd: 3_500,
    minimumBedrooms: 2,
    minimumBathrooms: 1
  },
  maxResults: 10,
  maxDetailPages: 5,
  startingTabReference: { kind: "target_id", value: "shared-tab-1" }
};

function output(overrides: Record<string, unknown> = {}) {
  return ZillowRentalResearchOutputSchema.parse({
    version: "1",
    veraRunId: input.veraRunId,
    state: "completed",
    pageState: "ready",
    manualAction: null,
    listings: [],
    resultCardsObserved: 0,
    detailPagesOpened: 0,
    resultPageExpansions: 0,
    startedAt: "2026-07-30T19:59:30.000Z",
    completedAt: "2026-07-30T20:00:00.000Z",
    safeActionTrail: [],
    warnings: [],
    ...overrides
  });
}

function response(value: unknown, status = 200): Response {
  return Response.json(value, { status });
}

function client(fetchImplementation: typeof fetch) {
  return new MaritimeZillowResearchClient({
    apiKey: "synthetic-browser-gateway-key",
    agentId: "dedicated-founder-browser-gateway",
    fetch: fetchImplementation,
    now: () => now
  });
}

describe("MaritimeZillowResearchClient", () => {
  it("calls the dedicated agent with one fixed versioned tool request", async () => {
    const fetchImplementation = vi
      .fn<typeof fetch>()
      .mockResolvedValue(response({ response: JSON.stringify(output()) }));
    await expect(
      client(fetchImplementation).run(input, { signal: new AbortController().signal })
    ).resolves.toEqual(output());

    const [url, init] = fetchImplementation.mock.calls[0]!;
    expect(String(url)).toBe(
      `${REMOTE_EXTENSION_MARITIME_API_ORIGIN}/api/agents/dedicated-founder-browser-gateway/chat`
    );
    expect(init).toMatchObject({ method: "POST", redirect: "error" });
    const body = JSON.parse(String(init?.body)) as {
      message: string;
      conversation_id: string;
    };
    expect(body.conversation_id).toBe(input.veraRunId);
    expect(body.message).toContain(`Protocol ${ZILLOW_RESEARCH_PROMPT_VERSION}.`);
    expect(body.message).toContain(
      "Call vera_zillow_rental_research_v1 exactly once using the exact Input JSON object."
    );
    expect(body.message).toContain(`Input JSON: ${JSON.stringify(input)}`);
    expect(body.message).not.toMatch(/targetUrl|selector|javascript|coordinates/iu);
  });

  it.each([
    ["Markdown", `\`\`\`json\n${JSON.stringify(output())}\n\`\`\``],
    ["wrong run", JSON.stringify(output({ veraRunId: "different-run" }))],
    [
      "stale result",
      JSON.stringify(
        output({
          startedAt: "2026-07-30T18:59:30.000Z",
          completedAt: "2026-07-30T19:00:00.000Z"
        })
      )
    ],
    ["unknown field", JSON.stringify({ ...output(), rawSnapshot: "forbidden" })]
  ])("rejects %s output", async (_label, raw) => {
    const fetchImplementation = vi
      .fn<typeof fetch>()
      .mockResolvedValue(response({ response: raw }));
    await expect(
      client(fetchImplementation).run(input, { signal: new AbortController().signal })
    ).rejects.toEqual(new MaritimeZillowResearchError("research_invalid_response", false));
  });

  it("validates strict input before making a provider request", async () => {
    const fetchImplementation = vi.fn<typeof fetch>();
    await expect(
      client(fetchImplementation).run({ ...input, maxResults: 11 } as ZillowRentalResearchInput, {
        signal: new AbortController().signal
      })
    ).rejects.toThrow();
    expect(fetchImplementation).not.toHaveBeenCalled();
  });

  it("maps provider, timeout, and explicit cancellation without fallback", async () => {
    const unauthorized = vi.fn<typeof fetch>().mockResolvedValue(response({}, 401));
    await expect(
      client(unauthorized).run(input, { signal: new AbortController().signal })
    ).rejects.toEqual(new MaritimeZillowResearchError("maritime_auth_failed", false));

    const controller = new AbortController();
    controller.abort();
    const aborted = vi
      .fn<typeof fetch>()
      .mockRejectedValue(new DOMException("aborted", "AbortError"));
    await expect(client(aborted).run(input, { signal: controller.signal })).rejects.toEqual(
      new MaritimeZillowResearchError("research_cancelled", false)
    );
  });
});
