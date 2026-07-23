import { GmailAlertQuerySchema, IsoDateTimeSchema, type GmailAlertQuery } from "@vera/domain";
import { z } from "zod";

const GmailMessageIdSchema = z.string().trim().min(1).max(256);
const GmailHistoryIdSchema = z.string().regex(/^\d+$/u).max(64).nullable();
const BOUNDED_BODY_CHARACTERS = 64_000;

export const GmailAlertMessageSchema = z
  .object({
    messageId: GmailMessageIdSchema,
    historyId: GmailHistoryIdSchema,
    internalDate: IsoDateTimeSchema,
    from: z.string().trim().min(1).max(500),
    subject: z.string().trim().min(1).max(500),
    bodyText: z.string().trim().min(1).max(BOUNDED_BODY_CHARACTERS)
  })
  .strict();

export const GmailAlertBatchSchema = z
  .object({
    messages: z.array(GmailAlertMessageSchema).max(100),
    latestHistoryId: GmailHistoryIdSchema
  })
  .strict();

export type GmailAlertMessage = z.infer<typeof GmailAlertMessageSchema>;
export type GmailAlertBatch = z.infer<typeof GmailAlertBatchSchema>;

export type GmailClientErrorCode =
  | "gmail_authentication"
  | "gmail_cancelled"
  | "gmail_rate_limited"
  | "gmail_temporarily_unavailable"
  | "gmail_timeout"
  | "gmail_invalid_response";

export class GmailClientError extends Error {
  constructor(
    readonly code: GmailClientErrorCode,
    readonly retryable: boolean
  ) {
    super(`Gmail read-only operation failed: ${code}.`);
    this.name = "GmailClientError";
  }
}

export interface GmailClient {
  searchListingAlerts(query: GmailAlertQuery, signal?: AbortSignal): Promise<GmailAlertBatch>;
}

export interface GmailFetchResponse {
  readonly ok: boolean;
  readonly status: number;
  json(): Promise<unknown>;
}

export interface GmailFetch {
  (
    url: string,
    init: {
      readonly method: "GET";
      readonly headers: Readonly<Record<string, string>>;
      readonly signal?: AbortSignal;
    }
  ): Promise<GmailFetchResponse>;
}

const ListResponseSchema = z
  .object({
    messages: z
      .array(z.object({ id: GmailMessageIdSchema }).passthrough())
      .max(100)
      .optional(),
    historyId: z.string().regex(/^\d+$/u).max(64).optional()
  })
  .passthrough();

const MessagePartSchema = z
  .object({
    mimeType: z.string().max(200).optional(),
    filename: z.string().max(500).optional(),
    body: z
      .object({ data: z.string().max(100_000).optional() })
      .passthrough()
      .optional(),
    parts: z.array(z.unknown()).max(100).optional()
  })
  .passthrough();

const MessageResponseSchema = z
  .object({
    id: GmailMessageIdSchema,
    historyId: z.string().regex(/^\d+$/u).max(64).optional(),
    internalDate: z.string().regex(/^\d+$/u).max(32),
    snippet: z.string().max(10_000).optional(),
    payload: z
      .object({
        headers: z
          .array(
            z.object({ name: z.string().max(200), value: z.string().max(4_000) }).passthrough()
          )
          .max(200),
        mimeType: z.string().max(200).optional(),
        filename: z.string().max(500).optional(),
        body: z
          .object({ data: z.string().max(100_000).optional() })
          .passthrough()
          .optional(),
        parts: z.array(z.unknown()).max(100).optional()
      })
      .passthrough()
  })
  .passthrough();

function queryTerms(query: GmailAlertQuery): string {
  const selectors: string[] = [];
  if (query.label !== null) selectors.push(`label:${query.label}`);
  if (query.allowedSenders.length > 0) {
    selectors.push(`{${query.allowedSenders.map((sender) => `from:${sender}`).join(" ")}}`);
  }
  if (query.subjectTerms.length > 0) {
    selectors.push(
      `{${query.subjectTerms.map((term) => `subject:\"${term.replaceAll('"', "")}\"`).join(" ")}}`
    );
  }
  return selectors.length === 1 ? (selectors[0] as string) : `{${selectors.join(" ")}}`;
}

function decodeBase64Url(value: string): string {
  return Buffer.from(value, "base64url").toString("utf8");
}

function textParts(partInput: unknown, output: string[], remaining: { value: number }): void {
  if (remaining.value <= 0) return;
  const parsed = MessagePartSchema.safeParse(partInput);
  if (!parsed.success) return;
  const part = parsed.data;
  if ((part.filename ?? "").length > 0) return;
  if (part.mimeType === "text/plain" && part.body?.data) {
    const decoded = decodeBase64Url(part.body.data).slice(0, remaining.value);
    output.push(decoded);
    remaining.value -= decoded.length;
  }
  for (const child of part.parts ?? []) textParts(child, output, remaining);
}

function messageText(message: z.infer<typeof MessageResponseSchema>): string {
  const output: string[] = [];
  textParts(message.payload, output, { value: BOUNDED_BODY_CHARACTERS });
  const joined = output.join("\n").trim();
  const fallback = message.snippet?.trim() ?? "";
  const value = joined || fallback;
  if (!value) throw new GmailClientError("gmail_invalid_response", false);
  return value.slice(0, BOUNDED_BODY_CHARACTERS);
}

