import { EntityIdSchema } from "@vera/domain";

export function parseRouteEntityId(input: string): string | null {
  try {
    const decoded = decodeURIComponent(input);
    const parsed = EntityIdSchema.safeParse(decoded);
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
