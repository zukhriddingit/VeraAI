import { randomUUID } from "node:crypto";
import { lstatSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  createPostgresBetaAccessRepository,
  createPostgresBrowserGatewayAssignmentRepository,
  createPostgresRepositoryProvider,
  openPostgresConnection,
  parsePostgresConfig,
  type BetaAccessRepository,
  type BrowserGatewayAssignmentRepository,
  type UserRepositories
} from "@vera/db";
import {
  BrowserGatewayAssignmentSchema,
  BrowserGatewaySecretReferenceSchema,
  EntityIdSchema,
  VeraUserIdSchema,
  type VeraUserId
} from "@vera/domain";

interface CreateAssignmentArguments {
  readonly kind: "create";
  readonly userId: VeraUserId;
  readonly nodeId: string;
  readonly agentId: string;
  readonly gatewayOrigin: string;
  readonly secretReference: string;
  readonly relayDigestFile: string;
  readonly checkpointDigestFile: string;
}

interface ActivateAssignmentArguments {
  readonly kind: "activate";
  readonly assignmentId: string;
}

export type BrowserAssignmentCommandArguments =
  CreateAssignmentArguments | ActivateAssignmentArguments;

export interface ProvisionBrowserAssignmentDependencies {
  readonly betaAccess: Pick<BetaAccessRepository, "isActiveUser">;
  readonly assignments: BrowserGatewayAssignmentRepository;
  readonly repositories: Pick<
    UserRepositories,
    "browserNodes" | "browserProfileControls" | "browserIntegrationControls"
  >;
  readonly browserBetaUserIds: ReadonlySet<VeraUserId>;
  readDigestFile(path: string): string;
  createId(): string;
  now(): Date;
}

export interface SafeBrowserAssignmentOutput {
  readonly assignmentId: string;
  readonly userId: VeraUserId;
  readonly status: "pending" | "active";
  readonly secretReference: string;
}

function exactFlagValues(arguments_: readonly string[], flags: readonly string[]) {
  if (arguments_.length !== flags.length * 2) throw new Error("Invalid provisioning arguments.");
  const values = new Map<string, string>();
  for (let index = 0; index < arguments_.length; index += 2) {
    const flag = arguments_[index];
    const value = arguments_[index + 1];
    if (!flag || !value || !flags.includes(flag) || values.has(flag)) {
      throw new Error("Invalid provisioning arguments.");
    }
    values.set(flag, value);
  }
  if (flags.some((flag) => !values.has(flag))) throw new Error("Invalid provisioning arguments.");
  return values;
}

export function parseBrowserAssignmentCommand(
  arguments_: readonly string[]
): BrowserAssignmentCommandArguments {
  if (arguments_[0] === "--activate-assignment") {
    if (arguments_.length !== 2) throw new Error("Invalid activation arguments.");
    return {
      kind: "activate",
      assignmentId: BrowserGatewayAssignmentSchema.shape.id.parse(arguments_[1])
    };
  }
  const flags = [
    "--confirm-user",
    "--node-id",
    "--agent-id",
    "--gateway-origin",
    "--secret-reference",
    "--relay-digest-file",
    "--checkpoint-digest-file"
  ] as const;
  const values = exactFlagValues(arguments_, flags);
  return {
    kind: "create",
    userId: VeraUserIdSchema.parse(values.get("--confirm-user")),
    nodeId: EntityIdSchema.parse(values.get("--node-id")),
    agentId: EntityIdSchema.parse(values.get("--agent-id")),
    gatewayOrigin: BrowserGatewayAssignmentSchema.shape.gatewayOrigin.parse(
      values.get("--gateway-origin")
    ),
    secretReference: BrowserGatewaySecretReferenceSchema.parse(values.get("--secret-reference")),
    relayDigestFile: values.get("--relay-digest-file")!,
    checkpointDigestFile: values.get("--checkpoint-digest-file")!
  };
}

export function parseBrowserBetaUserIds(
  environment: Readonly<Record<string, string | undefined>>
): ReadonlySet<VeraUserId> {
  const values = (environment.VERA_BROWSER_BETA_USER_IDS ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean)
    .map((value) => VeraUserIdSchema.parse(value));
  if (values.length > 25 || new Set(values).size !== values.length) {
    throw new Error("VERA_BROWSER_BETA_USER_IDS must contain up to 25 unique Vera user UUIDs.");
  }
  return new Set(values);
}

