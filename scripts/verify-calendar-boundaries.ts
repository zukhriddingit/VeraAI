import { readFileSync, readdirSync } from "node:fs";
import { extname, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import ts from "typescript";

const ALLOWED_CALENDAR_SCOPES = new Set([
  "https://www.googleapis.com/auth/calendar.freebusy",
  "https://www.googleapis.com/auth/calendar.events.owned"
]);
const CALENDAR_SCOPE_PATTERN = /https:\/\/www\.googleapis\.com\/auth\/calendar[^\s"'`]*/giu;
const FORBIDDEN_EVENT_METHODS = new Set(["delete", "list", "move", "patch", "send", "update"]);
const FORBIDDEN_SEND_WRAPPERS = new Set([
  "sendcalendarinvite",
  "senddraft",
  "sendemail",
  "sendevent",
  "sendmail",
  "sendmessage"
]);
const LOG_METHODS = new Set(["debug", "error", "fatal", "info", "log", "trace", "warn"]);
const SKIPPED_DIRECTORIES = new Set([
  ".git",
  ".next",
  "coverage",
  "dist",
  "node_modules",
  "playwright-report",
  "test-results"
]);

export interface CalendarBoundaryViolation {
  readonly file: string;
  readonly line: number;
  readonly column: number;
  readonly rule: string;
  readonly detail: string;
}

function isProductionTypeScriptFile(file: string): boolean {
  const normalized = file.replaceAll("\\", "/");
  if (!normalized.startsWith("apps/") && !normalized.startsWith("packages/")) return false;
  if (!/\.(?:ts|tsx)$/u.test(normalized)) return false;
  return !(
    normalized.includes(".test.") ||
    normalized.includes(".spec.") ||
    normalized.includes(".test-fixtures.") ||
    normalized.includes("/test-support/") ||
    normalized.startsWith("packages/testing/") ||
    normalized.includes("/__fixtures__/") ||
    normalized.includes("/__tests__/")
  );
}

function unwrapExpression(expression: ts.Expression): ts.Expression {
  let current = expression;
  while (
    ts.isAsExpression(current) ||
    ts.isSatisfiesExpression(current) ||
    ts.isParenthesizedExpression(current) ||
    ts.isNonNullExpression(current) ||
    ts.isTypeAssertionExpression(current)
  ) {
    current = current.expression;
  }
  return current;
}

function staticPropertyName(name: ts.PropertyName): string | null {
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) {
    return name.text;
  }
  if (
    ts.isComputedPropertyName(name) &&
    (ts.isStringLiteral(name.expression) || ts.isNoSubstitutionTemplateLiteral(name.expression))
  ) {
    return name.expression.text;
  }
  return null;
}

function memberPath(expression: ts.Expression): string[] | null {
  const current = unwrapExpression(expression);
  if (ts.isIdentifier(current)) return [current.text];
  if (ts.isPropertyAccessExpression(current)) {
    const parent = memberPath(current.expression);
    return parent === null ? null : [...parent, current.name.text];
  }
  if (ts.isElementAccessExpression(current)) {
    const parent = memberPath(current.expression);
    const argument = current.argumentExpression;
    if (
      parent !== null &&
      argument !== undefined &&
      (ts.isStringLiteral(argument) || ts.isNoSubstitutionTemplateLiteral(argument))
    ) {
      return [...parent, argument.text];
    }
  }
  return null;
}

function literalText(node: ts.Node): string | null {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  if (ts.isTemplateExpression(node) && node.templateSpans.length === 0) return node.head.text;
  return null;
}

function findProperty(
  object: ts.ObjectLiteralExpression,
  propertyName: string
): ts.PropertyAssignment | undefined {
  return object.properties.find(
    (property): property is ts.PropertyAssignment =>
      ts.isPropertyAssignment(property) && staticPropertyName(property.name) === propertyName
  );
}

function isEmptyArray(expression: ts.Expression): boolean {
  const current = unwrapExpression(expression);
  return ts.isArrayLiteralExpression(current) && current.elements.length === 0;
}

function isStrictEmptyAttendeesSchema(expression: ts.Expression): boolean {
  const current = unwrapExpression(expression);
  if (isEmptyArray(current)) return true;
  if (!ts.isCallExpression(current)) return false;
  const path = memberPath(current.expression)?.map((part) => part.toLowerCase());
  return (
    path?.join(".") === "z.tuple" &&
    current.arguments.length === 1 &&
    current.arguments[0] !== undefined &&
    isEmptyArray(current.arguments[0])
  );
}

function isStrictEmptyTupleType(typeNode: ts.TypeNode | undefined): boolean {
  if (typeNode === undefined) return false;
  if (ts.isTupleTypeNode(typeNode)) return typeNode.elements.length === 0;
  return (
    ts.isTypeOperatorNode(typeNode) &&
    typeNode.operator === ts.SyntaxKind.ReadonlyKeyword &&
    ts.isTupleTypeNode(typeNode.type) &&
    typeNode.type.elements.length === 0
  );
}

function isInsideProviderRequestBody(node: ts.Node): boolean {
  let current: ts.Node | undefined = node.parent;
  while (current !== undefined) {
    if (ts.isPropertyAssignment(current) && staticPropertyName(current.name) === "requestBody") {
      return true;
    }
    if (ts.isCallExpression(current) || ts.isSourceFile(current)) return false;
    current = current.parent;
  }
  return false;
}

function isNoneSendUpdatesExpression(expression: ts.Expression, file: string): boolean {
  const current = unwrapExpression(expression);
  if (ts.isStringLiteral(current) || ts.isNoSubstitutionTemplateLiteral(current)) {
    return current.text === "none";
  }
  if (ts.isCallExpression(current)) {
    const path = memberPath(current.expression)
      ?.map((part) => part.toLowerCase())
      .join(".");
    return (
      path === "z.literal" &&
      current.arguments.length === 1 &&
      current.arguments[0] !== undefined &&
      literalText(current.arguments[0]) === "none"
    );
  }
  const text = current.getText();
  return (
    (file.endsWith("packages/calendar/src/google-client.ts") && text === "input.sendUpdates") ||
    (file.endsWith("packages/calendar/src/hold-payload.ts") && text === "effect.notifications")
  );
}

function isNoneSendUpdatesType(typeNode: ts.TypeNode | undefined): boolean {
  return (
    typeNode !== undefined &&
    ts.isLiteralTypeNode(typeNode) &&
    ts.isStringLiteral(typeNode.literal) &&
    typeNode.literal.text === "none"
  );
}

function normalizedIdentifier(value: string): string {
  return value.replace(/[^a-z0-9]/giu, "").toLowerCase();
}

function sensitiveIdentifier(value: string): boolean {
  const normalized = normalizedIdentifier(value);
  return (
    /(?:accesstoken|authorizationcode|clientsecret|credentials?|idtoken|oauthcode|password|pkceverifier|refreshtoken|rawtoken|sessioncookie)$/u.test(
      normalized
    ) ||
    normalized === "secret" ||
    normalized === "token"
  );
}

function isComparisonOperator(kind: ts.SyntaxKind): boolean {
  return [
    ts.SyntaxKind.EqualsEqualsEqualsToken,
    ts.SyntaxKind.ExclamationEqualsEqualsToken,
    ts.SyntaxKind.EqualsEqualsToken,
    ts.SyntaxKind.ExclamationEqualsToken,
    ts.SyntaxKind.GreaterThanToken,
    ts.SyntaxKind.GreaterThanEqualsToken,
    ts.SyntaxKind.LessThanToken,
    ts.SyntaxKind.LessThanEqualsToken,
    ts.SyntaxKind.InKeyword,
    ts.SyntaxKind.InstanceOfKeyword
  ].includes(kind);
}

function containsSensitiveLogValue(node: ts.Node): boolean {
  if (ts.isBinaryExpression(node) && isComparisonOperator(node.operatorToken.kind)) return false;
  if (ts.isObjectLiteralExpression(node)) {
    return node.properties.some((property) => {
      if (ts.isPropertyAssignment(property)) return containsSensitiveLogValue(property.initializer);
      if (ts.isShorthandPropertyAssignment(property))
        return sensitiveIdentifier(property.name.text);
      if (ts.isSpreadAssignment(property)) return containsSensitiveLogValue(property.expression);
      return false;
    });
  }
  if (ts.isIdentifier(node)) return sensitiveIdentifier(node.text);
  if (ts.isPropertyAccessExpression(node)) {
    return sensitiveIdentifier(node.name.text) || containsSensitiveLogValue(node.expression);
  }
  if (ts.isElementAccessExpression(node)) {
    return (
      containsSensitiveLogValue(node.expression) ||
      (node.argumentExpression !== undefined && containsSensitiveLogValue(node.argumentExpression))
    );
  }
  const text = literalText(node);
  if (text !== null) {
    return /(?:ya29\.|1\/[\/A-Za-z0-9_-]{20,}|BEGIN (?:RSA )?PRIVATE KEY)/u.test(text);
  }
  return node.getChildren().some((child) => containsSensitiveLogValue(child));
}

function loggingCallPath(path: readonly string[]): boolean {
  const normalized = path.map((part) => part.toLowerCase());
  const last = normalized.at(-1);
  if (last === undefined) return false;
  if (last === "write") {
    return normalized.includes("stdout") || normalized.includes("stderr");
  }
  if (!LOG_METHODS.has(last)) return false;
  if (normalized.at(-2) === "math") return false;
  return true;
}

function collectFiles(rootDirectory: string): string[] {
  const results: string[] = [];
  const visit = (absoluteDirectory: string): void => {
    for (const entry of readdirSync(absoluteDirectory, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (!SKIPPED_DIRECTORIES.has(entry.name)) visit(resolve(absoluteDirectory, entry.name));
        continue;
      }
      if (!entry.isFile()) continue;
      const absoluteFile = resolve(absoluteDirectory, entry.name);
      const file = relative(rootDirectory, absoluteFile).replaceAll("\\", "/");
      if (isProductionTypeScriptFile(file)) results.push(file);
    }
  };

  for (const root of ["apps", "packages"]) {
    visit(resolve(rootDirectory, root));
  }
  return results.sort();
}

export function findCalendarSourceViolations(
  source: string,
  file = "<calendar-source>"
): CalendarBoundaryViolation[] {
  const sourceFile = ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    true,
    extname(file) === ".tsx" ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  );
  const violations: CalendarBoundaryViolation[] = [];
  const seen = new Set<string>();

  const add = (node: ts.Node, rule: string, detail: string): void => {
    const position = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
    const key = `${rule}:${String(node.getStart(sourceFile))}:${detail}`;
    if (seen.has(key)) return;
    seen.add(key);
    violations.push({
      file,
      line: position.line + 1,
      column: position.character + 1,
      rule,
      detail
    });
  };

  const inspectText = (node: ts.Node, value: string): void => {
    for (const match of value.matchAll(CALENDAR_SCOPE_PATTERN)) {
      const scope = match[0]?.replace(/[),;\]}]+$/u, "");
      if (scope !== undefined && !ALLOWED_CALENDAR_SCOPES.has(scope)) {
        add(node, "calendar_scope", scope);
      }
    }
    if (/calendar\.calendarlist\.readonly/iu.test(value)) {
      add(node, "calendar_list_scope", "calendar.calendarlist.readonly");
    }
    const eventOperation = value.match(/\bevents\.(delete|list|move|patch|send|update)\b/iu);
    if (eventOperation !== null) {
      add(node, "event_operation", eventOperation[0]);
    }
    const sendOperation = value.match(/\b(?:drafts|messages)\.send\b|\bsendmail\b/iu);
    if (sendOperation !== null) {
      add(node, "send_operation", sendOperation[0]);
    }
    const sendEndpoint = value.match(/\b(?:drafts|messages)\/send\b/iu);
    if (sendEndpoint !== null) {
      add(node, "send_operation", sendEndpoint[0]);
    }
    const updates = value.match(/sendUpdates\s*[:=]\s*["']?(all|externalOnly)\b/iu);
    if (updates !== null) {
      add(node, "send_updates", updates[0]);
    }
  };

  const visit = (node: ts.Node): void => {
    const text = literalText(node);
    if (text !== null) inspectText(node, text);

    if (ts.isIdentifier(node)) {
      const normalized = normalizedIdentifier(node.text);
      if (normalized === "calendarlist") add(node, "calendar_list", node.text);
      if (FORBIDDEN_SEND_WRAPPERS.has(normalized)) add(node, "send_operation", node.text);
      const eventWrapper = normalized.match(/^(delete|list|move|patch|send|update)events?$/u);
      if (eventWrapper !== null) add(node, "event_operation", node.text);
    }

    if (ts.isPropertyAssignment(node)) {
      const name = staticPropertyName(node.name);
      if (name === "attendees") {
        if (isInsideProviderRequestBody(node)) {
          add(node, "provider_attendees", "provider request body must omit attendees");
        } else if (!isStrictEmptyAttendeesSchema(node.initializer)) {
          add(node, "attendees", "attendees must be a strict empty tuple/array");
        }
      }
      if (name === "sendUpdates" && !isNoneSendUpdatesExpression(node.initializer, file)) {
        add(node, "send_updates", `sendUpdates: ${node.initializer.getText(sourceFile)}`);
      }
    }

    if (ts.isShorthandPropertyAssignment(node)) {
      const name = node.name.text;
      if (name === "attendees") {
        add(
          node,
          isInsideProviderRequestBody(node) ? "provider_attendees" : "attendees",
          isInsideProviderRequestBody(node)
            ? "provider request body must omit attendees"
            : "shorthand attendees are not statically empty"
        );
      }
      if (name === "sendUpdates") {
        add(node, "send_updates", "shorthand sendUpdates are not statically none");
      }
    }

    if (ts.isPropertySignature(node)) {
      const name = staticPropertyName(node.name);
      if (name === "attendees" && !isStrictEmptyTupleType(node.type)) {
        add(node, "attendees", "attendees type must be readonly []");
      }
      if (name === "sendUpdates" && !isNoneSendUpdatesType(node.type)) {
        add(node, "send_updates", "sendUpdates type must be the literal none");
      }
    }

    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
      const path = memberPath(node.left);
      const name = path?.at(-1);
      if (name === "attendees" && !isEmptyArray(node.right)) {
        add(node, "attendees", "assigned attendees must be []");
      }
      if (name === "sendUpdates" && !isNoneSendUpdatesExpression(node.right, file)) {
        add(node, "send_updates", `assigned sendUpdates: ${node.right.getText(sourceFile)}`);
      }
    }

    if (ts.isPropertyAccessExpression(node)) {
      const path = memberPath(node) ?? [];
      const normalized = path.map((part) => part.toLowerCase());
      const method = normalized.at(-1);
      const receiver = normalized.at(-2);
      const isDirectCall = ts.isCallExpression(node.parent) && node.parent.expression === node;
      if (
        !isDirectCall &&
        method !== undefined &&
        receiver === "events" &&
        FORBIDDEN_EVENT_METHODS.has(method)
      ) {
        add(node, "event_operation", `aliased events.${method}`);
      }
      if (
        !isDirectCall &&
        method === "send" &&
        (receiver === "messages" || receiver === "drafts")
      ) {
        add(node, "send_operation", `aliased ${receiver}.send`);
      }
      if (
        method === "events" &&
        !(
          (ts.isPropertyAccessExpression(node.parent) ||
            ts.isElementAccessExpression(node.parent)) &&
          node.parent.expression === node
        )
      ) {
        add(node, "event_operation", "aliasing the Calendar events collection is forbidden");
      }
    }

    if (ts.isElementAccessExpression(node)) {
      const receiverPath = memberPath(node.expression)?.map((part) => part.toLowerCase()) ?? [];
      if (receiverPath.at(-1) === "events") {
        const operation = node.argumentExpression;
        const operationName = operation === undefined ? null : literalText(operation);
        if (operationName === null) {
          add(node, "event_operation", "dynamic Calendar event operations are forbidden");
        } else if (FORBIDDEN_EVENT_METHODS.has(operationName.toLowerCase())) {
          const isDirectCall = ts.isCallExpression(node.parent) && node.parent.expression === node;
          if (!isDirectCall) {
            add(node, "event_operation", `aliased events.${operationName}`);
          }
        }
      }
      if (receiverPath.at(-1) === "messages" || receiverPath.at(-1) === "drafts") {
        const operation = node.argumentExpression;
        const operationName = operation === undefined ? null : literalText(operation);
        if (operationName === null || operationName.toLowerCase() === "send") {
          add(node, "send_operation", "dynamic or aliased message send operation");
        }
      }
    }

    if (ts.isCallExpression(node)) {
      const path = memberPath(node.expression) ?? [];
      const normalized = path.map((part) => part.toLowerCase());
      const method = normalized.at(-1);
      const receiver = normalized.at(-2);

      if (method !== undefined && receiver === "events" && FORBIDDEN_EVENT_METHODS.has(method)) {
        add(node, "event_operation", `events.${method}`);
      }
      if (method === "send" && (receiver === "messages" || receiver === "drafts")) {
        add(node, "send_operation", `${receiver}.send`);
      }
      if (method !== undefined && FORBIDDEN_SEND_WRAPPERS.has(normalizedIdentifier(method))) {
        add(node, "send_operation", method);
      }
      if (normalized.includes("calendarlist")) add(node, "calendar_list", path.join("."));

      if (method === "insert" && receiver === "events") {
        const parameters = node.arguments[0];
        if (!ts.isObjectLiteralExpression(parameters)) {
          add(node, "provider_request_body", "events.insert parameters must be an object literal");
        } else {
          if (parameters.properties.some((property) => ts.isSpreadAssignment(property))) {
            add(parameters, "provider_request_body", "events.insert parameters cannot spread data");
          }
          const sendUpdates = findProperty(parameters, "sendUpdates");
          if (sendUpdates === undefined) {
            add(
              parameters,
              "send_updates",
              "events.insert must set sendUpdates to the literal none boundary"
            );
          }
          const requestBody = findProperty(parameters, "requestBody");
          const body =
            requestBody === undefined ? undefined : unwrapExpression(requestBody.initializer);
          if (!ts.isObjectLiteralExpression(body)) {
            add(node, "provider_request_body", "events.insert requestBody must be explicit");
          } else {
            if (body.properties.some((property) => ts.isSpreadAssignment(property))) {
              add(body, "provider_request_body", "events.insert requestBody cannot spread data");
            }
          }
        }
      }

      if (
        loggingCallPath(path) &&
        node.arguments.some((argument) => containsSensitiveLogValue(argument))
      ) {
        add(node, "secret_logging", "token or secret value passed to a logging sink");
      }
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  return violations.sort(
    (left, right) =>
      left.line - right.line || left.column - right.column || left.rule.localeCompare(right.rule)
  );
}

export function verifyCalendarSource(source: string, file = "<calendar-source>"): void {
  const violations = findCalendarSourceViolations(source, file);
  if (violations.length > 0) throw new Error(formatViolations(violations));
}

export function findCalendarBoundaryViolations(
  files: readonly string[],
  rootDirectory = process.cwd()
): CalendarBoundaryViolation[] {
  return files.filter(isProductionTypeScriptFile).flatMap((file) => {
    const sourceViolations = findCalendarSourceViolations(
      readFileSync(resolve(rootDirectory, file), "utf8"),
      file
    );
    if (/\/api\/.*\/send\/route\.(?:ts|tsx)$/u.test(file.replaceAll("\\", "/"))) {
      sourceViolations.push({
        file,
        line: 1,
        column: 1,
        rule: "send_route",
        detail: "API send routes are forbidden"
      });
    }
    return sourceViolations;
  });
}

function formatViolations(violations: readonly CalendarBoundaryViolation[]): string {
  return `Calendar boundary violations:\n${violations
    .map(
      ({ file, line, column, rule, detail }) =>
        `- ${file}:${String(line)}:${String(column)} [${rule}] ${detail}`
    )
    .join("\n")}`;
}

export function verifyCalendarBoundaries(rootDirectory = process.cwd()): void {
  const violations = findCalendarBoundaryViolations(collectFiles(rootDirectory), rootDirectory);
  if (violations.length > 0) throw new Error(formatViolations(violations));
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  verifyCalendarBoundaries(resolve(process.cwd()));
  process.stdout.write(`${JSON.stringify({ event: "calendar_boundaries_verified" })}\n`);
}
