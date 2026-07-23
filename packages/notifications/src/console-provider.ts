import type { NotificationProvider } from "./contracts.ts";

export class ConsoleNotificationProvider implements NotificationProvider {
  readonly providerId = "console";
  constructor(
    private readonly write: (message: string) => void = (message) => process.stdout.write(message)
  ) {}
  async send(input: Parameters<NotificationProvider["send"]>[0]) {
    this.write(JSON.stringify({ event: "notification_preview", payload: input.payload }) + "\n");
    return { status: "delivered" as const, providerReference: null };
  }
}