function privateDigestFile(path: string): string {
  const metadata = lstatSync(path);
  if (!metadata.isFile() || (metadata.mode & 0o777) !== 0o600) {
    throw new Error("Credential digest files must be private regular files with mode 0600.");
  }
  const value = readFileSync(path, "utf8");
  if (!/^[a-f0-9]{64}$/u.test(value)) {
    throw new Error("Credential digest files must contain exactly 64 lowercase hex bytes.");
  }
  return value;
}

export async function provisionBrowserAssignment(
  input: CreateAssignmentArguments,
  dependencies: ProvisionBrowserAssignmentDependencies
): Promise<SafeBrowserAssignmentOutput> {
  if (!dependencies.browserBetaUserIds.has(input.userId)) {
    throw new Error("The confirmed user is not in the exact browser beta allowlist.");
  }
  if (!(await dependencies.betaAccess.isActiveUser(input.userId))) {
    throw new Error("The confirmed user is not an active Vera beta member.");
  }
  const controls = await dependencies.repositories.browserIntegrationControls.get();
  if (!controls.userBrowserEnabled) throw new Error("The user's browser controls are disabled.");
  const approvedNodes = (await dependencies.repositories.browserNodes.list()).filter(
    (node) =>
      node.disabledAt === null &&
      node.pairingState === "paired" &&
      node.capabilityApprovalState === "approved" &&
      node.versionCompatibility === "compatible" &&
      node.capabilities.capture &&
      node.capabilities.cancellation &&
      !node.capabilities.navigation &&
      node.selectedProfileId !== null
  );
  if (approvedNodes.length !== 1 || approvedNodes[0]!.nodeId !== input.nodeId) {
    throw new Error("Provisioning requires exactly one approved browser node.");
  }
  const node = approvedNodes[0]!;
  const profile = await dependencies.repositories.browserProfileControls.get(
    node.nodeId,
    node.selectedProfileId!
  );
  if (!profile || profile.disabledAt !== null) {
    throw new Error("Provisioning requires one approved browser profile.");
  }
  const existing = await dependencies.assignments.getLatestForUser(input.userId);
  if (existing && existing.status !== "revoked") {
    throw new Error("The confirmed user already has a live browser assignment.");
  }
  const assignment = await dependencies.assignments.createPending({
    id: dependencies.createId(),
    userId: input.userId,
    nodeId: input.nodeId,
    maritimeAgentId: input.agentId,
    gatewayOrigin: input.gatewayOrigin,
    checkpointOrigin: "https://app.verahousing.app",
    secretReference: input.secretReference,
    relayCredentialDigest: dependencies.readDigestFile(input.relayDigestFile),
    checkpointCredentialDigest: dependencies.readDigestFile(input.checkpointDigestFile),
    createdAt: dependencies.now().toISOString()
  });
  return {
    assignmentId: assignment.id,
    userId: assignment.userId,
    status: "pending",
    secretReference: assignment.secretReference
  };
}

async function main(): Promise<void> {
  const command = parseBrowserAssignmentCommand(process.argv.slice(2));
  const connection = openPostgresConnection(parsePostgresConfig(process.env));
  try {
    const assignments = createPostgresBrowserGatewayAssignmentRepository(connection);
    if (command.kind === "activate") {
      const assignment = await assignments.activate({
        assignmentId: command.assignmentId,
        activatedAt: new Date().toISOString()
      });
      process.stdout.write(
        `${JSON.stringify({ assignmentId: assignment.id, userId: assignment.userId, status: "active", secretReference: assignment.secretReference })}\n`
      );
      return;
    }
    const repositories = createPostgresRepositoryProvider(connection).forUser(command.userId);
    const output = await provisionBrowserAssignment(command, {
      betaAccess: createPostgresBetaAccessRepository(connection),
      assignments,
      repositories,
      browserBetaUserIds: parseBrowserBetaUserIds(process.env),
      readDigestFile: privateDigestFile,
      createId: randomUUID,
      now: () => new Date()
    });
    process.stdout.write(`${JSON.stringify(output)}\n`);
  } finally {
    await connection.close();
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  void main().catch(() => {
    process.stderr.write("Browser assignment provisioning failed safely.\n");
    process.exitCode = 1;
  });
}
