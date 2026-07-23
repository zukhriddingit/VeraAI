"use client";

import { createAuthClient } from "better-auth/react";
import { useState } from "react";

const authClient = createAuthClient();

export function SignInButton() {
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function signIn(): Promise<void> {
    setPending(true);
    setMessage(null);
    const result = await authClient.signIn.social({ provider: "google", callbackURL: "/" });
    if (result.error) {
      setMessage("Google sign-in could not start. Please try again.");
      setPending(false);
    }
  }

  return (
    <div>
      <button className="primary-action" type="button" disabled={pending} onClick={signIn}>
        {pending ? "Connecting…" : "Continue with Google"}
      </button>
      {message ? <p role="alert">{message}</p> : null}
    </div>
  );
}
