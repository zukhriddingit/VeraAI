FROM ghcr.io/openclaw/openclaw@sha256:6a31d44b2944e7adcd2b582bf6fb463111264ebca97a0201795b799135bd102c AS openclaw-runtime

USER root
COPY --chown=root:root --chmod=0444 remote-extension-runtime-lock.json \
  /opt/vera-build/remote-extension-runtime-lock.json
COPY --chown=root:root --chmod=0555 sanitize-runtime-dependencies.mjs \
  /opt/vera-build/sanitize-runtime-dependencies.mjs
RUN node /opt/vera-build/sanitize-runtime-dependencies.mjs

FROM openclaw-runtime AS vera-layout
RUN install -d -m 0755 -o 1000 -g 1000 \
      /opt/vera \
      /opt/vera/bin \
      /opt/vera/config \
      /opt/vera/plugins \
      /opt/vera/plugins/vera-read-shared-tab \
      /opt/vera/plugins/vera-browser-research \
      /opt/vera/plugins/vera-zillow-rental-research && \
    install -d -m 0700 -o 1000 -g 1000 \
      /data \
      /data/.openclaw \
      /data/.openclaw/credentials \
      /data/.openclaw/state \
      /data/.openclaw/workspace
COPY --chown=1000:1000 --chmod=0600 remote-extension.openclaw.json5 \
  /opt/vera/config/openclaw.json
COPY --chown=1000:1000 --chmod=0500 seed-security-audit-device.mjs \
  /opt/vera/bin/seed-security-audit-device.mjs
COPY --chown=1000:1000 --chmod=0555 remote-extension-supervisor.mjs \
  /opt/vera/bin/remote-extension-supervisor.mjs
COPY --chown=1000:1000 --chmod=0555 remote-extension-route-filter.mjs \
  /opt/vera/bin/remote-extension-route-filter.mjs
COPY --chown=1000:1000 --chmod=0555 remote-extension-enrollment.mjs \
  /opt/vera/bin/remote-extension-enrollment.mjs
COPY --chown=1000:1000 --chmod=0444 \
  vera-read-shared-tab/index.mjs \
  vera-read-shared-tab/openclaw.plugin.json \
  vera-read-shared-tab/package.json \
  /opt/vera/plugins/vera-read-shared-tab/
COPY --chown=1000:1000 --chmod=0444 \
  vera-browser-research/contract.mjs \
  vera-browser-research/index.mjs \
  vera-browser-research/openclaw.plugin.json \
  vera-browser-research/package.json \
  vera-browser-research/source-snapshot.mjs \
  /opt/vera/plugins/vera-browser-research/
COPY --chown=1000:1000 --chmod=0444 \
  vera-zillow-rental-research/contract.mjs \
  vera-zillow-rental-research/index.mjs \
  vera-zillow-rental-research/openclaw.plugin.json \
  vera-zillow-rental-research/package.json \
  vera-zillow-rental-research/zillow-snapshot.mjs \
  /opt/vera/plugins/vera-zillow-rental-research/

FROM cgr.dev/chainguard/node@sha256:abd1ea54ba68e3b2526c26ad5ef615823121a99010b595f1b4ebab77d47d061d AS final

USER 0:0
WORKDIR /usr/local/bin
WORKDIR /app

ARG VERA_SOURCE_COMMIT
LABEL org.opencontainers.image.title="Vera OpenClaw Browser Gateway" \
  org.opencontainers.image.description="Hardened founder-only OpenClaw direct-extension Gateway" \
  org.opencontainers.image.source="https://github.com/zukhriddingit/VeraAI" \
  org.opencontainers.image.revision="${VERA_SOURCE_COMMIT}" \
  org.opencontainers.image.version="2026.7.1-vera.11" \
  org.opencontainers.image.base.name="cgr.dev/chainguard/node" \
  org.opencontainers.image.base.digest="sha256:abd1ea54ba68e3b2526c26ad5ef615823121a99010b595f1b4ebab77d47d061d" \
  io.vera.openclaw.image.digest="sha256:6a31d44b2944e7adcd2b582bf6fb463111264ebca97a0201795b799135bd102c"

COPY --from=openclaw-runtime --chown=1000:1000 /app /app
COPY --from=vera-layout --chown=1000:1000 /opt/vera /opt/vera
COPY --from=vera-layout --chown=1000:1000 /data /data

RUN ["/usr/bin/node", "-e", "const fs=require('node:fs'); for (const directory of ['/sbin','/usr/sbin']) { fs.rmSync(directory,{recursive:true,force:true}); fs.mkdirSync(directory,{recursive:true,mode:0o755}); fs.chownSync(directory,0,0); fs.chmodSync(directory,0o755); } for (const name of fs.readdirSync('/usr/bin')) { if (name !== 'node') fs.rmSync('/usr/bin/'+name,{recursive:true,force:true}); } fs.rmSync('/usr/lib/node_modules',{recursive:true,force:true});"]

ENV PATH=/usr/bin \
  HOME=/data \
  OPENCLAW_CONFIG_PATH=/opt/vera/config/openclaw.json \
  OPENCLAW_EAGER_BROWSER_CONTROL_SERVER=1 \
  OPENCLAW_HEADLESS=true \
  OPENCLAW_STATE_DIR=/data/.openclaw

EXPOSE 18789
USER 1000:1000
ENTRYPOINT ["/usr/bin/node", "/opt/vera/bin/remote-extension-supervisor.mjs"]
