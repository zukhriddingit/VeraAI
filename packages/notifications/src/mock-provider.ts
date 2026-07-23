import type { NotificationProvider, NotificationProviderResult } from "./contracts.ts";

export class MockNotificationProvider implements NotificationProvider {
  readonly providerId = "mock";
  readonly deliveries: unknown[] = [];
  constructor(
    private readonly result: NotificationProviderResult = {
      status: "delivered",
      providerReference: "mock-1"
    }
  ) {}
  async send(
    input: Parameters<NotificationProvider["send"]>[0]
  ): Promise<NotificationProviderResult> {
    this.deliveries.push(structuredClone(input.payload));
    return this.result;
  }
}
