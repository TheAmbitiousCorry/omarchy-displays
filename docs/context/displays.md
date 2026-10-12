---
domain: displays
last-verified: 2026-10-12
---

# Displays engine

`bin/omarchy-displays` reads Hyprland's monitor state, applies a profile live, and reverts it unless the change is confirmed in time. It needs only bash, coreutils, `jq` and `hyprctl`, and works from a TTY.

Commands: `state`, `apply <profile.json> [--timeout N]`, `confirm`, `revert`, `help`. The hidden `_countdown` command is the detached countdown process and is not for direct use.

## Profile schema

A profile is a JSON object, schema version 1.

| Field | Type | Meaning |
|---|---|---|
| `schemaVersion` | number | Must be `1`. |
| `name` | string | Profile name. Required; not written into Lua. |
| `monitors` | array | Non-empty. One object per monitor. |
| `workspaces` | array | Reserved. Accepted and ignored. |

Each monitor object:

| Field | Type | Required | Meaning |
|---|---|---|---|
| `identity` | string | yes | How Hyprland finds the monitor: `desc:<description prefix>` or a connector name. Becomes `output`. |
| `connector` | string | no | Connector last seen (informational). Never written into Lua. |
| `enabled` | boolean | yes | `false` turns the monitor off. |
| `mode` | string | yes | `WIDTHxHEIGHT@HZ`, or `preferred`, `highres`, `highrr`. |
| `position` | string | yes | `XxY` in layout pixels, or `auto`. |
| `scale` | number | yes | Output scale. |
| `transform` | number | no | Rotation and flip, 0 to 7. |
| `mirror` | string or null | no | Identity of the monitor to mirror. `null` omits the field. |
| `vrr` | number | no | Variable refresh mode. |
| `bitdepth` | number | no | 8 or 10. |
| `cm` | string | no | Colour management preset. |
| `sdrbrightness` | number | no | SDR brightness multiplier. |
| `sdrsaturation` | number | no | SDR saturation multiplier. |

An optional field that is absent or `null` is omitted from the generated rule.

## Identity rules

`state` prints the `hyprctl -j monitors all` array with an `identity` string added to each monitor:

1. Non-empty `serial`: `desc:<description>`.
2. Empty `serial` and a make plus model that is unique among connected monitors: `desc:<make> <model>`.
3. Empty `serial` and a make plus model shared with another connected monitor: the connector `name`, plus `"identityWarning": "duplicate make and model without serial; matched by connector"`.

Hyprland matches a `desc:` identity as a prefix of the monitor description.

Every other field in `state` output is Hyprland's own, passed through unchanged; only `identity` and `identityWarning` are this tool's contract. Callers parse `state` JSON, never the prose that `apply`, `confirm` and `revert` print.

## Apply and countdown semantics

`apply` validates the whole profile first (see [Exit codes](#exit-codes) and the `lua-whitelist` entry in [conventions](./core/conventions.md)). It then checks the lock, takes it, and runs one `hyprctl eval` of an `hl.monitor({...})` rule per monitor, in file order. Eval is the live path because `hyprctl keyword monitor` is rejected under the Lua config. If any eval does not answer `ok`, `apply` runs `hyprctl reload`, releases the lock and exits 1.

After the evals, `apply` starts the countdown with `setsid`, stdin, stdout and stderr on `/dev/null`, so it survives its caller. It prints `applied N monitors; countdown Ns (pid P)` and exits 0 at once. The countdown polls every 0.2 seconds for the `confirmed` file for `--timeout` seconds (positive integer, default 15). On confirmation it removes the lock. On timeout it runs `hyprctl reload`, which discards every eval'd change and restores the file state, then removes the lock. Both end with exit 0.

`confirm` touches `confirmed`, waits up to 2 seconds for the lock to disappear, and exits 0. With no live countdown it prints `nothing to confirm` and exits 1.

`revert` kills the countdown if one is live, runs `hyprctl reload`, and removes the lock. With no countdown it is a plain reload, which makes it the rescue command from a TTY.

## Lock

The lock is the directory `$XDG_RUNTIME_DIR/omarchy-displays/countdown` (falling back to `/run/user/<uid>` when `XDG_RUNTIME_DIR` is unset). Its `pid` file holds the countdown process id; while `apply` is still starting the countdown it holds `apply`'s own pid. A lock whose pid is not a live process is stale: `apply` replaces it, `confirm` ignores it, `revert` removes it. While a live lock exists, `apply` prints `a countdown is already running (pid N); confirm or revert first` and exits 2 without calling `hyprctl`. The `confirmed` file inside the lock signals confirmation.

## Exit codes

| Code | Meaning |
|---|---|
| 0 | Success. |
| 1 | `confirm` with no countdown; a `hyprctl eval` or `reload` that failed. |
| 2 | `apply` refused because a countdown is live. |
| 3 | Invalid input: unreadable or malformed profile, schema violation, a string or number that fails the whitelist, bad `--timeout`, unknown command or option. No `hyprctl` call is made. |

Validation problems are written to stderr, one per line.

## Generated Lua rule shape

One call per monitor:

```lua
hl.monitor({ output = "desc:Samsung Electric Company S27C31x H9DWB00491", mode = "1920x1080@60", position = "0x1080", scale = 1, transform = 0, vrr = 0, bitdepth = 8, cm = "srgb", sdrbrightness = 1, sdrsaturation = 1 })
```

Fields appear in this fixed order: `output`, `disabled`, `mode`, `position`, `scale`, `transform`, `mirror`, `vrr`, `bitdepth`, `cm`, `sdrbrightness`, `sdrsaturation`. Strings are double-quoted and numbers bare. An enabled monitor never carries `disabled`. A disabled monitor carries only `output` and `disabled = true`; its `mode`, `position` and `scale` are validated but not written.
