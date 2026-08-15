export const ENROLLMENT_PROTOCOL: "vera-browser-enrollment.v1";
export const ENROLLMENT_PROTOCOL_VERSION: "1";
export const EXTENSION_VERSION: "2.2.0";

export class EnrollmentError extends Error {
  readonly code: string;
  constructor(code: string);
}

export interface EnrollmentRequest {
  readonly source: "vera-web";
  readonly type: "connect-browser";
  readonly version: "1";
  readonly requestId: string;
  readonly confirmation: "connect_read_only_browser";
  readonly ticket: string;
  readonly expiresAt: string;
  readonly gatewayOrigin: string;
  readonly protocolVersion: "1";
}

export function enrollmentRelayUrl(gatewayOrigin: string): string;
export function parseEnrollmentRequest(value: unknown): EnrollmentRequest;
export function parseEnrollmentResponse(
  value: unknown
):
  | { readonly protocol: "vera-browser-enrollment.v1"; readonly token: string }
  | { readonly protocol: "vera-browser-enrollment.v1"; readonly error: string };
export function createInstallationId(randomValues?: (bytes: Uint8Array) => Uint8Array): string;
export function digestInstallationId(
  installationId: string,
  digest?: (bytes: Uint8Array) => Promise<ArrayBuffer>
): Promise<string>;
export function enrollWithGateway(
  input: unknown,
  dependencies: {
    readonly installationId: string;
    readonly now?: () => Date;
    readonly createSocket?: (url: string, protocol: string) => WebSocket;
    readonly setTimeout?: typeof globalThis.setTimeout;
    readonly clearTimeout?: typeof globalThis.clearTimeout;
  }
): Promise<{ readonly relayUrl: string; readonly token: string }>;
