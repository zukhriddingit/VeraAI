FROM ghcr.io/openclaw/openclaw@sha256:6a31d44b2944e7adcd2b582bf6fb463111264ebca97a0201795b799135bd102c

ARG VERA_SOURCE_COMMIT

LABEL org.opencontainers.image.title="Vera OpenClaw Browser Gateway" \
  org.opencontainers.image.description="Hardened founder-only OpenClaw direct-extension Gateway" \
  org.opencontainers.image.source="https://github.com/zukhriddingit/VeraAI" \
  org.opencontainers.image.revision="${VERA_SOURCE_COMMIT}" \
  org.opencontainers.image.version="2026.7.1-vera.1"

USER root

RUN install -d -m 0555 -o node -g node \
      /opt/vera \
      /opt/vera/config \
      /opt/vera/plugins \
      /opt/vera/plugins/vera-read-shared-tab && \
    install -d -m 0700 -o node -g node \
      /data \
      /data/.openclaw \
      /data/.openclaw/credentials \
      /data/.openclaw/workspace

COPY --chown=node:node --chmod=0600 \
  remote-extension.openclaw.json5 \
  /opt/vera/config/openclaw.json
COPY --chown=node:node --chmod=0444 \
  vera-read-shared-tab/index.mjs \
  vera-read-shared-tab/openclaw.plugin.json \
  vera-read-shared-tab/package.json \
  /opt/vera/plugins/vera-read-shared-tab/

ENV OPENCLAW_CONFIG_PATH=/opt/vera/config/openclaw.json \
  OPENCLAW_HEADLESS=true \
  OPENCLAW_STATE_DIR=/data/.openclaw

EXPOSE 18789

USER node
