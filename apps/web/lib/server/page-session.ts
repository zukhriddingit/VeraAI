import { headers } from "next/headers";
import { redirect } from "next/navigation";

import {
  AuthenticationRequiredError,
  BetaAccessRequiredError,
  requireVeraSession
} from "./session.ts";

export async function requireVeraPageSession() {
  try {
    return await requireVeraSession(await headers());
  } catch (error: unknown) {
    if (error instanceof BetaAccessRequiredError) redirect("/access-pending");
    if (error instanceof AuthenticationRequiredError) redirect("/sign-in");
    throw error;
  }
}
