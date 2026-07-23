import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  findCalendarBoundaryViolations,
  findCalendarSourceViolations,
  verifyCalendarSource
} from "./verify-calendar-boundaries.ts";

const directories: string[] = [];

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("Calendar static boundary verifier", () => {
  it("allows only the two incremental founder scopes", () => {
    expect(() =>
      verifyCalendarSource(`
        export const scopes = [
          "https://www.googleapis.com/auth/calendar.freebusy",
          "https://www.googleapis.com/auth/calendar.events.owned"
        ];
      `)
    ).not.toThrow();

    for (const scope of [
      "https://www.googleapis.com/auth/calendar",
      "https://www.googleapis.com/auth/calendar.readonly",
      "https://www.googleapis.com/auth/calendar.events",
      "https://www.googleapis.com/auth/calendar.calendarlist.readonly"
    ]) {
      expect(() => verifyCalendarSource(`export const scope = ${JSON.stringify(scope)};`)).toThrow(
        scope
      );
    }
  });

  it("rejects event mutation/list and message-send capabilities", () => {
    for (const source of [
      "calendar.events.delete({});",
      "calendar.events.update({});",
      "calendar.events.patch({});",
      "calendar.events.move({});",
      "calendar.events.list({});",
      "calendar.events.send({});",
      "gmail.users.messages.send({});",
      "gmail.users.drafts.send({});",
      "transport.sendMail({});",
      "fetch('https://gmail.googleapis.test/v1/users/me/messages/send');",
      "export const capability = 'events.delete';"
    ]) {
      expect(() => verifyCalendarSource(source)).toThrow();
    }
  });

  it("rejects dynamic and aliased event or send operations", () => {
    for (const source of [
      "const operation = input.operation; calendar.events[operation]({});",
      "const remove = calendar.events.delete; remove({});",
      "const { delete: remove } = calendar.events; remove({});",
      "const eventApi = calendar.events; eventApi.update({});",
      "const dispatch = gmail.users.messages.send; dispatch({});",
      "const operation = input.operation; gmail.users.drafts[operation]({});"
    ]) {
      expect(() => verifyCalendarSource(source)).toThrow(/(?:event|send)_operation/u);
    }

    expect(() =>
      verifyCalendarSource(
        'calendar.events.get({}); calendar.events.insert({ sendUpdates: "none", requestBody: {} });'
      )
    ).not.toThrow();
  });

  it("rejects Calendar-list access in code and capability strings", () => {
    expect(() => verifyCalendarSource("calendar.calendarList.list();")).toThrow(/calendar_list/u);
    expect(() =>
      verifyCalendarSource("export const scope = 'calendar.calendarlist.readonly';")
    ).toThrow(/calendar\.calendarlist\.readonly/u);
  });

  it("allows strict empty attendee contracts but rejects nonempty or provider-body attendees", () => {
    expect(() =>
      verifyCalendarSource(`
        const schema = z.strictObject({ attendees: z.tuple([]) });
        const request = { attendees: [] };
        interface SafeRequest { readonly attendees: readonly []; }
        export { request, schema };
      `)
    ).not.toThrow();
    expect(() => verifyCalendarSource("const request = { attendees: [landlord] }; ")).toThrow(
      /attendees/u
    );
    expect(() => verifyCalendarSource("const request = { attendees: input.attendees }; ")).toThrow(
      /attendees/u
    );
    expect(() =>
      verifyCalendarSource(`
        calendar.events.insert({
          sendUpdates: "none",
          requestBody: { attendees: [] }
        });
      `)
    ).toThrow(/provider request body must omit attendees/u);
    expect(() =>
      verifyCalendarSource("const providerEnvelope = { requestBody: { attendees: [] } };")
    ).toThrow(/provider request body must omit attendees/u);
    expect(() =>
      verifyCalendarSource(`
        calendar.events.insert({
          sendUpdates: "none",
          requestBody: unsafeBody
        });
      `)
    ).toThrow(/requestBody must be explicit/u);
    expect(() =>
      verifyCalendarSource(`
        const attendees = [];
        const envelope = { requestBody: { attendees } };
      `)
    ).toThrow(/provider request body must omit attendees/u);
  });

  it("permits only statically closed notification behavior", () => {
    expect(() =>
      verifyCalendarSource(`
        const schema = z.strictObject({ sendUpdates: z.literal("none") });
        const request = { sendUpdates: "none" };
        interface SafeRequest { readonly sendUpdates: "none"; }
      `)
    ).not.toThrow();
    for (const source of [
      "const request = { sendUpdates: 'all' };",
      "const request = { sendUpdates: 'externalOnly' };",
      "const request = { sendUpdates: userInput };",
      "const sendUpdates = userInput; const request = { sendUpdates };"
    ]) {
      expect(() => verifyCalendarSource(source)).toThrow(/sendUpdates/u);
    }
    expect(() =>
      verifyCalendarSource(`
        const unsafe = { sendUpdates: "all" };
        calendar.events.insert({ ...unsafe, requestBody: {} });
      `)
    ).toThrow(/parameters cannot spread data/u);
  });

  it("rejects token and secret values passed to common logging sinks", () => {
    for (const source of [
      "console.log(refreshToken);",
      "logger.log(refreshToken);",
      "logger.info({ accessToken });",
      "audit.warn({ secret: clientSecret });",
      "process.stderr.write(authorizationCode);"
    ]) {
      expect(() => verifyCalendarSource(source)).toThrow(/secret_logging/u);
    }

    expect(() =>
      verifyCalendarSource(`
        const clientSecret = environment.CLIENT_SECRET;
        logger.info({ refreshTokenPresent: refreshToken !== null });
        export { clientSecret };
      `)
    ).not.toThrow();
  });

  it("does not confuse explanatory attendee text with an executable attendee field", () => {
    expect(findCalendarSourceViolations("export const copy = 'No attendees:';")).toEqual([]);
  });

  it("excludes tests and fixtures while scanning production files", () => {
    const root = mkdtempSync(join(tmpdir(), "vera-calendar-boundary-"));
    directories.push(root);
    mkdirSync(join(root, "apps/web/lib"), { recursive: true });
    writeFileSync(
      join(root, "apps/web/lib/calendar.ts"),
      'export const scope = "https://www.googleapis.com/auth/calendar.freebusy";\n'
    );
    writeFileSync(
      join(root, "apps/web/lib/calendar.unit.test.ts"),
      'calendar.events.delete({ sendUpdates: "all" });\n'
    );

    expect(
      findCalendarBoundaryViolations(
        ["apps/web/lib/calendar.ts", "apps/web/lib/calendar.unit.test.ts"],
        root
      )
    ).toEqual([]);
  });

  it("reports production violations with file and rule metadata", () => {
    const root = mkdtempSync(join(tmpdir(), "vera-calendar-boundary-"));
    directories.push(root);
    mkdirSync(join(root, "packages/calendar/src"), { recursive: true });
    writeFileSync(
      join(root, "packages/calendar/src/unsafe.ts"),
      "export function deleteEvent() {}\n"
    );

    expect(findCalendarBoundaryViolations(["packages/calendar/src/unsafe.ts"], root)).toEqual([
      expect.objectContaining({
        file: "packages/calendar/src/unsafe.ts",
        line: 1,
        rule: "event_operation",
        detail: "deleteEvent"
      })
    ]);
  });

  it("rejects hidden production send routes even without a send call", () => {
    const root = mkdtempSync(join(tmpdir(), "vera-calendar-boundary-"));
    directories.push(root);
    mkdirSync(join(root, "apps/web/app/api/messages/send"), { recursive: true });
    writeFileSync(
      join(root, "apps/web/app/api/messages/send/route.ts"),
      "export function POST() {}\n"
    );

    expect(
      findCalendarBoundaryViolations(["apps/web/app/api/messages/send/route.ts"], root)
    ).toEqual([
      expect.objectContaining({
        rule: "send_route",
        detail: "API send routes are forbidden"
      })
    ]);
  });
});
