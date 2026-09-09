#!/bin/sh
# Extracts llama-server and its bundled libraries out of the llama.cpp
# server image (this container's image) into /out, so the Marinara
# container can mount /out read-only and put a wrapper on PATH. Marinara's
# engine detects a "system" llama-server via `which llama-server`; once
# found, it spawns it WITHOUT setting LD_LIBRARY_PATH (that patching only
# happens for its own bundled/downloaded installs), so the wrapper this
# script writes has to set LD_LIBRARY_PATH itself.
set -e

rm -rf /out/lib /out/bin
mkdir -p /out/lib /out/bin

# llama-server plus the co-located libggml*/libllama*/libmtmd* it needs.
cp -a /app/. /out/lib/

# Runtime deps outside /app (libstdc++, libssl, libgomp, ...). Usually
# already present in Marinara's base image, but bundling them here makes
# the wrapper self-contained regardless of what that base image carries.
# The C runtime/loader itself must come from Marinara's own image, so it's
# deliberately excluded.
for lib in $(ldd /app/llama-server | awk '{print $1}'); do
  case "$lib" in
    ld-linux*|libc.so*|libm.so*|libpthread*|libdl.so*|librt.so*) continue ;;
  esac
  src=$(ldd /app/llama-server | awk -v l="$lib" '$1==l {print $3}')
  [ -n "$src" ] && [ -f "$src" ] && [ ! -e "/out/lib/$lib" ] && cp -a "$src" /out/lib/
done

cat > /out/bin/llama-server <<'WRAP'
#!/bin/sh
d=/opt/marinara-llama/lib
LD_LIBRARY_PATH="$d${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
export LD_LIBRARY_PATH
exec "$d/llama-server" "$@"
WRAP
chmod +x /out/bin/llama-server

chown -R "${TARGET_UID:-1000}:${TARGET_GID:-1000}" /out
chmod -R a+rX /out

# Sanity-check the extracted binary directly; the /out/bin wrapper hardcodes
# /opt/marinara-llama, which is only valid once mounted into Marinara itself.
LD_LIBRARY_PATH=/out/lib /out/lib/llama-server --version
