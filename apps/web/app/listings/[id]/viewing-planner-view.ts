import {
  CalendarApiErrorResponseSchema,
  CreateApprovedCalendarHoldResponseSchema,
  type AvailabilityCheckState,
  type CalendarApiErrorResponse,
  type CalendarCapability,
  type CalendarCapabilityGrantState,
  type CalendarHold,
  type CalendarHoldApprovalPreview,
  type CancelViewingResponse,
  type CreateApprovedCalendarHoldResponse,
  type CreateViewingProposalsResponse,
  type ProposedViewingWindow,
  type RescheduleViewingResponse
} from "@vera/domain";

export type CreateHoldResponseInterpretation =
  | { readonly kind: "result"; readonly result: CreateApprovedCalendarHoldResponse }
  | { readonly kind: "error"; readonly error: CalendarApiErrorResponse }
  | { readonly kind: "invalid" };

export function interpretCreateHoldResponse(
  status: number,
  body: unknown
): CreateHoldResponseInterpretation {
  if (status === 201 || status === 409) {
    const result = CreateApprovedCalendarHoldResponseSchema.safeParse(body);
    if (result.success) return { kind: "result", result: result.data };
  }
  const error = CalendarApiErrorResponseSchema.safeParse(body);
  return error.success ? { kind: "error", error: error.data } : { kind: "invalid" };
}

export function approvalIntent(
  holdCapabilityState: CalendarCapabilityGrantState,
  demoMode: boolean
): "approve" | "calendar_hold_creation" {
  return demoMode || holdCapabilityState === "granted" ? "approve" : "calendar_hold_creation";
}

export function formatViewingWindow(window: ProposedViewingWindow): {
  readonly date: string;
  readonly time: string;
} {
  const date = new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: window.timeZone
  }).format(new Date(window.startsAt));
  const time = new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: window.timeZone,
    timeZoneName: "short"
  });
  return {
    date,
    time: `${time.format(new Date(window.startsAt))}–${time.format(new Date(window.endsAt))}`
  };
}

export function formatViewingCheckedAt(window: ProposedViewingWindow, demoMode: boolean): string {
  if (window.checkedAt === null) return "No Calendar check recorded";
  const prefix = demoMode ? "Simulated check" : "Checked";
  const checkedAt = new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: window.timeZone,
    timeZoneName: "short"
  }).format(new Date(window.checkedAt));
  return `${prefix} ${checkedAt}`;
}

export type PlannerRecoveryAction =
  | "connect"
  | "reconnect"
  | "retry"
  | "edit_availability"
  | "continue_with_warning"
  | "choose_replacement";

export interface PlannerRecoveryOption {
  readonly action: PlannerRecoveryAction;
  readonly label: string;
}

export type ViewingPlannerState =
  | { readonly kind: "idle" }
  | { readonly kind: "loading_proposals" }
  | { readonly kind: "proposals"; readonly result: CreateViewingProposalsResponse }
  | { readonly kind: "loading_preview"; readonly viewingId: string }
  | { readonly kind: "preview"; readonly preview: CalendarHoldApprovalPreview }
  | { readonly kind: "approving"; readonly preview: CalendarHoldApprovalPreview }
  | { readonly kind: "creating"; readonly preview: CalendarHoldApprovalPreview }
  | { readonly kind: "confirmation_required"; readonly preview: CalendarHoldApprovalPreview }
  | {
      readonly kind: "conflict_detected";
      readonly replacementViewingId: string;
      readonly windows: readonly ProposedViewingWindow[];
    }
  | { readonly kind: "created"; readonly hold: CalendarHold; readonly duplicate: boolean }
  | { readonly kind: "rescheduled"; readonly result: RescheduleViewingResponse }
  | { readonly kind: "cancelled"; readonly result: CancelViewingResponse }
  | {
      readonly kind: "error";
      readonly message: string;
      readonly recoveryAction: PlannerRecoveryAction;
      readonly authorizationCapability?: CalendarCapability | null;
    };

export interface ViewingPlannerPreviewDetails {
  readonly title: string;
  readonly time: string;
  readonly timeZone: string;
  readonly address: string;
  readonly notes: string;
  readonly reminders: string;
  readonly notifications: "None";
}

