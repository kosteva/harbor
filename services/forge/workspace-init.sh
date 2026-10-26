#!/bin/sh
# The forge image runs as a fixed UID 99 (upstream's Unraid default), not the
# host user. Pre-create the bind-mount targets host-owned and world-writable
# so UID 99 can write into them; forge itself runs under umask 0000 (see
# compose.forge.yml), so everything it creates stays deletable by the host
# user without sudo.
set -e
for dir in /mnt/models /mnt/output /mnt/extensions /mnt/config /mnt/cache; do
    mkdir -p "$dir"
    chown "${TARGET_UID:-1000}:${TARGET_GID:-1000}" "$dir"
    chmod 0777 "$dir"
done
