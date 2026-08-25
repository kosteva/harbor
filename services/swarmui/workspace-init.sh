#!/bin/sh
# Pre-create SwarmUI's bind-mount targets with host-user ownership so the
# user can manage / delete files without sudo. Docker creates missing
# bind-mount targets as root:root by default; SwarmUI's entrypoint refuses
# to start ("Detected folder ownership issue") if it finds root-owned dirs
# while running as a non-root user. Chowning here before the main container
# starts keeps host ownership intact.
set -e
for dir in /mnt/data /mnt/dlbackend /mnt/dlnodes /mnt/extensions /mnt/models /mnt/output; do
    mkdir -p "$dir"
    chown -R "${TARGET_UID:-1000}:${TARGET_GID:-1000}" "$dir"
    chmod -R 0775 "$dir"
done
