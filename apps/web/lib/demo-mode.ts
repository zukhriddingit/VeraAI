export function isDemoMode(
  environment: Readonly<Record<string, string | undefined>> = process.env
): boolean {
  return environment.VERA_DEMO_MODE === "1";
}
