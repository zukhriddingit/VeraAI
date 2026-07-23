import Link from "next/link";

import type {
  AvailabilityRuleSet,
  AvailabilityRuleSnapshot,
  WeeklyAvailabilityIntervals
} from "@vera/domain";

import { getCalendarIntegrationStatus } from "../../../lib/calendar-service.ts";
import { getHostedApplication } from "../../../lib/server/application.ts";
import { requireVeraPageSession } from "../../../lib/server/page-session.ts";
import { AvailabilityEditor } from "./availability-editor.tsx";

export const dynamic = "force-dynamic";

const EMPTY_WEEK: WeeklyAvailabilityIntervals = {
  "1": [],
  "2": [],
  "3": [],
  "4": [],
  "5": [],
  "6": [],
  "7": []
};

const defaultRules: AvailabilityRuleSnapshot = {
  timeZone: "America/New_York",
  weeklyIntervals: {
    ...EMPTY_WEEK,
    "1": [{ startsAt: "17:30", endsAt: "20:30" }],
    "2": [{ startsAt: "17:30", endsAt: "20:30" }],
    "3": [{ startsAt: "17:30", endsAt: "20:30" }],
    "4": [{ startsAt: "17:30", endsAt: "20:30" }],
    "5": [{ startsAt: "17:30", endsAt: "20:30" }],
    "6": [{ startsAt: "10:00", endsAt: "16:00" }]
  },
  durationMinutes: 60,
  minimumNoticeMinutes: 120,
  travelMinutes: 20,
  bufferMinutes: 10,
  remindersMinutesBeforeStart: [30],
  conflictCheckingEnabled: false,
  calendarIds: [],
  schemaVersion: 1
};

function snapshotOf(rules: AvailabilityRuleSet | null): AvailabilityRuleSnapshot {
  if (rules === null) return defaultRules;
  return {
    timeZone: rules.timeZone,
    weeklyIntervals: rules.weeklyIntervals,
    durationMinutes: rules.durationMinutes,
    minimumNoticeMinutes: rules.minimumNoticeMinutes,
    travelMinutes: rules.travelMinutes,
    bufferMinutes: rules.bufferMinutes,
    remindersMinutesBeforeStart: rules.remindersMinutesBeforeStart,
    conflictCheckingEnabled: rules.conflictCheckingEnabled,
    calendarIds: rules.calendarIds,
    schemaVersion: rules.schemaVersion
  };
}

export default async function AvailabilitySettingsPage() {
  const application = getHostedApplication();
  const context = await requireVeraPageSession();
  const [rules, integrationStatus] = await Promise.all([
    context.repositories.availabilityRuleSets.getCurrent(),
    getCalendarIntegrationStatus(
      context.repositories,
      application.calendar.configurationState,
      new Date().toISOString()
    )
  ]);

  return (
    <main>
      <nav className="page-nav" aria-label="Vera navigation">
        <Link href="/">Listings</Link>
        <Link href="/settings/integrations">Integrations</Link>
        <Link href="/settings/availability" aria-current="page">
          Viewing availability
        </Link>
      </nav>
      <header className="subpage-hero settings-hero">
        <p className="eyebrow">Settings · Viewing availability</p>
        <h1>Make viewings fit your week.</h1>
        <p className="lede">
          Vera starts with your weekly rules. Google Calendar conflict checking is optional and
          always labeled when it has—or has not—been used.
        </p>
      </header>

      <AvailabilityEditor
        initialRules={snapshotOf(rules)}
        conflictCheckingStatus={integrationStatus.conflictChecking}
      />
    </main>
  );
}
