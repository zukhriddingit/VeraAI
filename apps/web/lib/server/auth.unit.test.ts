import { describe, expect, it, vi } from "vitest";

import { createBetaIdentityHooks } from "./auth.ts";

const userId = "018f9f64-7b5a-7c91-a12e-111111111111";

describe("private beta identity hooks", () => {
  it("rejects unverified and uninvited identity creation when enabled", async () => {
    const repository = {
      findInvitedByEmail: vi.fn().mockResolvedValue(null),
      bindInvitedMembership: vi.fn(),
      isActiveUser: vi.fn()
    };
    const hooks = createBetaIdentityHooks(repository as never, {
      VERA_BETA_ACCESS_GATE_ENABLED: "1"
    });
    await expect(
      hooks.user.create.before({ email: "tester@example.com", emailVerified: false })
    ).rejects.toThrow("Private beta access is required.");
    await expect(
      hooks.user.create.before({ email: "tester@example.com", emailVerified: true })
    ).rejects.toThrow("Private beta access is required.");
  });

  it("binds the exact invited verified identity before permitting sessions", async () => {
    const repository = {
      findInvitedByEmail: vi.fn().mockResolvedValue({ id: "membership", userId: null }),
      bindInvitedMembership: vi.fn().mockResolvedValue({ status: "active" }),
      isActiveUser: vi.fn().mockResolvedValue(true)
    };
    const hooks = createBetaIdentityHooks(repository as never, {
      VERA_BETA_ACCESS_GATE_ENABLED: "1"
    });
    await expect(
      hooks.user.create.before({ email: "tester@example.com", emailVerified: true })
    ).resolves.toMatchObject({ data: { email: "tester@example.com" } });
    await hooks.user.create.after({ id: userId, email: "tester@example.com", emailVerified: true });
    expect(repository.bindInvitedMembership).toHaveBeenCalledWith(
      expect.objectContaining({ email: "tester@example.com", userId })
    );
    await expect(hooks.session.create.before({ userId })).resolves.toMatchObject({ data: { userId } });
  });
});