export interface ViewingPlannerView {
  readonly availabilityHeading: string;
  readonly availabilityDetail: string;
  readonly recoveryAction: PlannerRecoveryAction | null;
  readonly recoveryActions: readonly PlannerRecoveryAction[];
  readonly recoveryOptions: readonly PlannerRecoveryOption[];
  readonly windows: readonly ProposedViewingWindow[];
  readonly preview: CalendarHoldApprovalPreview | null;
  readonly previewDetails: ViewingPlannerPreviewDetails | null;
  readonly replacementViewingId: string | null;
  readonly sideEffectDisclosure: "No landlord will be invited or notified";
  readonly liveRegionMessage: string;
  readonly externalCleanupWarning: string | null;
  readonly regionLabel: "Viewing planner";
  readonly windowGroupLabel: "Proposed viewing windows";
  readonly liveRegionRole: "status" | "alert";
  readonly ariaLive: "polite" | "assertive";
  readonly ariaAtomic: true;
}

const CHECKED_HEADING = "Checked against your primary Google Calendar";
const UNCHECKED_HEADING = "Calendar conflicts not checked";
const SIDE_EFFECT_DISCLOSURE = "No landlord will be invited or notified";
const EXTERNAL_CLEANUP_WARNING = "The Google Calendar hold may still exist; remove it manually.";
const DEMO_FIXTURE_DISCLOSURE = "Demo Calendar fixture—no Google account or API is being used";

const recoveryLabels: Readonly<Record<PlannerRecoveryAction, string>> = {
  connect: "Connect Calendar",
  reconnect: "Reconnect Calendar",
  retry: "Retry Calendar check",
  edit_availability: "Edit availability",
  continue_with_warning: "Continue with conflict warning",
  choose_replacement: "Choose a replacement time"
};

interface AvailabilityPresentation {
  readonly heading: string;
  readonly detail: string;
  readonly actions: readonly PlannerRecoveryAction[];
}

function availabilityPresentation(
  state: AvailabilityCheckState,
  windowsAvailable: boolean
): AvailabilityPresentation {
  if (state === "checked") {
    return windowsAvailable
      ? {
          heading: CHECKED_HEADING,
          detail:
            "These proposed times were checked against the connected account's primary calendar.",
          actions: []
        }
      : {
          heading: CHECKED_HEADING,
          detail:
            "No viewing windows remain after applying your availability rules and primary-calendar conflicts.",
          actions: ["edit_availability"]
        };
  }

  const actions = degradedActions(state, windowsAvailable);
  if (state === "scope_not_granted") {
    return {
      heading: UNCHECKED_HEADING,
      detail:
        "Calendar conflict checking is not enabled. These times use Vera's weekly availability rules only.",
      actions
    };
  }
  if (state === "google_disconnected") {
    return {
      heading: UNCHECKED_HEADING,
      detail:
        "Google Calendar is disconnected. These times use Vera's weekly availability rules only.",
      actions
    };
  }
  if (state === "google_temporarily_unavailable") {
    return {
      heading: UNCHECKED_HEADING,
      detail:
        "Google Calendar could not be checked right now. Retry, or continue only after reviewing the conflict warning.",
      actions
    };
  }
  if (state === "stale") {
    return {
      heading: UNCHECKED_HEADING,
      detail:
        "The previous Calendar check is stale. Retry, or continue only after reviewing the conflict warning.",
      actions
    };
  }
  return {
    heading: UNCHECKED_HEADING,
    detail:
      "These times use Vera's weekly availability rules only. Calendar conflicts have not been checked.",
    actions
  };
}

function degradedActions(
  state: Exclude<AvailabilityCheckState, "checked">,
  windowsAvailable: boolean
): readonly PlannerRecoveryAction[] {
  const finish = windowsAvailable ? ([] as const) : (["edit_availability"] as const);

  if (state === "scope_not_granted") return ["connect", ...finish];
  if (state === "google_disconnected") return ["reconnect", ...finish];
  if (state === "google_temporarily_unavailable" || state === "stale") {
    return ["retry", ...finish];
  }
  return finish;
}

