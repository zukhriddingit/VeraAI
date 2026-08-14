import { z } from "zod";

import { IsoDateTimeSchema, Sha256Schema } from "./primitives.ts";

const SensitiveSnapshotTextSchema = z.string().superRefine((value, context) => {
  const prohibited = [
    /\b(?:authorization|cookie|set-cookie|password|passwd|secret)\b/iu,
    /\b(?:oauth|access|refresh)[_-]?token\b/iu,
    /\b(?:api|client|private)[_-]?key\b/iu,
    /\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/u,
    /-----BEGIN [A-Z ]*PRIVATE KEY-----/u,
    /(?:^|[^\w])[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}(?:$|[^\w])/u,
    /(?:^|[^\d])(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}(?:$|[^\d])/u,
    /(?:\/Users\/|\/home\/|[A-Za-z]:\\Users\\)/u,
    /\[(?:ref|target|node|backendDOMNodeId)=/iu
  ];
  if (prohibited.some((pattern) => pattern.test(value))) {
    context.addIssue({
      code: "custom",
      message: "Minimized snapshot text contains prohibited private or raw browser data."
    });
  }
});

export const RemoteExtensionSnapshotConfirmationSchema = z
  .object({
    sharedExactlyOneTab: z.literal(true),
    approvesReadOnlySnapshot: z.literal(true),
    understandsNoBrowserInteraction: z.literal(true),
    understandsConnectivitySpikeOnly: z.literal(true)
  })
  .strict();

export const MinimizedSharedTabPageSchema = z
  .object({
    url: z
      .url()
      .max(2_048)
      .superRefine((value, context) => {
        if (
          !/^https?:\/\/[^/?#]+\/?$/iu.test(value) ||
          /^https?:\/\/[^/?#]*@/iu.test(value) ||
          /[?#]/u.test(value)
        ) {
          context.addIssue({
            code: "custom",
            message:
              "Shared-tab URL must be an HTTP(S) origin without credentials, path, query, or fragment."
          });
        }
      }),
    title: SensitiveSnapshotTextSchema.pipe(z.string().trim().min(1).max(160))
  })
  .strict();

export const MinimizedRemoteExtensionSnapshotSchema = z
  .object({
    schemaVersion: z.literal("1"),
    capturedAt: IsoDateTimeSchema,
    page: MinimizedSharedTabPageSchema,
    textLines: z.array(SensitiveSnapshotTextSchema.pipe(z.string().trim().min(1).max(180))).max(24),
    sourceLineCount: z.number().int().min(0).max(100_000),
    returnedLineCount: z.number().int().min(0).max(24),
    sourceTruncated: z.boolean(),
    sourceSha256: Sha256Schema,
    contentSha256: Sha256Schema
  })
  .strict()
  .superRefine((value, context) => {
    if (value.returnedLineCount !== value.textLines.length) {
      context.addIssue({
        code: "custom",
        path: ["returnedLineCount"],
        message: "Returned line count must match the minimized line array."
      });
    }
    if (value.textLines.reduce((total, line) => total + line.length, 0) > 2_400) {
      context.addIssue({
        code: "custom",
        path: ["textLines"],
        message: "Minimized snapshot text exceeds the 2,400-character limit."
      });
    }
  });

export const RemoteExtensionSnapshotResponseSchema = z
  .object({
    requestId: z.uuid(),
    snapshot: MinimizedRemoteExtensionSnapshotSchema
  })
  .strict();

export const RemoteExtensionSnapshotFailureCodeSchema = z.enum([
  "unauthorized",
  "cross_origin_request",
  "malformed_request",
  "assignment_denied",
  "browser_disabled",
  "spike_disabled",
  "browser_gateway_not_configured",
  "maritime_auth_failed",
  "gateway_unavailable",
  "snapshot_timed_out",
  "snapshot_invalid_response"
]);

export type RemoteExtensionSnapshotConfirmation = z.infer<
  typeof RemoteExtensionSnapshotConfirmationSchema
>;
export type MinimizedRemoteExtensionSnapshot = z.infer<
  typeof MinimizedRemoteExtensionSnapshotSchema
>;
export type RemoteExtensionSnapshotResponse = z.infer<typeof RemoteExtensionSnapshotResponseSchema>;
export type RemoteExtensionSnapshotFailureCode = z.infer<
  typeof RemoteExtensionSnapshotFailureCodeSchema
>;
