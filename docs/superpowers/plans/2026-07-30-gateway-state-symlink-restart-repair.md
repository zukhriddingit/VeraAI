# Gateway State-Symlink Restart Repair Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Execute this plan inline in the current isolated worktree. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the pinned DigitalOcean OpenClaw Gateway restart idempotently while removing only its exact self-created browser-automation symlink and rejecting every path, target, ownership, or file-type mismatch.

**Architecture:** The cloud-init bootstrap will stop the prior container, inventory the persistent state without following links, validate the complete inventory, and remove one exact link only after every invariant passes. The existing fail-closed trap remains authoritative. The shell validator will extract and execute the embedded function against temporary state trees, while the TypeScript verifier will require the new stage and policy markers.

**Tech Stack:** cloud-init YAML, Bash, Ruby YAML extraction, TypeScript, Vitest, pnpm.

## Global Constraints

- Keep the Gateway image pinned to `ghcr.io/zukhriddingit/vera-openclaw-gateway@sha256:983f5fd5dd0d8c944f92d2988cf00cefb55750f58c5567a1ec8491c185b664fd`.
- Keep the source revision pinned to `f155bca09d57017ac141d2c8f3eebd26657aeb3d`.
- Keep runtime UID/GID `1000:1000`.
- Do not wipe or recreate `/var/lib/vera-browser-gateway/state`.
- Permit only `.openclaw/plugin-skills/browser-automation`.
- Require the exact link target `/app/dist/extensions/browser/skills/browser-automation`.
- Require the link owner to match the already-validated state-directory owner `1000:1000`.
- Reject every additional link and every non-link object at the approved link path.
- Keep SSH, port 80, direct 443, and direct public 18789 closed.
- Do not start Milestone 13B.

---

### Task 1: Add executable restart-policy regression cases

**Files:**
- Modify: `infra/digitalocean/browser-gateway/validate.sh`

**Interfaces:**
- Consumes: the bootstrap extracted from `cloud-init.template.yaml`.
- Produces: executable assertions for `sanitize_persisted_state_links <state-directory> <expected-owner>`.

- [ ] **Step 1: Extract the embedded policy function**

After the existing Ruby extraction, create a policy-only file:

```bash
policy_path="${temporary_directory}/state-link-policy.sh"
awk '
  /^sanitize_persisted_state_links\(\) \{$/ { capture = 1 }
  capture { print }
  capture && /^}$/ { exit }
' "${bootstrap_path}" > "${policy_path}"
test -s "${policy_path}"
bash -n "${policy_path}"
# shellcheck source=/dev/null
source "${policy_path}"
```

- [ ] **Step 2: Add the failing regression matrix**

Create isolated cases under the validator temporary directory and assert:

```bash
readonly expected_relative=".openclaw/plugin-skills/browser-automation"
readonly expected_target="/app/dist/extensions/browser/skills/browser-automation"

make_state_case() {
  local name="$1"
  local root="${temporary_directory}/${name}"
  mkdir -p "${root}/.openclaw/plugin-skills"
  printf '%s\n' "${root}"
}

state_owner() {
  local listing
  local uid
  local gid
  listing="$(LC_ALL=C ls -nd "$1")"
  read -r _ _ uid gid _ <<< "${listing}"
  printf '%s:%s\n' "${uid}" "${gid}"
}
```

Cover empty success, exact-link removal, second-run success, wrong target, wrong expected ownership, regular-file or directory collision, unexpected link, and exact-plus-unexpected link. Every failure case must preserve the rejected entry.

- [ ] **Step 3: Run the validator and prove the new tests fail**

Run:

```bash
bash infra/digitalocean/browser-gateway/validate.sh
```

Expected: failure because `sanitize_persisted_state_links` is not yet present.

### Task 2: Implement the exact-link reconciliation

**Files:**
- Modify: `infra/digitalocean/browser-gateway/cloud-init.template.yaml`

**Interfaces:**
- Consumes: persistent state directory and expected owner.
- Produces: zero state-tree symlinks before container recreation, or a nonzero fail-closed result.

- [ ] **Step 1: Add the policy function**

Add an embedded Bash function with local constants and a private inventory:

```bash
sanitize_persisted_state_links() {
  local candidate_state_directory="$1"
  local expected_owner="$2"
  local expected_relative=".openclaw/plugin-skills/browser-automation"
  local expected_target="/app/dist/extensions/browser/skills/browser-automation"
  local expected_link="${candidate_state_directory}/${expected_relative}"
  local inventory_path
  local link_path
  local link_target
  local link_listing
  local link_owner
  local link_uid
  local link_gid
  local inventory_entry
  local link_count=0
  local inventory_invalid=0

  if [[ (-e "${expected_link}" || -L "${expected_link}") && ! -L "${expected_link}" ]]; then
    return 1
  fi

  inventory_path="$(mktemp "${runtime_root}/.state-links.XXXXXX")"
  if ! find -P "${candidate_state_directory}" -xdev -type l -print0 > "${inventory_path}"; then
    rm -f "${inventory_path}"
    return 1
  fi
  while IFS= read -r -d '' inventory_entry; do
    link_count=$((link_count + 1))
    if [[ "${inventory_entry}" != "${expected_link}" ]]; then
      inventory_invalid=1
    fi
  done < "${inventory_path}"
  rm -f "${inventory_path}"

  if (( inventory_invalid != 0 || link_count > 1 )); then
    return 1
  fi
  if (( link_count == 0 )); then
    return 0
  fi

  link_path="${expected_link}"
  link_target="$(readlink -- "${link_path}")" || return 1
  link_listing="$(LC_ALL=C ls -nd "${link_path}")" || return 1
  read -r _ _ link_uid link_gid _ <<< "${link_listing}"
  link_owner="${link_uid}:${link_gid}"
  [[ "${link_target}" == "${expected_target}" ]] || return 1
  [[ "${link_owner}" == "${expected_owner}" ]] || return 1

  [[ -L "${link_path}" ]] || return 1
  [[ "$(readlink -- "${link_path}")" == "${expected_target}" ]] || return 1
  link_listing="$(LC_ALL=C ls -nd "${link_path}")" || return 1
  read -r _ _ link_uid link_gid _ <<< "${link_listing}"
  [[ "${link_uid}:${link_gid}" == "${expected_owner}" ]] || return 1
  rm -- "${link_path}"
  [[ ! -e "${link_path}" && ! -L "${link_path}" ]]
}
```

