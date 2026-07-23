import { describe, expect, it } from "vitest";

import { findMutationBoundaryViolations } from "./verify-web-mutation-boundaries.ts";

function files(source: string): ReadonlyMap<string, string> {
  return new Map([["apps/web/app/api/example/route.ts", source]]);
}

describe("web mutation boundary verifier", () => {
  it("accepts authenticated same-origin bounded and bodyless mutations", () => {
    const violations = findMutationBoundaryViolations(
      files(`
        export async function POST(request: Request) {
          const session = await requireVeraSession(request.headers);
          assertSameOriginMutation(request);
          const input = await readBoundedJson(request, { maxBytes: 16_384 });
          return mutate(session, input);
        }
        export async function DELETE(request: Request) {
          const session = await requireVeraSession(request.headers);
          assertSameOriginMutation(request);
          return revoke(session);
        }
      `)
    );
    expect(violations).toEqual([]);
  });

  it("accepts the Calendar service authentication and bounded-reader wrappers", () => {
    expect(
      findMutationBoundaryViolations(
        files(`
          export async function PUT(request: Request) {
            const service = await calendarRouteService(request);
            assertSameOriginMutation(request);
            const input = await readCalendarMutationJson(request);
            return service.update(input);
          }
        `)
      )
    ).toEqual([]);
  });

  it("reports missing controls, direct body buffering, and unsafe ordering per handler", () => {
    const violations = findMutationBoundaryViolations(
      files(`
        export async function POST(request: Request) {
          const input = await request.json();
          assertSameOriginMutation(request);
          return input;
        }
        export async function PATCH(request: Request) {
          assertSameOriginMutation(request);
          const session = await requireVeraSession(request.headers);
          return session;
        }
      `)
    );
    expect(violations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ handler: "POST", message: "mutation route must authenticate" }),
        expect.objectContaining({
          handler: "POST",
          message: "mutation route must use a bounded JSON reader"
        }),
        expect.objectContaining({
          handler: "PATCH",
          message: "mutation route must authenticate before checking origin"
        })
      ])
    );
  });

  it("ignores read-only handlers and reports every unsafe mutation in one file", () => {
    const violations = findMutationBoundaryViolations(
      files(`
        export async function GET(request: Request) { return request.url; }
        export async function POST(request: Request) { return request.text(); }
        export async function DELETE(request: Request) { return request.arrayBuffer(); }
      `)
    );
    expect(violations.filter((entry) => entry.handler === "GET")).toEqual([]);
    expect(new Set(violations.map((entry) => entry.handler))).toEqual(new Set(["POST", "DELETE"]));
  });
});
