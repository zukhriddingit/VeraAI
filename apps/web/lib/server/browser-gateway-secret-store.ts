import { BrowserGatewaySecretReferenceSchema } from "@vera/domain";

export interface BrowserGatewaySecretMaterial {
  readonly maritimeApiKey: string;
  readonly planSigningKey: string;
  readonly browserResearchLoopback?: {
    readonly url: string;
    readonly token: string;
    readonly planSigningKey: string;
  };
}

export interface BrowserGatewaySecretStore {
  resolve(reference: string): Promise<BrowserGatewaySecretMaterial>;
}

export class BrowserGatewaySecretUnavailableError extends Error {
  constructor() {
    super("Browser assignment secrets are unavailable.");
    this.name = "BrowserGatewaySecretUnavailableError";
  }
}

export class EnvironmentBrowserGatewaySecretStore implements BrowserGatewaySecretStore {
  constructor(
    private readonly environment: Readonly<Record<string, string | undefined>> = process.env
  ) {}

  async resolve(referenceInput: string): Promise<BrowserGatewaySecretMaterial> {
    const reference = BrowserGatewaySecretReferenceSchema.parse(referenceInput);
    const prefix = `VERA_BROWSER_ASSIGNMENT_${reference}`;
    const maritimeApiKey = this.environment[`${prefix}_MARITIME_API_KEY`]?.trim() ?? "";
    const planSigningKey = this.environment[`${prefix}_PLAN_SIGNING_KEY`]?.trim() ?? "";
    const loopbackUrl = this.environment[`${prefix}_BROWSER_RESEARCH_LOOPBACK_URL`]?.trim() ?? "";
    const loopbackToken =
      this.environment[`${prefix}_BROWSER_RESEARCH_LOOPBACK_TOKEN`]?.trim() ?? "";
    const loopbackPlanSigningKey =
      this.environment[`${prefix}_BROWSER_RESEARCH_LOOPBACK_PLAN_SIGNING_KEY`]?.trim() ?? "";
    if (maritimeApiKey.length < 8 || planSigningKey.length < 32) {
      throw new BrowserGatewaySecretUnavailableError();
    }
    if (
      new Set([Boolean(loopbackUrl), Boolean(loopbackToken), Boolean(loopbackPlanSigningKey)])
        .size > 1 ||
      (loopbackPlanSigningKey && loopbackPlanSigningKey.length < 32)
    ) {
      throw new BrowserGatewaySecretUnavailableError();
    }
    return Object.freeze({
      maritimeApiKey,
      planSigningKey,
      ...(loopbackUrl
        ? {
            browserResearchLoopback: Object.freeze({
              url: loopbackUrl,
              token: loopbackToken,
              planSigningKey: loopbackPlanSigningKey
            })
          }
        : {})
    });
  }
}
