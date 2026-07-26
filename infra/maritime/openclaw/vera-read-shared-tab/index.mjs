import { createHash } from "node:crypto";

const BROWSER_CONTROL_ORIGIN = "http://127.0.0.1:18792";
const BROWSER_PROFILE = "chrome";
const REQUEST_TIMEOUT_MS = 5_000;
const TABS_RESPONSE_MAX_BYTES = 64 * 1024;
const SNAPSHOT_RESPONSE_MAX_BYTES = 128 * 1024;
const SNAPSHOT_SOURCE_MAX_CHARS = 32_768;
const RESULT_MAX_LINES = 24;
const RESULT_MAX_LINE_CHARS = 180;
const RESULT_MAX_TEXT_CHARS = 2_400;

const SENSITIVE_PATTERNS = [
  /\b(?:authorization|cookie|set-cookie|password|passwd|secret)\b/iu,
  /\b(?:oauth|access|refresh)[_-]?token\b/iu,
  /\b(?:api|client|private)[_-]?key\b/iu,
  /\b(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?)?:?\/\/\S+/iu,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/u,
  /\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/u,
  /(?:^|[^\w])[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}(?:$|[^\w])/u,
  /(?:^|[^\d])(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}(?:$|[^\d])/u,
  /(?:^|[^\w])(?:\/Users\/|\/home\/|[A-Za-z]:\\Users\\)[^\s]+/u
];

const FORM_OR_SECRET_ROLE =
  /\b(?:textbox|searchbox|combobox|input|textarea|password|option|checkbox|radio)\b/iu;
const REF_TOKEN = /\s*\[(?:ref|target|node|backendDOMNodeId)=[^\]]+\]/giu;

export class VeraSnapshotPluginError extends Error {
  constructor(code) {
    super(code);
    this.name = "VeraSnapshotPluginError";
    this.code = code;
  }
}

function sha256(value) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function containsSensitiveText(value) {
  return SENSITIVE_PATTERNS.some((pattern) => pattern.test(value));
}

function cleanText(value, maxCharacters) {
  const normalized = String(value ?? "")
    .replaceAll("\u0000", "")
    .replace(REF_TOKEN, "")
    .replace(/\s+/gu, " ")
    .trim();
  if (!normalized || containsSensitiveText(normalized)) return "";
  return normalized.slice(0, maxCharacters);
}

function cleanSnapshotLines(snapshot) {
  const accepted = [];
  let acceptedCharacters = 0;
  for (const rawLine of snapshot.split(/\r?\n/u)) {
    if (FORM_OR_SECRET_ROLE.test(rawLine)) continue;
    const line = cleanText(rawLine, RESULT_MAX_LINE_CHARS);
    if (!line) continue;
    if (acceptedCharacters + line.length > RESULT_MAX_TEXT_CHARS) break;
    accepted.push(line);
    acceptedCharacters += line.length;
    if (accepted.length >= RESULT_MAX_LINES) break;
  }
  return accepted;
}

function sanitizePageUrl(rawUrl) {
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new VeraSnapshotPluginError("unsafe_page_url");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new VeraSnapshotPluginError("unsafe_page_url");
  }
  if (url.username || url.password) {
    throw new VeraSnapshotPluginError("unsafe_page_url");
  }
  return `${url.origin}/`.slice(0, 2_048);
}

export function minimizeSharedTabSnapshot(input, now = () => new Date()) {
  if (
    typeof input !== "object" ||
    input === null ||
    typeof input.snapshot !== "string" ||
    typeof input.url !== "string" ||
    typeof input.title !== "string"
  ) {
    throw new VeraSnapshotPluginError("invalid_snapshot_response");
  }
  const captured = now();
  if (!(captured instanceof Date) || Number.isNaN(captured.getTime())) {
    throw new VeraSnapshotPluginError("invalid_snapshot_clock");
  }
  const source = input.snapshot.slice(0, SNAPSHOT_SOURCE_MAX_CHARS);
  const textLines = cleanSnapshotLines(source);
  const page = {
    url: sanitizePageUrl(input.url),
    title: cleanText(input.title, 160) || "Shared tab"
  };
  const contentSha256 = sha256(JSON.stringify({ page, textLines }));
  return {
    schemaVersion: "1",
    capturedAt: captured.toISOString(),
    page,
    textLines,
    sourceLineCount: source.split(/\r?\n/u).length,
    returnedLineCount: textLines.length,
    sourceTruncated: input.snapshot.length > SNAPSHOT_SOURCE_MAX_CHARS || input.truncated === true,
    sourceSha256: sha256(input.snapshot),
    contentSha256
  };
}