function remindersLabel(reminders: readonly number[]): string {
  if (reminders.length === 0) return "None";
  const values = reminders.map((minutes) => `${minutes} minute${minutes === 1 ? "" : "s"}`);
  if (values.length === 1) return `${values[0]} before`;
  return `${values.slice(0, -1).join(", ")} and ${values.at(-1)} before`;
}

function previewDetails(preview: CalendarHoldApprovalPreview): ViewingPlannerPreviewDetails {
  return {
    title: preview.title,
    time: preview.localTimeLabel,
    timeZone: preview.timeZone,
    address: preview.normalizedAddress,
    notes: preview.description,
    reminders: remindersLabel(preview.remindersMinutesBeforeStart),
    notifications: "None"
  };
}

interface ViewInput {
  readonly heading: string;
  readonly detail: string;
  readonly actions?: readonly PlannerRecoveryAction[];
  readonly windows?: readonly ProposedViewingWindow[];
  readonly preview?: CalendarHoldApprovalPreview | null;
  readonly replacementViewingId?: string | null;
  readonly liveRegionMessage: string;
  readonly externalCleanupWarning?: string | null;
  readonly urgent?: boolean;
}

function view(input: ViewInput): ViewingPlannerView {
  const actions = input.actions ?? [];
  const preview = input.preview ?? null;
  const urgent = input.urgent ?? false;
  return {
    availabilityHeading: input.heading,
    availabilityDetail: input.detail,
    recoveryAction: actions[0] ?? null,
    recoveryActions: actions,
    recoveryOptions: actions.map((action) => ({ action, label: recoveryLabels[action] })),
    windows: input.windows ?? [],
    preview,
    previewDetails: preview === null ? null : previewDetails(preview),
    replacementViewingId: input.replacementViewingId ?? null,
    sideEffectDisclosure: SIDE_EFFECT_DISCLOSURE,
    liveRegionMessage: input.liveRegionMessage,
    externalCleanupWarning: input.externalCleanupWarning ?? null,
    regionLabel: "Viewing planner",
    windowGroupLabel: "Proposed viewing windows",
    liveRegionRole: urgent ? "alert" : "status",
    ariaLive: urgent ? "assertive" : "polite",
    ariaAtomic: true
  };
}

