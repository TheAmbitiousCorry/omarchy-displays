---
domain: conventions
last-verified: 2026-10-12
---

# Conventions

- **script-header**: Every bash script starts with `#!/usr/bin/env bash`, then `set -euo pipefail`, then the `# omarchy:summary=`, `# omarchy:args=` and `# omarchy:examples=` header block, one line each, in that order. The block is what `omarchy` reads to list and document the command; see `/usr/share/omarchy/bin/omarchy-display-text-size` for the shape.
- **lua-whitelist**: Every string written into Lua matches `^[A-Za-z0-9 ._:@/+-]+$` and contains no newline; every number matches `^-?[0-9]+(\.[0-9]+)?$`. A value that fails either check makes the command refuse with exit 3 before any `hyprctl` call, so nothing is evaluated.
- **model-pure**: `Model.js` imports nothing from Quickshell.