async function readBoundedJson(response, maxBytes) {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw new VeraSnapshotPluginError("browser_response_too_large");
  }
  if (!response.body) throw new VeraSnapshotPluginError("browser_response_missing");
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel();
      throw new VeraSnapshotPluginError("browser_response_too_large");
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new VeraSnapshotPluginError("browser_response_invalid_json");
  }
}

async function browserGet(path, maxBytes, fetchImplementation) {
  const gatewayToken = process.env.OPENCLAW_GATEWAY_TOKEN?.trim();
  if (!gatewayToken) throw new VeraSnapshotPluginError("browser_control_auth_missing");
  const response = await fetchImplementation(new URL(path, BROWSER_CONTROL_ORIGIN), {
    method: "GET",
    redirect: "error",
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${gatewayToken}`
    },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
  });
  if (!response.ok) {
    throw new VeraSnapshotPluginError(
      response.status === 401 || response.status === 403
        ? "browser_control_auth_failed"
        : "browser_control_unavailable"
    );
  }
  return readBoundedJson(response, maxBytes);
}

export async function readSharedTabSnapshot(
  params = {},
  dependencies = { fetch: globalThis.fetch, now: () => new Date() }
) {
  if (
    typeof params !== "object" ||
    params === null ||
    Array.isArray(params) ||
    Object.keys(params).length !== 0
  ) {
    throw new VeraSnapshotPluginError("snapshot_tool_accepts_no_input");
  }
  const tabsPayload = await browserGet(
    `/tabs?profile=${BROWSER_PROFILE}`,
    TABS_RESPONSE_MAX_BYTES,
    dependencies.fetch
  );
  const tabs =
    typeof tabsPayload === "object" && tabsPayload !== null && Array.isArray(tabsPayload.tabs)
      ? tabsPayload.tabs
      : null;
  if (!tabs) throw new VeraSnapshotPluginError("invalid_tabs_response");
  if (tabs.length === 0) throw new VeraSnapshotPluginError("no_shared_tab");
  if (tabs.length !== 1) throw new VeraSnapshotPluginError("multiple_shared_tabs");
  const tab = tabs[0];
  if (
    typeof tab !== "object" ||
    tab === null ||
    typeof tab.targetId !== "string" ||
    typeof tab.url !== "string" ||
    typeof tab.title !== "string"
  ) {
    throw new VeraSnapshotPluginError("invalid_tab_response");
  }
  const query = new URLSearchParams({
    profile: BROWSER_PROFILE,
    format: "ai",
    targetId: tab.targetId,
    maxChars: String(SNAPSHOT_SOURCE_MAX_CHARS),
    compact: "true",
    interactive: "false",
    urls: "false",
    timeoutMs: String(REQUEST_TIMEOUT_MS)
  });
  const snapshotPayload = await browserGet(
    `/snapshot?${query.toString()}`,
    SNAPSHOT_RESPONSE_MAX_BYTES,
    dependencies.fetch
  );
  if (
    typeof snapshotPayload !== "object" ||
    snapshotPayload === null ||
    snapshotPayload.ok !== true ||
    snapshotPayload.format !== "ai" ||
    typeof snapshotPayload.snapshot !== "string"
  ) {
    throw new VeraSnapshotPluginError("invalid_snapshot_response");
  }
  return minimizeSharedTabSnapshot(
    {
      snapshot: snapshotPayload.snapshot,
      url: tab.url,
      title: tab.title,
      truncated: snapshotPayload.truncated
    },
    dependencies.now
  );
}

const plugin = {
  id: "vera-read-shared-tab",
  name: "Vera Read Shared Tab",
  description: "Reads and minimizes one explicitly shared Chrome tab without browser interaction.",
  register(api) {
    api.registerTool({
      name: "vera_read_shared_tab_snapshot",
      label: "Read shared tab snapshot",
      description:
        "Return a minimized read-only snapshot of the one tab explicitly shared in the OpenClaw tab group.",
      parameters: {
        type: "object",
        properties: {},
        additionalProperties: false
      },
      async execute(_toolCallId, params) {
        try {
          const result = await readSharedTabSnapshot(params);
          return {
            content: [{ type: "text", text: JSON.stringify(result) }],
            details: result
          };
        } catch (error) {
          const code =
            error instanceof VeraSnapshotPluginError
              ? error.code
              : error instanceof DOMException &&
                  (error.name === "TimeoutError" || error.name === "AbortError")
                ? "snapshot_timed_out"
                : "snapshot_failed";
          throw new Error(code);
        }
      }
    });
  }
};

export default plugin;
