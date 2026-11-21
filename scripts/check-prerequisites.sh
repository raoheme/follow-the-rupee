#!/usr/bin/env bash
set -euo pipefail
for t in git node pnpm rustc cargo podman python;do command -v "$t">/dev/null||{ echo "Missing: $t";exit 1;};done
echo "CAP-0 tool gate passed"
