import { expect, test, type Page, type Request, type Response } from "@playwright/test";

interface ProposedWindow {
  readonly startsAt: string;
  readonly endsAt: string;
  readonly state: string;
  readonly calendarsChecked: readonly string[];
  readonly requiresConflictWarning: boolean;
}

interface ProposalResponse {
  readonly state: string;
  readonly windows: readonly ProposedWindow[];
}

interface PreviewResponse {
  readonly preview: {
    readonly startsAt: string;
    readonly endsAt: string;
    readonly title: string;
    readonly timeZone: string;
    readonly normalizedAddress: string;
    readonly notifications: string;
    readonly conflictCheckOverride: boolean;
  };
}

interface HoldResponse {
  readonly kind: string;
  readonly duplicate?: boolean;
}

function isPostTo(request: Request, suffix: RegExp): boolean {
  return request.method() === "POST" && suffix.test(new URL(request.url()).pathname);
}

function isPostResponse(response: Response, suffix: RegExp): boolean {
  return isPostTo(response.request(), suffix);
}

async function revealDemoListings(page: Page): Promise<void> {
  await page.goto("/demo");
  const runSearch = page.getByRole("button", { name: "Run demo search" });
  if (await runSearch.isVisible()) await runSearch.click();
  await page.getByRole("button", { name: /All 8/u }).click();
  await expect(page.getByTestId("listing-card")).toHaveCount(8, { timeout: 20_000 });
}

