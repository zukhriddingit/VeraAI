#!/bin/sh
set -eu

EXPECTED_STATE_DIR="/data/.openclaw"

if [ "${OPENCLAW_STATE_DIR:-}" != "$EXPECTED_STATE_DIR" ]; then
  echo "Refusing to start with an unexpected OpenClaw state directory." >&2
  exit 1
fi

if [ "$(id -u)" = "0" ]; then
  if [ -L /data ] || [ -L "$OPENCLAW_STATE_DIR" ]; then
    echo "Refusing to start with a symlinked OpenClaw state boundary." >&2
    exit 1
  fi

  install -d -m 0700 -o 1000 -g 1000 \
    /data \
    "$OPENCLAW_STATE_DIR" \
    "$OPENCLAW_STATE_DIR/credentials" \
    "$OPENCLAW_STATE_DIR/state" \
    "$OPENCLAW_STATE_DIR/workspace"

  if find "$OPENCLAW_STATE_DIR" -xdev -type l -print -quit | grep -q .; then
    echo "Refusing to start with symlinks inside the OpenClaw state boundary." >&2
    exit 1
  fi

  chown -R 1000:1000 "$OPENCLAW_STATE_DIR"
  find "$OPENCLAW_STATE_DIR" -xdev -type d -exec chmod 0700 {} +
  find "$OPENCLAW_STATE_DIR" -xdev -type f -exec chmod 0600 {} +

  export HOME=/home/node
  export USER=node
  export LOGNAME=node
  umask 077
  exec setpriv --reuid=1000 --regid=1000 --clear-groups "$@"
fi

if [ "$(id -u)" != "1000" ] || [ "$(id -g)" != "1000" ]; then
  echo "Refusing to start as an unexpected non-root identity." >&2
  exit 1
fi

umask 077
exec "$@"
