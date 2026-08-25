#!/bin/sh
# Traefik refuses to use acme.json for cert storage unless it is exactly
# 0600. Two things conspire against that on a fresh clone: git only tracks
# an executable/non-executable bit, never full permission modes, so a
# git-tracked file can never come back as 600; and Docker auto-creates a
# missing bind-mount *file* target as an empty *directory* instead, which
# Traefik also rejects. Fix both here, unconditionally, before traefik starts.
set -e
if [ -d /acme.json ]; then
    rm -rf /acme.json
fi
touch /acme.json
chmod 600 /acme.json
