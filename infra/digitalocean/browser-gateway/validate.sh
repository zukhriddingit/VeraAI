#!/usr/bin/env bash
set -euo pipefail
umask 077

readonly asset_directory="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
readonly template_path="${asset_directory}/cloud-init.template.yaml"
readonly intent_path="${asset_directory}/infrastructure-intent.json"
readonly journal_path="${asset_directory}/resource-journal.ts"
readonly certificate_path="${asset_directory}/managed-certificate.ts"
readonly load_balancer_path="${asset_directory}/managed-load-balancer.ts"
readonly expected_image="ghcr.io/zukhriddingit/vera-openclaw-gateway@sha256:983f5fd5dd0d8c944f92d2988cf00cefb55750f58c5567a1ec8491c185b664fd"
readonly validation_image="docker.io/library/ubuntu@sha256:4fbb8e6a8395de5a7550b33509421a2bafbc0aab6c06ba2cef9ebffbc7092d90"

temporary_directory="$(mktemp -d)"
trap 'rm -rf "${temporary_directory}"' EXIT
bootstrap_path="${temporary_directory}/vera-browser-gateway-bootstrap"
unit_path="${temporary_directory}/vera-browser-gateway-bootstrap.service"
policy_path="${temporary_directory}/state-link-policy.sh"

test -f "${template_path}"
test -f "${intent_path}"
test -f "${journal_path}"
test -f "${certificate_path}"
test -f "${load_balancer_path}"
jq -e . "${intent_path}" >/dev/null

ruby -ryaml -e '
  data = YAML.safe_load(File.read(ARGV.fetch(0)))
  abort "package_update must be true" unless data["package_update"] == true
  abort "package_upgrade must be false" unless data["package_upgrade"] == false
  abort "ssh_pwauth must be false" unless data["ssh_pwauth"] == false
  files = data.fetch("write_files")
  abort "unexpected write_files count" unless files.length == 5
  by_path = files.to_h { |entry| [entry.fetch("path"), entry] }
  bootstrap = by_path.fetch("/usr/local/sbin/vera-browser-gateway-bootstrap")
  unit = by_path.fetch("/etc/systemd/system/vera-browser-gateway-bootstrap.service")
  gateway_token = by_path.fetch("/etc/vera-browser-gateway/gateway-token")
  pairing_seed = by_path.fetch("/etc/vera-browser-gateway/extension-pairing-seed")
  abort "bootstrap mode rejected" unless bootstrap.fetch("permissions") == "0700"
  abort "unit mode rejected" unless unit.fetch("permissions") == "0644"
  abort "gateway token mode rejected" unless gateway_token.fetch("permissions") == "0600"
  abort "pairing seed mode rejected" unless pairing_seed.fetch("permissions") == "0600"
  abort "unexpected runcmd" unless data.fetch("runcmd").last ==
    ["systemctl", "enable", "--now", "vera-browser-gateway-bootstrap.service"]
  File.write(ARGV.fetch(1), bootstrap.fetch("content"))
  File.write(ARGV.fetch(2), unit.fetch("content"))
' "${template_path}" "${bootstrap_path}" "${unit_path}"

chmod 0700 "${bootstrap_path}"
bash -n "${bootstrap_path}"

awk '
  /^sanitize_persisted_state_links\(\) \{$/ { capture = 1 }
  capture { print }
  capture && /^}$/ { exit }
' "${bootstrap_path}" > "${policy_path}"
test -s "${policy_path}"
bash -n "${policy_path}"
# shellcheck source=/dev/null
source "${policy_path}"

readonly expected_state_link_relative=".openclaw/plugin-skills/browser-automation"
readonly expected_state_link_target="/app/dist/extensions/browser/skills/browser-automation"

make_state_case() {
  local name="$1"
  local root="${temporary_directory}/${name}"
  mkdir -p "${root}/.openclaw/plugin-skills"
  printf '%s\n' "${root}"
}

state_owner() {
  local path="$1"
  local listing
  local uid
  local gid
  listing="$(LC_ALL=C ls -nd "${path}")"
  read -r _ _ uid gid _ <<< "${listing}"
  printf '%s:%s\n' "${uid}" "${gid}"
}

empty_state="$(make_state_case empty-state)"
empty_owner="$(state_owner "${empty_state}")"
sanitize_persisted_state_links "${empty_state}" "${empty_owner}"

exact_state="$(make_state_case exact-state)"
exact_owner="$(state_owner "${exact_state}")"
exact_link="${exact_state}/${expected_state_link_relative}"
ln -s "${expected_state_link_target}" "${exact_link}"
sanitize_persisted_state_links "${exact_state}" "${exact_owner}"
[[ ! -e "${exact_link}" && ! -L "${exact_link}" ]]
sanitize_persisted_state_links "${exact_state}" "${exact_owner}"

