#!/usr/bin/env bash
set -euo pipefail
app_dir="${SEEJOBS_APP_DIR:-$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)}"
if command -v node >/dev/null && node -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 22 ? 0 : 1)' 2>/dev/null; then
  exec node "$app_dir/src/cli.js" "$@"
fi
for node_bin in "$HOME"/.nvm/versions/node/*/bin/node; do
  if [[ -x "$node_bin" ]] && "$node_bin" -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 22 ? 0 : 1)' 2>/dev/null; then
    exec "$node_bin" "$app_dir/src/cli.js" "$@"
  fi
done
echo "seejobs requires Node.js 22 or newer." >&2
exit 1