- [ ] **Step 2: Invoke it after the prior runtime is stopped**

In `runtime_recreation`, preserve the entire state directory:

```bash
current_stage="runtime_recreation"
remove_runtime
current_stage="state_link_reconciliation"
sanitize_persisted_state_links "${state_directory}" "1000:1000"
current_stage="runtime_recreation"
```

Do not add any recursive deletion of the state directory.

- [ ] **Step 3: Run the focused shell validator**

Run:

```bash
bash infra/digitalocean/browser-gateway/validate.sh
```

Expected: `digitalocean_gateway_template_validation=passed` and every state-link regression passes.

### Task 3: Bind the repair into the TypeScript release verifier and documentation

**Files:**
- Modify: `scripts/verify-digitalocean-browser-gateway.ts`
- Modify: `scripts/verify-digitalocean-browser-gateway.unit.test.ts`
- Modify: `infra/digitalocean/browser-gateway/README.md`

**Interfaces:**
- Consumes: the cloud-init template source.
- Produces: release violations when the reconciliation stage, exact path, exact target, ownership check, type check, or post-stop ordering is removed.

- [ ] **Step 1: Add a failing verifier test**

For each required marker, mutate the valid template and expect the violation:

```ts
expect(
  verifyDigitalOceanBrowserGateway({
    ...validInput,
    cloudInit: validInput.cloudInit.replace(
      'current_stage="state_link_reconciliation"',
      'current_stage="runtime_recreation"'
    )
  })
).toContain("Persistent state-link reconciliation must remain exact and fail closed.");
```

Run the same assertion for this exact mutation table:

```ts
const stateLinkPolicyMutations: ReadonlyArray<readonly [string, string]> = [
  [
    'local expected_relative=".openclaw/plugin-skills/browser-automation"',
    'local expected_relative=".openclaw/plugin-skills/other"'
  ],
  [
    'local expected_target="/app/dist/extensions/browser/skills/browser-automation"',
    'local expected_target="/app/dist/extensions/browser/skills/other"'
  ],
  [
    'sanitize_persisted_state_links "${state_directory}" "1000:1000"',
    'sanitize_persisted_state_links "${state_directory}" "0:0"'
  ],
  [
    '[[ (-e "${expected_link}" || -L "${expected_link}") && ! -L "${expected_link}" ]]',
    '[[ -L "${expected_link}" ]]'
  ],
  [
    'remove_runtime\n      current_stage="state_link_reconciliation"',
    'current_stage="state_link_reconciliation"\n      remove_runtime'
  ]
];
```

- [ ] **Step 2: Add the verifier invariant**

Require all exact markers and ordering. Emit only:

```text
Persistent state-link reconciliation must remain exact and fail closed.
```

when any condition is missing or reordered.

- [ ] **Step 3: Document the reboot invariant**

Add a README paragraph stating that the reviewed Gateway creates the one approved link, bootstrap removes only that exact owner/path/target after stopping the old container, and every other link or file-type collision fails closed.

- [ ] **Step 4: Run affected tests**

Run:

```bash
pnpm exec vitest run scripts/verify-digitalocean-browser-gateway.unit.test.ts
pnpm exec tsx scripts/verify-digitalocean-browser-gateway.ts
```

Expected: all tests pass and the verifier prints its passed classification.

### Task 4: Validate the complete change and rerun acceptance

**Files:**
- Update private ignored evidence under `release-evidence/private/`.

**Interfaces:**
- Consumes: corrected template and run-owned DigitalOcean credentials/resources.
- Produces: restart-safe backend, managed WSS, one-tab snapshot, `no_shared_tab`, sanitized evidence, and zero remaining run-owned resources.

- [ ] **Step 1: Run repository checks**

Run the narrow validator first, then the affected test suite, lint, typecheck, and secret/diff review using the repository’s existing commands.

```bash
bash infra/digitalocean/browser-gateway/validate.sh
pnpm exec vitest run scripts/verify-digitalocean-browser-gateway.unit.test.ts
pnpm run verify:digitalocean-browser-gateway
pnpm run lint
pnpm run typecheck
pnpm run format:check
git diff --check
git status --short
```

- [ ] **Step 2: Teardown the failed run**

Delete only run-owned resources for `20260730-15`, revoke its credentials, and verify the opaque IDs are absent.

- [ ] **Step 3: Create one fresh corrected run**

Use fresh disposable credentials and the corrected rendered template. Keep public ingress absent until first bootstrap and a second `systemctl restart vera-browser-gateway-bootstrap.service` both pass.

- [ ] **Step 4: Complete acceptance**

Repeat backend-local WSS/security gates, managed Load Balancer TLS/WSS, official extension pairing, exactly one shared `https://example.com/` tab, one minimized snapshot, unshare, `no_shared_tab`, and pairing revocation.

- [ ] **Step 5: Sanitize and teardown**

Generate the final evidence bundle SHA-256, delete all run-owned cloud/DNS/certificate/browser/Keychain/temp resources, verify no billable endpoint remains, and leave the tracked worktree clean.
