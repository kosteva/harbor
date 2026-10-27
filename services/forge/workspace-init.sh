#!/bin/sh
# Pre-create forge's bind-mount targets owned by the host user. Docker
# creates missing bind-mount targets as root:root, which the forge
# container (running as the host UID) could not write to.
set -e
for dir in /mnt/models /mnt/output /mnt/extensions /mnt/config /mnt/cache; do
    mkdir -p "$dir"
    chown "${TARGET_UID:-1000}:${TARGET_GID:-1000}" "$dir"
done