function header(message: z.infer<typeof MessageResponseSchema>, name: string): string {
  const value = message.payload.headers.find(
    (candidate) => candidate.name.toLowerCase() === name.toLowerCase()
  )?.value;
  if (!value?.trim()) throw new GmailClientError("gmail_invalid_response", false);
  return value.trim();
}

function responseError(status: number): GmailClientError {
  if (status === 401 || status === 403) return new GmailClientError("gmail_authentication", false);
  if (status === 429) return new GmailClientError("gmail_rate_limited", true);
  if (status >= 500) return new GmailClientError("gmail_temporarily_unavailable", true);
  return new GmailClientError("gmail_invalid_response", false);
}

const DEFAULT_TIMEOUT_MILLISECONDS = 10_000;

export interface GoogleGmailClientOptions {
  readonly timeoutMilliseconds?: number;
}

function requestSignal(caller: AbortSignal | undefined, timeoutMilliseconds: number): AbortSignal {
  const timeout = AbortSignal.timeout(timeoutMilliseconds);
  return caller ? AbortSignal.any([caller, timeout]) : timeout;
}

function requestFailure(caller: AbortSignal | undefined, request: AbortSignal): GmailClientError {
  if (caller?.aborted) return new GmailClientError("gmail_cancelled", true);
  if (request.aborted) return new GmailClientError("gmail_timeout", true);
  return new GmailClientError("gmail_temporarily_unavailable", true);
}

async function parseResponse<Schema extends z.ZodType>(
  response: GmailFetchResponse,
  schema: Schema
): Promise<z.infer<Schema>> {
  try {
    const parsed = schema.safeParse(await response.json());
    if (!parsed.success) throw new GmailClientError("gmail_invalid_response", false);
    return parsed.data;
  } catch (error: unknown) {
    if (error instanceof GmailClientError) throw error;
    throw new GmailClientError("gmail_invalid_response", false);
  }
}

export class GoogleGmailClient implements GmailClient {
  readonly #fetch: GmailFetch;
  readonly #timeoutMilliseconds: number;

  constructor(
    private readonly accessToken: string,
    fetchImplementation: GmailFetch = fetch as unknown as GmailFetch,
    options: GoogleGmailClientOptions = {}
  ) {
    if (!accessToken.trim()) throw new GmailClientError("gmail_authentication", false);
    const timeoutMilliseconds = options.timeoutMilliseconds ?? DEFAULT_TIMEOUT_MILLISECONDS;
    if (!Number.isSafeInteger(timeoutMilliseconds) || timeoutMilliseconds < 1) {
      throw new TypeError("Gmail request timeout must be a positive safe integer.");
    }
    this.#fetch = fetchImplementation;
    this.#timeoutMilliseconds = timeoutMilliseconds;
  }

  async #get(url: string, caller: AbortSignal | undefined): Promise<GmailFetchResponse> {
    const signal = requestSignal(caller, this.#timeoutMilliseconds);
    try {
      const response = await this.#fetch(url, {
        method: "GET",
        headers: { Authorization: `Bearer ${this.accessToken}` },
        signal
      });
      if (!response.ok) throw responseError(response.status);
      return response;
    } catch (error: unknown) {
      if (error instanceof GmailClientError) throw error;
      throw requestFailure(caller, signal);
    }
  }

  async searchListingAlerts(
    queryInput: GmailAlertQuery,
    signal?: AbortSignal
  ): Promise<GmailAlertBatch> {
    const query = GmailAlertQuerySchema.parse(queryInput);
    const listUrl = new URL("https://gmail.googleapis.com/gmail/v1/users/me/messages");
    listUrl.searchParams.set("q", queryTerms(query));
    listUrl.searchParams.set("maxResults", String(query.maxResults));
    const listResponse = await this.#get(listUrl.href, signal);
    const list = await parseResponse(listResponse, ListResponseSchema);
    const messages: GmailAlertMessage[] = [];
    for (const reference of list.messages ?? []) {
      const detailUrl = new URL(
        `https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(reference.id)}`
      );
      detailUrl.searchParams.set("format", "full");
      const response = await this.#get(detailUrl.href, signal);
      const value = await parseResponse(response, MessageResponseSchema);
      messages.push(
        GmailAlertMessageSchema.parse({
          messageId: value.id,
          historyId: value.historyId ?? null,
          internalDate: new Date(Number(value.internalDate)).toISOString(),
          from: header(value, "From"),
          subject: header(value, "Subject"),
          bodyText: messageText(value)
        })
      );
    }
    return GmailAlertBatchSchema.parse({
      messages,
      latestHistoryId: list.historyId ?? messages.at(-1)?.historyId ?? query.afterHistoryId
    });
  }
}

export class MockGmailClient implements GmailClient {
  readonly queries: GmailAlertQuery[] = [];

  constructor(private readonly batch: GmailAlertBatch) {}

  async searchListingAlerts(query: GmailAlertQuery): Promise<GmailAlertBatch> {
    this.queries.push(GmailAlertQuerySchema.parse(query));
    return GmailAlertBatchSchema.parse(this.batch);
  }
}
