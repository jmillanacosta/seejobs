#!/usr/bin/env bash
set -euo pipefail
app_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
for node_bin in "$HOME/.nvm/versions/node/v24.18.0/bin/node" "$HOME/.nvm/versions/node/v22.14.0/bin/node"; do
  if [[ -x "$node_bin" ]]; then exec "$node_bin" "$app_dir/src/cli.js" "$@"; fi
done
exec node "$app_dir/src/cli.js" "$@"
