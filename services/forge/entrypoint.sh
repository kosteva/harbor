#!/bin/bash
# Adapted from upstream's neo/docker/entrypoint.sh
set -euo pipefail

# TCMalloc reduces memory fragmentation under large model workloads
tcmalloc="/usr/lib/$(uname -m)-linux-gnu/libtcmalloc_minimal.so.4"
if [[ -f "$tcmalloc" ]]; then
    export LD_PRELOAD="$tcmalloc"
fi

RAW_ARGS="${COMMANDLINE_ARGS:-}"
unset COMMANDLINE_ARGS

EXTRA_ARGS=()
if [[ -n "$RAW_ARGS" ]]; then
    read -ra EXTRA_ARGS <<< "$RAW_ARGS"
fi

# Settings files live in the config bind mount so they survive container recreation
for f in config.json ui-config.json styles.csv user.css; do
    ln -sf /home/forge/sd-webui/config/$f /home/forge/sd-webui/$f
done

exec python /home/forge/sd-webui/launch.py \
    --listen \
    "${EXTRA_ARGS[@]}" \
    "$@"
