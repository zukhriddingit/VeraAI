"use client";

import { createAuthClient } from "better-auth/react";
import { useState } from "react";

const authClient = createAuthClient();

export function SignOutButton() {
  const [pending, setPending] = useState(false);

  async function signOut(): Promise<void> {
    setPending(true);
    const result = await authClient.signOut();
    if (result.error) {
      setPending(false);
      return;
    }
    window.location.assign("/sign-in");
  }

  return (
    <button className="nav-action" type="button" disabled={pending} onClick={signOut}>
      {pending ? "Signing out…" : "Switch account"}
    </button>
  );
}