test("Calendar hold gracefully degrades, requires warned approval, and stays idempotent", async ({
  page
}) => {
  const externalCalendarRequests: string[] = [];
  page.on("request", (request) => {
    const hostname = new URL(request.url()).hostname;
    if (hostname.endsWith("googleapis.com") || hostname === "accounts.google.com") {
      externalCalendarRequests.push(request.url());
    }
  });

  await revealDemoListings(page);
  await page.getByRole("link", { name: "Inspect Maple Crescent 2B" }).click();

  await expect(page.getByRole("heading", { name: "Plan a viewing" })).toBeVisible();
  await expect(page.locator(".demo-calendar-disclosure")).toContainText(
    "Demo Calendar fixture—no Google account or API is being used"
  );

  const proposalResponsePromise = page.waitForResponse((response) =>
    isPostResponse(response, /\/api\/listings\/[^/]+\/viewings$/u)
  );
  await page.getByRole("button", { name: "Suggest three viewing times" }).click();
  const proposalResponse = await proposalResponsePromise;
  expect(proposalResponse.status()).toBe(201);
  const proposal = (await proposalResponse.json()) as ProposalResponse;

  expect(proposal.state).toBe("vera_rules_only");
  expect(proposal.windows).toHaveLength(3);
  expect(
    proposal.windows.every(
      (window) =>
        window.state === "vera_rules_only" &&
        window.calendarsChecked.length === 0 &&
        window.requiresConflictWarning
    )
  ).toBe(true);
  await expect(page.getByRole("heading", { name: "Calendar conflicts not checked" })).toBeVisible();
  await expect(page.getByText("Primary Google Calendar checked")).toHaveCount(0);
  await expect(page.getByText("Simulated primary Calendar checked")).toHaveCount(0);

  const proposedWindows = page.getByRole("group", { name: "Proposed viewing windows" });
  await expect(proposedWindows.getByRole("radio")).toHaveCount(3);
  await proposedWindows.getByRole("radio").first().check();
  const selectedWindow = proposal.windows[0];
  expect(selectedWindow).toBeDefined();

  const selectionRequestPromise = page.waitForRequest((request) =>
    isPostTo(request, /\/api\/viewings\/[^/]+\/select$/u)
  );
  const previewResponsePromise = page.waitForResponse((response) =>
    isPostResponse(response, /\/api\/viewings\/[^/]+\/approval$/u)
  );
  await page.getByRole("button", { name: "Review time with conflict warning" }).click();
  const [selectionRequest, previewResponse] = await Promise.all([
    selectionRequestPromise,
    previewResponsePromise
  ]);
  expect(selectionRequest.postDataJSON()).toMatchObject({
    startsAt: selectedWindow!.startsAt,
    endsAt: selectedWindow!.endsAt
  });
  const preview = (await previewResponse.json()) as PreviewResponse;
  expect(preview.preview).toMatchObject({
    startsAt: selectedWindow!.startsAt,
    endsAt: selectedWindow!.endsAt,
    title: "Tentative viewing — 44 Maple Crescent Unit 2B",
    timeZone: "America/New_York",
    normalizedAddress: "44 Maple Crescent Unit 2B, Harbor City, MA 00003",
    notifications: "none",
    conflictCheckOverride: false
  });

  const previewPanel = page.getByLabel("Exact tentative hold preview");
  await expect(previewPanel).toContainText(preview.preview.title);
  await expect(previewPanel).toContainText(preview.preview.timeZone);
  await expect(previewPanel).toContainText(preview.preview.normalizedAddress);
  await expect(previewPanel).toContainText("Notifications");
  await expect(previewPanel).toContainText("None");

  const firstHoldResponsePromise = page.waitForResponse((response) =>
    isPostResponse(response, /\/api\/viewings\/[^/]+\/hold$/u)
  );
  await page.getByRole("button", { name: "Approve and create private tentative hold" }).click();
  const firstHoldResponse = await firstHoldResponsePromise;
  expect(firstHoldResponse.status()).toBe(409);
  expect((await firstHoldResponse.json()) as HoldResponse).toMatchObject({
    kind: "confirmation_required"
  });
  await expect(page.getByRole("heading", { name: "Calendar conflicts not checked" })).toBeVisible();
  await expect(previewPanel.getByRole("alert")).toContainText("could not be checked");

  const overrideHoldRequestPromise = page.waitForRequest((request) =>
    isPostTo(request, /\/api\/viewings\/[^/]+\/hold$/u)
  );
  const overrideHoldResponsePromise = page.waitForResponse((response) =>
    isPostResponse(response, /\/api\/viewings\/[^/]+\/hold$/u)
  );
  await page
    .getByRole("button", {
      name: "Approve and create without a completed final conflict check"
    })
    .click();
  const [overrideHoldRequest, overrideHoldResponse] = await Promise.all([
    overrideHoldRequestPromise,
    overrideHoldResponsePromise
  ]);
  expect(overrideHoldResponse.status()).toBe(201);
  expect((await overrideHoldResponse.json()) as HoldResponse).toMatchObject({
    kind: "created",
    duplicate: false
  });

  await expect(
    page.getByRole("heading", { name: "Simulated tentative hold created" })
  ).toBeVisible();
  await expect(
    page
      .locator(".viewing-planner p:not(.sr-only)")
      .filter({ hasText: "nothing was written to Google Calendar" })
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Reschedule in Vera" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Cancel in Vera" })).toBeVisible();

  const replay = await page.evaluate(
    async ({ path, body }) => {
      const response = await fetch(path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      });
      return { status: response.status, body: (await response.json()) as unknown };
    },
    {
      path: new URL(overrideHoldRequest.url()).pathname,
      body: overrideHoldRequest.postDataJSON()
    }
  );
  expect(replay).toMatchObject({
    status: 201,
    body: { kind: "created", duplicate: true }
  });

  await page.getByRole("button", { name: "Cancel in Vera" }).click();
  await expect(page.getByRole("heading", { name: "Viewing cancelled in Vera" })).toBeVisible({
    timeout: 20_000
  });
  await expect(
    page.locator(".viewing-warning").filter({ hasText: "no Google Calendar event exists" })
  ).toBeVisible();

  await page.getByRole("link", { name: "View all activity →" }).click();
  await expect(page.getByRole("heading", { name: "Activity log" })).toBeVisible();
  for (const action of [
    "viewing.proposals_created",
    "viewing.window_selected",
    "calendar.hold_approval_recorded",
    "calendar.hold_final_check_unavailable",
    "calendar.hold_override_approved",
    "calendar.hold_created",
    "viewing.cancelled_internal"
  ]) {
    await expect(page.getByRole("heading", { name: action })).toBeVisible();
  }
  await expect(page.getByRole("heading", { name: "calendar.hold_created" })).toHaveCount(1);
  expect(externalCalendarRequests).toEqual([]);
});
