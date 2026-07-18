export const ConnectorErrorCode = {
  malformedPayload: "malformed_payload",
  unsupportedConnector: "unsupported_connector",
  unsupportedSource: "unsupported_source",
  invalidUrl: "invalid_url",
  policyDenied: "policy_denied",
  captureFailed: "capture_failed"
} as const;

export type ConnectorErrorCode = (typeof ConnectorErrorCode)[keyof typeof ConnectorErrorCode];

export type SafeConnectorErrorDetails = Readonly<
  Partial<{
    connectorId: string;
    requestKind: string;
    source: string;
    reason: string;
  }>
>;

export abstract class ConnectorError extends Error {
  abstract readonly code: ConnectorErrorCode;

  protected constructor(
    message: string,
    readonly safeDetails: SafeConnectorErrorDetails = {}
  ) {
    super(message);
    this.name = new.target.name;
  }
}

export class MalformedCapturePayloadError extends ConnectorError {
  override readonly code = ConnectorErrorCode.malformedPayload;

  constructor(
    details: Pick<SafeConnectorErrorDetails, "connectorId" | "requestKind" | "reason"> = {}
  ) {
    super("The capture payload is malformed.", details);
  }
}

export class UnsupportedConnectorError extends ConnectorError {
  override readonly code = ConnectorErrorCode.unsupportedConnector;

  constructor(details: Pick<SafeConnectorErrorDetails, "connectorId" | "requestKind"> = {}) {
    super("No connector supports this capture request.", details);
  }
}

export class UnsupportedSourceError extends ConnectorError {
  override readonly code = ConnectorErrorCode.unsupportedSource;

  constructor(details: Pick<SafeConnectorErrorDetails, "connectorId" | "source" | "reason"> = {}) {
    super("The capture source is unsupported or conflicts with its provenance URL.", details);
  }
}

export class InvalidCaptureUrlError extends ConnectorError {
  override readonly code = ConnectorErrorCode.invalidUrl;

  constructor(reason: string) {
    super("The provenance URL is not safe to record.", { reason });
  }
}

export class ConnectorPolicyDeniedError extends ConnectorError {
  override readonly code = ConnectorErrorCode.policyDenied;

  constructor(details: Pick<SafeConnectorErrorDetails, "connectorId" | "reason"> = {}) {
    super("Source policy denied this connector operation.", details);
  }
}

export class ConnectorCaptureError extends ConnectorError {
  override readonly code = ConnectorErrorCode.captureFailed;

  constructor(details: Pick<SafeConnectorErrorDetails, "connectorId" | "reason"> = {}) {
    super("The connector could not capture the supplied listing evidence.", details);
  }
}

export function isConnectorError(error: unknown): error is ConnectorError {
  return error instanceof ConnectorError;
}