export function presentViewingPlanner(
  state: ViewingPlannerState,
  options: { readonly demoMode?: boolean } = {}
): ViewingPlannerView {
  const demoMode = options.demoMode ?? false;
  if (state.kind === "idle") {
    return view({
      heading: "Plan a viewing",
      detail: demoMode
        ? `Use your weekly availability with the simulated calendar. ${DEMO_FIXTURE_DISCLOSURE}.`
        : "Use your weekly availability to propose viewing times.",
      liveRegionMessage: "Viewing planner ready."
    });
  }

  if (state.kind === "loading_proposals") {
    return view({
      heading: "Checking viewing availability",
      detail: "Applying your duration, notice, travel, and buffer rules.",
      liveRegionMessage:
        "Checking viewing availability against your rules and permitted Calendar data."
    });
  }

  if (state.kind === "proposals") {
    const presentation = availabilityPresentation(
      state.result.state,
      state.result.windows.length > 0
    );
    const checkedInDemo = demoMode && state.result.state === "checked";
    return view({
      heading: checkedInDemo
        ? "Checked against the simulated primary Calendar fixture"
        : presentation.heading,
      detail: checkedInDemo
        ? `${DEMO_FIXTURE_DISCLOSURE}. These times were checked against simulated free/busy blocks.`
        : presentation.detail,
      actions: presentation.actions,
      windows: state.result.windows,
      liveRegionMessage: checkedInDemo
        ? `Checked against the simulated primary Calendar fixture. ${DEMO_FIXTURE_DISCLOSURE}.`
        : `${presentation.heading}. ${presentation.detail}`
    });
  }

  if (state.kind === "loading_preview") {
    return view({
      heading: "Preparing the exact hold preview",
      detail: "Vera is rebuilding the Calendar effect from the selected viewing.",
      liveRegionMessage: "Preparing the exact private hold preview."
    });
  }

  if (state.kind === "preview" || state.kind === "approving" || state.kind === "creating") {
    const liveRegionMessage =
      state.kind === "preview"
        ? "Private hold preview ready for review."
        : state.kind === "approving"
          ? "Recording approval for the exact private hold."
          : "Creating the approved private tentative hold.";
    return view({
      heading:
        state.kind === "preview"
          ? "Review private tentative hold"
          : state.kind === "approving"
            ? "Recording hold approval"
            : "Creating private tentative hold",
      detail:
        state.kind === "creating"
          ? "Vera is completing the final Calendar conflict check before event creation."
          : "Final Calendar conflict check runs after approval, immediately before creation.",
      preview: state.preview,
      liveRegionMessage
    });
  }

  if (state.kind === "confirmation_required") {
    return view({
      heading: UNCHECKED_HEADING,
      detail:
        state.preview.warning ??
        "The final conflict check did not complete. A new explicit approval is required.",
      actions: ["continue_with_warning"],
      preview: state.preview,
      liveRegionMessage:
        "Calendar conflicts not checked. Review the warning before explicitly approving an override.",
      urgent: true
    });
  }

  if (state.kind === "conflict_detected") {
    const replacementsAvailable = state.windows.length > 0;
    return view({
      heading: "Selected time is no longer available",
      detail: replacementsAvailable
        ? "A conflict appeared during the final check. Choose one of the replacement windows."
        : "A conflict appeared during the final check. No replacement window is currently available.",
      actions: [replacementsAvailable ? "choose_replacement" : "edit_availability"],
      windows: state.windows,
      replacementViewingId: state.replacementViewingId,
      liveRegionMessage: replacementsAvailable
        ? demoMode
          ? "The selected time now conflicts with the simulated primary Calendar fixture. Replacement windows are available."
          : "The selected time now conflicts with your primary Google Calendar. Replacement windows are available."
        : demoMode
          ? "The selected time now conflicts with the simulated primary Calendar fixture, and no replacement is available."
          : "The selected time now conflicts with your primary Google Calendar, and no replacement is available.",
      urgent: true
    });
  }

  if (state.kind === "created") {
    return view({
      heading: demoMode ? "Simulated tentative hold created" : "Tentative hold created",
      detail: demoMode
        ? state.duplicate
          ? "The existing simulated hold was returned; no duplicate fixture event was created. Nothing was written to Google Calendar."
          : "Simulated tentative hold created—nothing was written to Google Calendar."
        : state.duplicate
          ? "The existing private tentative hold was returned; no duplicate event was created."
          : "The private tentative hold was created on your primary Google Calendar.",
      liveRegionMessage: demoMode
        ? "Simulated tentative hold created—nothing was written to Google Calendar"
        : state.duplicate
          ? "Tentative hold already existed—no duplicate event was created"
          : "Tentative hold created—no landlord was invited or notified"
    });
  }

  if (state.kind === "rescheduled" || state.kind === "cancelled") {
    const rescheduled = state.kind === "rescheduled";
    const externalCleanupWarning = state.result.externalCleanupRequired
      ? demoMode
        ? "The simulated fixture hold may still exist in this demo session; no Google Calendar event exists."
        : EXTERNAL_CLEANUP_WARNING
      : null;
    return view({
      heading: rescheduled ? "Viewing rescheduled in Vera" : "Viewing cancelled in Vera",
      detail: rescheduled
        ? demoMode
          ? "The schedule changed in Vera only; the simulated fixture event was not updated or deleted."
          : "The schedule changed in Vera only; the prior Google event was not updated or deleted."
        : demoMode
          ? "The viewing was cancelled in Vera only; the simulated fixture event was not deleted."
          : "The viewing was cancelled in Vera only; the Google event was not deleted.",
      actions:
        rescheduled && state.result.viewing.proposedWindows.length > 0
          ? ["choose_replacement"]
          : [],
      windows: rescheduled ? state.result.viewing.proposedWindows : [],
      replacementViewingId: rescheduled ? state.result.viewing.id : null,
      liveRegionMessage: rescheduled
        ? "Viewing rescheduled in Vera."
        : "Viewing cancelled in Vera.",
      externalCleanupWarning,
      urgent: externalCleanupWarning !== null
    });
  }

  return view({
    heading: "Viewing planner needs attention",
    detail: state.message,
    actions: [state.recoveryAction],
    liveRegionMessage: state.message,
    urgent: true
  });
}