wrong_target_state="$(make_state_case wrong-target-state)"
wrong_target_owner="$(state_owner "${wrong_target_state}")"
wrong_target_link="${wrong_target_state}/${expected_state_link_relative}"
ln -s "/app/dist/extensions/browser/skills/unreviewed" "${wrong_target_link}"
if sanitize_persisted_state_links "${wrong_target_state}" "${wrong_target_owner}"; then
  exit 1
fi
[[ -L "${wrong_target_link}" ]]

wrong_owner_state="$(make_state_case wrong-owner-state)"
wrong_owner="$(state_owner "${wrong_owner_state}")"
wrong_owner_link="${wrong_owner_state}/${expected_state_link_relative}"
ln -s "${expected_state_link_target}" "${wrong_owner_link}"
if [[ "${wrong_owner}" == "0:0" ]]; then
  mismatched_owner="1:1"
else
  mismatched_owner="0:0"
fi
if sanitize_persisted_state_links "${wrong_owner_state}" "${mismatched_owner}"; then
  exit 1
fi
[[ -L "${wrong_owner_link}" ]]

regular_file_state="$(make_state_case regular-file-state)"
regular_file_owner="$(state_owner "${regular_file_state}")"
regular_file_path="${regular_file_state}/${expected_state_link_relative}"
touch "${regular_file_path}"
if sanitize_persisted_state_links "${regular_file_state}" "${regular_file_owner}"; then
  exit 1
fi
[[ -f "${regular_file_path}" && ! -L "${regular_file_path}" ]]

directory_state="$(make_state_case directory-state)"
directory_owner="$(state_owner "${directory_state}")"
directory_path="${directory_state}/${expected_state_link_relative}"
mkdir "${directory_path}"
if sanitize_persisted_state_links "${directory_state}" "${directory_owner}"; then
  exit 1
fi
[[ -d "${directory_path}" && ! -L "${directory_path}" ]]

unexpected_state="$(make_state_case unexpected-state)"
unexpected_owner="$(state_owner "${unexpected_state}")"
unexpected_link="${unexpected_state}/unexpected-link"
ln -s "${expected_state_link_target}" "${unexpected_link}"
if sanitize_persisted_state_links "${unexpected_state}" "${unexpected_owner}"; then
  exit 1
fi
[[ -L "${unexpected_link}" ]]

multiple_state="$(make_state_case multiple-state)"
multiple_owner="$(state_owner "${multiple_state}")"
multiple_exact_link="${multiple_state}/${expected_state_link_relative}"
multiple_unexpected_link="${multiple_state}/unexpected-link"
ln -s "${expected_state_link_target}" "${multiple_exact_link}"
ln -s "${expected_state_link_target}" "${multiple_unexpected_link}"
if sanitize_persisted_state_links "${multiple_state}" "${multiple_owner}"; then
  exit 1
fi
[[ -L "${multiple_exact_link}" && -L "${multiple_unexpected_link}" ]]

if command -v shellcheck >/dev/null 2>&1; then
  shellcheck -x "${bootstrap_path}"
fi

if command -v systemd-analyze >/dev/null 2>&1; then
  sed 's#^ExecStart=.*#ExecStart=/bin/true#' "${unit_path}" \
    > "${temporary_directory}/verify.service"
  systemd-analyze verify "${temporary_directory}/verify.service" >/dev/null
fi

if command -v cloud-init >/dev/null 2>&1; then
  cloud-init schema -c "${template_path}" >/dev/null
fi

if [[ "${VERA_DO_VALIDATE_WITH_DOCKER:-0}" == "1" ]]; then
  command -v docker >/dev/null 2>&1
  docker_validation=(
    docker run --rm
    -v "${asset_directory}:/work:ro"
    "${validation_image}"
    bash -lc
    'apt-get update -qq &&
     DEBIAN_FRONTEND=noninteractive apt-get install -y -qq cloud-init >/dev/null &&
     cloud-init schema -c /work/cloud-init.template.yaml'
  )
  if command -v timeout >/dev/null 2>&1; then
    timeout 300s "${docker_validation[@]}"
  else
    "${docker_validation[@]}"
  fi
fi

test "$(grep -Fxc "      readonly gateway_image=\"${expected_image}\"" "${template_path}")" -eq 1
test "$(grep -Fxc "    \"image\": \"${expected_image}\"," "${intent_path}")" -eq 1
test "$(grep -Ec 'ghcr\.io/zukhriddingit/vera-openclaw-gateway@sha256:[0-9a-f]{64}' \
  "${template_path}")" -eq 1
