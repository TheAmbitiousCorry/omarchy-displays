---
domain: displays
last-verified: 2026-10-12
---

# Displays engine

`bin/omarchy-displays` reads Hyprland's monitor state, applies a profile live, and reverts it unless the change is confirmed in time. It needs only bash, coreutils, `jq` and `hyprctl`, and works from a TTY.

Commands: `state`, `apply <profile.json> [--timeout N]`, `confirm`, `revert`, `status`, `help`. The hidden `_countdown` command is the detached countdown process and is not for direct use.

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
| `mode` | string | when enabled | `WIDTHxHEIGHT@HZ`, or `preferred`, `highres`, `highrr`. |
| `position` | string | when enabled | `XxY` in layout pixels, or `auto`. |
| `scale` | number | when enabled | Output scale. |
| `transform` | number | no | Rotation and flip, 0 to 7. |
| `mirror` | string or null | no | Identity of the monitor to mirror. `null` omits the field. |
| `vrr` | number | no | Variable refresh mode. |
| `bitdepth` | number | no | 8 or 10. |
| `cm` | string | no | Colour management preset. |
| `sdrbrightness` | number | no | SDR brightness multiplier. |
| `sdrsaturation` | number | no | SDR saturation multiplier. |

An optional field that is absent or `null` is omitted from the generated rule. `mode`, `position` and `scale` may be absent on a disabled monitor; when present they are still validated.

## Identity rules

`state` prints the `hyprctl -j monitors all` array with an `identity` string added to each monitor:

1. Non-empty `serial`: `desc:<description>`.
2. Empty `serial` and a make plus model that is unique among connected monitors: `desc:<make> <model>`.
3. Empty `serial` and a make plus model shared with another connected monitor: the connector `name`, plus `"identityWarning": "duplicate make and model without serial; matched by connector"`.

Hyprland matches a `desc:` identity as a prefix of the monitor description.

Every other field in `state` output is Hyprland's own, passed through unchanged; only `identity` and `identityWarning` are this tool's contract. Callers parse `state` JSON, never the prose that `apply`, `confirm` and `revert` print.

## Apply and countdown semantics

`apply` validates the whole profile first (see [Exit codes](#exit-codes) and the `lua-whitelist` entry in [conventions](./core/conventions.md)). It then checks the lock, takes it, and runs one `hyprctl eval` of an `hl.monitor({...})` rule per monitor, in file order. Eval is the live path because `hyprctl keyword monitor` is rejected under the Lua config. If any eval does not answer `ok`, `apply` runs `hyprctl reload`, releases the lock and exits 1.

After the evals, `apply` writes the lock's `deadline` file and starts the countdown with `setsid`, stdin, stdout and stderr on `/dev/null`, so it survives its caller. It prints `applied N monitors; countdown Ns (pid P)` and exits 0 at once. The countdown polls every 0.2 seconds for the `confirmed` file for `--timeout` seconds (positive integer, default 15). On confirmation it removes the lock. On timeout it runs `hyprctl reload`, which discards every eval'd change and restores the file state, then removes the lock. Both end with exit 0.

`confirm` touches `confirmed`, waits up to 2 seconds for the lock to disappear, and exits 0. With no live countdown it prints `nothing to confirm` and exits 1.

`revert` kills the countdown if one is live, runs `hyprctl reload`, and removes the lock. With no countdown it is a plain reload, which makes it the rescue command from a TTY.

## Lock

The lock is the directory `$XDG_RUNTIME_DIR/omarchy-displays/countdown` (falling back to `/run/user/<uid>` when `XDG_RUNTIME_DIR` is unset). Its `pid` file holds the countdown process id; while `apply` is still starting the countdown it holds `apply`'s own pid. A lock whose pid is not a live process is stale: `apply` replaces it, `confirm` ignores it, `revert` removes it. While a live lock exists, `apply` prints `a countdown is already running (pid N); confirm or revert first` and exits 2 without calling `hyprctl`. The `deadline` file holds the Unix epoch second at which the countdown lapses, written by `apply` before the countdown is detached. The `confirmed` file inside the lock signals confirmation.

## Status

`status` prints JSON and exits 0. With no live countdown, or a live lock that has no `deadline` yet, it prints `{"countdown": null}`. Otherwise it prints `{"countdown": {"pid": N, "deadline": T, "remaining": R}}`, where `T` is the lock's `deadline` and `R` is `max(0, T - now)` in whole seconds. The CLI owns the countdown clock; callers read it here rather than keeping their own.

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

Fields appear in this fixed order: `output`, `disabled`, `mode`, `position`, `scale`, `transform`, `mirror`, `vrr`, `bitdepth`, `cm`, `sdrbrightness`, `sdrsaturation`. Strings are double-quoted and numbers bare. An enabled monitor never carries `disabled`. A disabled monitor carries only `output` and `disabled = true`; any `mode`, `position` and `scale` it carries are validated but not written.

## Panel

The `kr34t1v.displays` plugin (`plugin/`, kind `panel`) opens from `omarchy-shell shell summon kr34t1v.displays '{}'` on the focused screen and closes on Escape. It never touches Hyprland or the disk itself: it runs `omarchy-displays` (the `cliPath` property, default `omarchy-displays` on `PATH`) and nothing else.

It shows the connected monitors from `state` as one rectangle each, to scale. A single scale factor, computed in `plugin/Model.js`, fits the bounding box of all monitors into the canvas, and never enlarges past 1:1. Each rectangle has the logical size (pixels divided by scale, width and height swapped for transforms 1, 3, 5 and 7), a number, the model name and the connector. Clicking a rectangle selects it. Below the canvas, two number fields edit the selected monitor's `x` and `y`; only non-negative integers are accepted.

Actions:

- **Apply** builds a schema version 1 profile from the shown monitors (`mode` as `WIDTHxHEIGHT@HZ` with the refresh rate rounded, `position` as `XxY`) into a temporary file and runs `apply <file> --timeout 15`. On exit 0 the panel reads `status` and the stock `ConfirmDialog` opens. Exit 2 shows that a countdown is already running.
- **Keep** (the dialog's confirm button) runs `confirm`.
- **Revert** (the button, the dialog's cancel button, or Escape in the dialog) runs `revert`.
- The dialog mirrors `status`: the panel polls it on open, after `apply` exits 0, and every second while the dialog shows. The dialog is open exactly while `countdown` is non-null and shows its `remaining`, so reopening the panel mid-countdown shows the dialog with the right seconds. When `status` flips to null the CLI has confirmed or reloaded, the dialog closes and the panel re-reads `state`.
- **Identify** shows a large badge for 3 seconds on every screen, numbered as the rectangles are. A badge sits on the screen whose name equals the monitor's connector.

Colours, radii, spacing and fonts come from the shell's `Color` and `Style` singletons, so a theme change recolours the open panel.