! grep -Eq 'ghcr\.io/zukhriddingit/vera-openclaw-gateway:[A-Za-z0-9_.-]+' "${template_path}"

test "$(grep -Fxc "      __VERA_GATEWAY_TOKEN__" "${template_path}")" -eq 1
test "$(grep -Fxc "      __VERA_EXTENSION_PAIRING_SEED__" "${template_path}")" -eq 1
! grep -Eq '[[:space:]]+[0-9a-f]{64}[[:space:]]*$' "${template_path}"

! grep -Eqi '\b(nginx|caddy|traefik|lego|certbot)\b' "${template_path}"
! grep -Eq '0\\.0\\.0\\.0/0|::/0' "${template_path}"
! grep -Eq -- '-p[[:space:]]+(22|80|443|18789):' "${template_path}"
grep -Fq -- '-p "${vpc_ipv4}:${backend_port}:${backend_port}"' "${template_path}"
grep -Fq -- '--user 1000:1000' "${template_path}"
grep -Fq -- '--mount "type=bind,src=${state_directory},dst=/data"' "${template_path}"

grep -Fq 'PasswordAuthentication no' "${template_path}"
grep -Fq 'PermitRootLogin prohibit-password' "${template_path}"
grep -Fq 'trap fail_closed ERR' "${template_path}"
grep -Fq 'timeout 240s docker pull' "${template_path}"
grep -Fq 'TimeoutStartSec=900' "${template_path}"
grep -Fq 'status: "failed"' "${template_path}"
grep -Fq 'status: "backend_ready"' "${template_path}"
grep -Fq 'publicEndpointReady: false' "${template_path}"
grep -Fq 'wssAcceptanceStarted: false' "${template_path}"

grep -Fq 'await handle.sync()' "${journal_path}"
grep -Fq 'await rename(temporaryPath, absolutePath)' "${journal_path}"
grep -Fq 'await directoryHandle.sync()' "${journal_path}"
grep -Fq 'const DEFAULT_TIMEOUT_MS = 600_000' "${certificate_path}"
grep -Fq 'managed_certificate_identity_mismatch' "${certificate_path}"
grep -Fq 'await persistCertificate(' "${certificate_path}"
grep -Fq 'loadBalancer.type !== "REGIONAL"' "${load_balancer_path}"
grep -Fq 'loadBalancer.network !== "EXTERNAL"' "${load_balancer_path}"
grep -Fq 'await persistLoadBalancer(' "${load_balancer_path}"
grep -Fq 'await input.createDnsRecordAfterReadback?.(active)' "${load_balancer_path}"

jq -e --arg image "${expected_image}" '
  .provider == "digitalocean" and
  .releaseProfile == "founder_browser_experimental" and
  .region == "nyc1" and
  .droplet.count == 1 and
  .droplet.image == "ubuntu-24-04-x64" and
  .droplet.size == "s-1vcpu-2gb" and
  .droplet.dropletAgent == true and
  (.firewall.initialInboundRules | length) == 1 and
  .firewall.initialInboundRules[0].ports == "22" and
  .firewall.initialInboundRules[0].sources == ["operator_exact_ipv4_32_only"] and
  (.firewall.inboundApplicationRules | length) == 0 and
  .gateway.image == $image and
  .gateway.runtimeIdentity == "1000:1000" and
  .gateway.hostBinding == "vpc_only" and
  .gateway.hostPort == 18789 and
  .deferredUntilBackendLocalHealthPasses.loadBalancer == true and
  .deferredUntilBackendLocalHealthPasses.publicWss == true and
  .deferredUntilBackendLocalHealthPasses.chromePairing == true
' "${intent_path}" >/dev/null

printf '%s\n' \
  "digitalocean_gateway_template_validation=passed" \
  "yaml_structure=passed" \
  "embedded_shell_syntax=passed" \
  "systemd_unit=$([[ -x \"$(command -v systemd-analyze || true)\" ]] && printf checked || printf unavailable_locally)" \
  "cloud_init_schema=$([[ -x \"$(command -v cloud-init || true)\" ]] && printf checked || printf unavailable_locally)" \
  "immutable_gateway_digest=passed" \
  "secret_placeholders=passed" \
  "vpc_only_gateway_binding=passed" \
  "state_link_restart_reconciliation=passed" \
  "atomic_resource_journal=passed" \
  "certificate_reconciliation=passed" \
  "load_balancer_readback_before_dns=passed" \
  "fail_closed_cleanup=passed"
