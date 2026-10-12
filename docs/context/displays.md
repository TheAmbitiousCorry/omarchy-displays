---
domain: displays
last-verified: 2026-10-12
---

# Displays engine

`bin/omarchy-displays` reads Hyprland's monitor state, applies a profile live, and reverts it unless the change is confirmed in time. It needs only bash, coreutils, `jq` and `hyprctl`, and works from a TTY.

Commands: `state`, `workspaces`, `apply <profile.json> [--timeout N]`, `confirm`, `revert`, `status`, `persist [profile.json]`, `profile list|show|save|delete|activate|match`, `hotplug`, `doctor`, `loader-line`, `version`, `help`. `version` prints `0.1.0`. The hidden `_countdown` command is the detached countdown process and is not for direct use.

## Profile schema

A profile is a JSON object, schema version 1.

| Field | Type | Meaning |
|---|---|---|
| `schemaVersion` | number | Must be `1`. |
| `name` | string | Profile name. Required; must pass the string whitelist because `persist` writes it into a Lua comment. |
| `monitors` | array | Non-empty. One object per monitor. |
| `workspaces` | array | Optional. Workspace-to-monitor assignments, see [Workspaces](#workspaces). Absent or `null` means none. |

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

Each `workspaces` entry:

| Field | Type | Required | Meaning |
|---|---|---|---|
| `workspace` | string | yes | Workspace name, matching `^[A-Za-z0-9:_-]+$` (so `6`, `special:scratch`). |
| `monitor` | string | yes | Identity string, or connector name, passing the string whitelist. |
| `default` | boolean | no | Whether the monitor is the workspace's default. Absent means `false`. |
| `persistent` | boolean | no | Keep the workspace alive while empty. Absent means `false`. |

An optional field that is absent or `null` is omitted from the generated rule. `mode`, `position` and `scale` may be absent on a disabled monitor; when present they are still validated.

## Identity rules

`state` prints the `hyprctl -j monitors all` array with an `identity` string added to each monitor:

1. Non-empty `serial`: `desc:<description>`.
2. Empty `serial` and a make plus model that is unique among connected monitors: `desc:<make> <model>`.
3. Empty `serial` and a make plus model shared with another connected monitor: the connector `name`, plus `"identityWarning": "duplicate make and model without serial; matched by connector"`.

4. Empty `serial` and an empty make and model (a virtual output, or a monitor without EDID): the connector `name`, plus `"identityWarning": "no EDID make or model; matched by connector"`. Rule 2 would give `desc: `, which Hyprland matches against every monitor.

Rules are tried in this order, so rule 4 applies before rules 2 and 3. Hyprland matches a `desc:` identity as a prefix of the monitor description.

Every other field in `state` output is Hyprland's own, passed through unchanged; only `identity` and `identityWarning` are this tool's contract. Callers parse `state` JSON, never the prose that `apply`, `confirm` and `revert` print.

## Apply and countdown semantics

`apply` validates the whole profile first (see [Exit codes](#exit-codes) and the `lua-whitelist` entry in [conventions](./core/conventions.md)); `persist` runs the same validator. It then checks the lock, takes it, and runs one `hyprctl eval` of an `hl.monitor({...})` rule per monitor, in file order. Eval is the live path because `hyprctl keyword monitor` is rejected under the Lua config. If any eval does not answer `ok`, `apply` runs `hyprctl reload`, releases the lock and exits 1.

After the evals, `apply` copies the validated profile to `$XDG_RUNTIME_DIR/omarchy-displays/last-applied.json`, outside the lock directory so it survives `confirm`. It then writes the lock's `deadline` file and starts the countdown with `setsid`, stdin, stdout and stderr on `/dev/null`, so it survives its caller. It prints `applied N monitors; countdown Ns (pid P)` and exits 0 at once. The countdown polls every 0.2 seconds for the `confirmed` file for `--timeout` seconds (positive integer, default 15). On confirmation it removes the lock. On timeout it runs `hyprctl reload`, which discards every eval'd change and restores the file state, then removes the lock. Both end with exit 0. Before any eval, `apply` writes `workspaces-before.json` in the lock: `{workspace name: connector}` from `hyprctl -j workspaces`. After the monitor and workspace-rule evals it moves existing workspaces to match the profile (see [Workspaces](#workspaces)). When the countdown lapses, and on `revert`, the reload is followed by moving every snapshot workspace that still exists back to its recorded connector (by connector name, validated as `[A-Za-z0-9-]+`). `confirm` leaves the workspaces where `apply` put them.

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
| 1 | `confirm` with no countdown; a `hyprctl eval` or `reload` that failed; `doctor` found something missing. |
| 2 | `apply` or `hotplug` refused because a countdown is live. |
| 3 | Invalid input: unreadable or malformed profile, schema violation, a string or number that fails the whitelist, bad `--timeout`, unknown command or option, `persist` with no argument, no `last-applied.json` and no active profile, a profile name that fails the name rule, `profile show`, `delete` or `activate` of a missing profile. No `hyprctl` call is made and nothing is written. |

Validation problems are written to stderr, one per line.

## Generated Lua rule shape

One call per monitor, then one per workspace entry (see [Workspaces](#workspaces)):

```lua
hl.monitor({ output = "desc:Samsung Electric Company S27C31x H9DWB00491", mode = "1920x1080@60", position = "0x1080", scale = 1, transform = 0, vrr = 0, bitdepth = 8, cm = "srgb", sdrbrightness = 1, sdrsaturation = 1 })
```

Fields appear in this fixed order: `output`, `disabled`, `mode`, `position`, `scale`, `transform`, `mirror`, `vrr`, `bitdepth`, `cm`, `sdrbrightness`, `sdrsaturation`. Strings are double-quoted and numbers bare. An enabled monitor never carries `disabled`. A disabled monitor carries only `output` and `disabled = true`; any `mode`, `position` and `scale` it carries are validated but not written.

## Persist

`persist [profile.json]` makes a layout survive reloads and restarts. With no argument it reads `last-applied.json`, the profile most recently given to `apply`; if that is absent it reads the active stored profile (see [Profiles](#profiles)); with neither, it exits 3. `last-applied.json` lives in the runtime directory, so it is gone after a logout, and while it exists it outranks the active profile. It validates the profile exactly as `apply` does, then writes `$OMARCHY_DISPLAYS_HYPR_DIR/displays.lua` (default `~/.config/hypr/displays.lua`) and runs `hyprctl reload`, once. If the reload fails the file stays written and `persist` exits 1.

The file has this shape:

```lua
-- Generated by omarchy-displays 0.1.0. Do not edit: the next persist overwrites it.
-- Profile: desk
OMARCHY_DISPLAYS_LOADED = "0.1.0"
hl.monitor({ ... })
-- from profile desk: monitor not in no-dell
hl.monitor({ ... })
```

The chosen profile's workspace rules follow its monitor rules. After them come the fallback rules: for every identity that any stored profile has and the chosen profile lacks, one rule under the comment `-- from profile <donor>: monitor not in <chosen>`. This is how an unplugged monitor keeps its rule. The donor is the most recently modified stored profile that holds the identity (ties by name), and each identity is written once. A fallback block holds monitor rules only: a donor's workspace rules are never copied. The stored profile of the chosen name counts as a donor too, so a profile carrying monitors that are not connected keeps them when it is persisted from an applied copy. A stored profile that fails validation is skipped, so nothing unvalidated reaches Lua.

One writer: `apply` (through `hyprctl eval`) and `persist` (into the file, fallback rules included) take their rule lines from the same jq program, so the eval lines and the file lines are byte-identical for a profile.

The write is atomic: a temp file in the same directory, then `mv`. A refused profile touches nothing. Before an existing `displays.lua` is overwritten it is copied to `displays.lua.bak.<epoch>`; the epoch is bumped past the newest existing backup when needed, so two persists in one second keep distinct backups, and all but the newest 10 are deleted.

`persist --empty` writes the same file with the `OMARCHY_DISPLAYS_LOADED` line, `-- Profile: (none)` and no rules. `install.sh` uses it so `doctor` has a marker to read before any profile exists.

Facts about Hyprland 0.56.2, checked on this machine:

- `hyprctl reload` runs the config in a fresh Lua state. A module loaded with `require` is re-read from disk each time and globals set by a removed module are gone, so `pcall(require, "hypr.displays")` is the loader and no `dofile` is needed.
- `hyprctl eval` prints only `ok`, or `error: ...` with exit status 7. It never prints a return value, so a check is an `assert`.
- A rule in `displays.lua` wins over an earlier rule for the same monitor in `monitors.lua`: with `monitors.lua` saying 75 Hz, a persisted 60 Hz profile held 60 Hz across `hyprctl reload`.
- A syntax error in `displays.lua` makes `hyprctl configerrors` name only that file; the `pcall` keeps the rest of the config, and the binds, loading.

## Workspaces

`workspaces` prints a JSON array of `{workspace, monitor, default, persistent}`, one per rule in `hyprctl -j workspacerules` that names a monitor (`workspace` is Hyprland's `workspaceString`; `monitor` is the string as Hyprland reports it, so a `desc:` rule keeps its prefix and carries no serial). It then appends every workspace in `hyprctl -j workspaces` that no rule covers, as `{workspace, monitor, default: false, persistent: false, unruled: true}` where `monitor` is the `state` identity of the monitor the workspace is on. A rule with no monitor field is dropped.

A profile's `workspaces` entry becomes one line after the monitor rules, in file order:

```lua
hl.workspace_rule({ workspace = "6", monitor = "desc:Samsung Electric Company S27C31x H9DWB00491", default = true })
hl.workspace_rule({ workspace = "special:scratch", monitor = "desc:Dell Inc. DELL SE2726H HG5QZB4", default = false, persistent = true })
```

Fields appear as `workspace`, `monitor`, `default`, `persistent`; `default` is always written and `persistent` only when `true`. `apply` evals these lines after the monitor rules and `persist` writes them, from the same jq program, so the two stay byte-identical. `apply` still reports the monitor count only.

A rule does not move a workspace that already exists, so `apply` and `persist` also move one. After its evals (or its reload), for each `workspaces` entry whose workspace exists in `hyprctl -j workspaces` on a connector other than the one `state` maps the entry's identity to (a prefix of the full identity counts), it dispatches `hl.dsp.workspace.move({ workspace = "6", monitor = "<identity>" })`. A workspace that does not exist is left to the rule. Success prints nothing; a dispatch that does not answer `ok` prints one line on stderr and the rest continue.

Precedence: `displays.lua` loads after `workspaces.lua`, so a persisted rule overrides the user's rule for the same workspace. The user's keybinds are never read or changed; a bind that dispatches by workspace number (Super+1..5 focusing a workspace on each of two monitors) keeps working, and follows the new assignment. Removing an entry from the profile and persisting leaves `workspaces.lua` in charge of that workspace again.

Checked live on Hyprland 0.56.2:

- Evaluating a rule identical to an existing one leaves `hyprctl -j workspacerules` unchanged.
- Evaluating a rule changes `hyprctl -j workspacerules` at once, and `hyprctl reload` restores the file's rule.
- A rule moves where a workspace is created, not a workspace that already exists. With workspace 6 live on the Dell and an eval'd rule putting it on the Samsung, `hyprctl dispatch 'hl.dsp.focus({ workspace = "6" })'` left it on the Dell. A workspace with no windows that did not exist (8) was created on the Samsung after the same kind of eval. An existing workspace moves with `hl.dsp.workspace.move`, which accepts a `desc:` identity as `monitor`; `apply` and `persist` issue it.

## Hotplug

`hotplug` applies the stored profile that matches the monitors connected now, without a countdown. Decision table, first row that fits wins:

| Condition | Effect | Prints | Exit |
|---|---|---|---|
| A countdown lock is live | Nothing is read or written | `a countdown is already running (pid P); confirm or revert first` | 2 |
| No stored profile matches (`profile match` finds none) | Nothing | `no profile matches N monitors` | 0 |
| The match is the active profile and line 2 of `displays.lua` is `-- Profile: <name>` | Nothing | `already active: <name>` | 0 |
| Otherwise | `profile activate`, then `persist` (one reload, fallback rules included), then a notification | `applied <name>` | 0 |

A new monitor set with no profile is normal: nothing is notified, and the user opens the panel and saves one. Matching is `profile match`, so the active profile wins among equal sets. The notification is `omarchy-notification-send "Displays: applied profile <name>"`, the helper Omarchy's own scripts use; a failure to send it is ignored. `persist` reloads Hyprland, which emits `configreloaded`; the run that follows finds the profile active and persisted and stops, so there is no loop.

The `service` entry point (`plugin/Service.qml`, `keepLoaded`, so it survives plugin hot-reload and changes to it need `omarchy restart shell`) connects to `$XDG_RUNTIME_DIR/hypr/$HYPRLAND_INSTANCE_SIGNATURE/.socket2.sock` and reads lines. A line starting `monitoraddedv2>>`, `monitorremovedv2>>` or `configreloaded>>` restarts a 2000 ms timer; when it fires the service runs `omarchy-displays hotplug` and logs each stdout line as `omarchy-displays: <line>`, visible with `journalctl --user -t omarchy-shell`. Exit 2 retries every 2000 ms, at most 30 times, then logs that it gave up. A closed or failed socket reconnects after 5 s.

Facts checked on this machine, Hyprland 0.56.2, with `hyprctl output create headless` and `output remove`:

- A healthy hotplug emits `monitoradded`, `monitoraddedv2` (or the removed pair) and no `configreloaded`. `omarchy-hyprland-monitor-watch` reloads only when a monitor reports no mode, and logs nothing, so the monitor events are the reliable signal and `configreloaded` covers its recovery reload.
- A headless output gets the next `HEADLESS-N` and never reuses a number, so a profile for one needs `hyprctl output create headless NAME` to match twice.
- With a profile active, a hotplug cycle took about 2.1 s from the event to the profile being active, one reload per applied change.
- While `apply` held a lock, the service retried every 2 s (four times in the live run) and applied the profile within 2 s of the lock clearing.

## Doctor

`doctor` never modifies anything. It checks two things: `hyprland.lua` in `$OMARCHY_DISPLAYS_HYPR_DIR` contains the loader line (`omarchy-displays loader-line`), and the running config answers `ok` to `hyprctl eval 'assert(OMARCHY_DISPLAYS_LOADED ~= nil)'`. Both pass: it prints `ok: pcall(require, "hypr.displays") is live` and exits 0. Otherwise it prints one `missing:` line per failed check and exits 1. Any `OMARCHY_DISPLAYS_LOADED` value proves the file is loaded; a value other than the CLI's version adds a `note:` line and still exits 0, so an upgrade never fails `doctor`.

## Install

`install.sh` (repo root, safe to re-run) symlinks the plugin into `~/.config/omarchy/plugins/` and the CLI into `~/.local/bin/`, enables the plugin, clones and patches the stock Display widget and links the desktop entry (see [Entry points](#entry-points)), merges the menu entry, then edits the Hyprland config:

- Backs up `hyprland.lua` to `hyprland.lua.bak.<epoch>`, only on a run that is about to change it.
- Inserts the loader line immediately before the line containing `require("default.hypr.toggles")`, or appends it if there is no such line. It skips this if the line is already present.

The loader line, exactly:

```lua
pcall(require, "hypr.displays")
```

It sits after the user's `hypr.monitors` require so generated rules win, and before the toggles so Omarchy's laptop-disable toggle still wins. If `displays.lua` does not exist it runs `persist --empty`. It then runs `hyprctl reload` and `doctor`, and exits with doctor's status. `~/.config/hypr/monitors.lua` is never read or written.

The menu entry is merged into `~/.config/omarchy/extensions/omarchy-menu.jsonc` as a marked block (see [Entry points](#entry-points)). `install.sh` inserts the block from `menu/omarchy-menu.jsonc` on the line after the file's opening `{`, so the user's comments and entries are untouched, and skips it when the begin marker is already present. A file with no line holding only `{` is refused with an instruction to add the block by hand. A missing file is created holding only the block. Before editing an existing file it copies it to `omarchy-menu.jsonc.bak.<epoch>`. The merge is textual because the file is mostly comments, which a `jq` round trip would drop.

`omarchy plugin add <git url>` clones the plugin and validates its manifest but runs no install hook (the shell's plugin README: "The installer never runs plugin code, install hooks, or sudo"), so `install.sh` is the install path. A plugin added that way has no loader line, clone, menu entry or desktop entry until `./install.sh` runs from `~/.config/omarchy/plugins/kr34t1v.displays`.

### Uninstall

`uninstall.sh` (repo root, safe to re-run) undoes `install.sh` step by step and prints one line per step, `already gone: <path>` when there is nothing to do:

- Deletes the exact loader line from `hyprland.lua` and nothing else, so the file ends byte-identical to the backup taken before the install.
- Deletes `displays.lua` and every `displays.lua.bak.*`.
- Runs `omarchy plugin remove kr34t1v.displays --yes` when the plugin link points at this repo, and removes the CLI and desktop symlinks only when they point at this repo, then runs `update-desktop-database`. A path that is not ours is left alone.
- Deletes the marked menu block. A menu file left holding only braces is deleted.
- Runs `omarchy plugin remove kr34t1v.monitor --yes` when the clone's `Panel.qml` carries the Configure marker. The shell moves the folder to `~/.config/omarchy/plugins/.kr34t1v.monitor.bak.<timestamp>` and restores `omarchy.monitor` in the clone's bar position. A clone without the marker is left alone. It then enables `omarchy.monitor` if it is not enabled.
- Keeps `~/.config/omarchy/displays/` unless run with `--purge`.
- Runs `hyprctl reload`, prints `hyprctl configerrors`, and exits 1 if that output is not empty.

The `hyprland.lua.bak.*` and `omarchy-menu.jsonc.bak.*` files from `install.sh` stay. `monitors.lua` is never touched, so the monitors keep the layout it holds.


## Profiles

Profiles are the source of truth; `displays.lua` is derived from them. The CLI owns the store and the panel only calls the CLI.

The store is `$OMARCHY_DISPLAYS_CONFIG_DIR` (default `~/.config/omarchy/displays`): one `profiles/<name>.json` per profile, in the schema above, and `active`, a file holding the active profile's name. Writes are atomic (temp file in the same directory, then `mv`).

A name matches `^[A-Za-z0-9]([A-Za-z0-9 _-]{0,38}[A-Za-z0-9_-])?$`: 1 to 40 characters, starting with a letter or digit, never ending in a space. The name becomes a filename, so `..`, a slash, a leading dot and a trailing space are all refused with exit 3 and nothing is written. The stored profile's `name` field is always the file's name.

| Command | Behaviour |
|---|---|
| `profile list` | JSON array sorted by name: `{name, active, identities, modified}`; `modified` is the file's mtime in epoch seconds. `[]` for an empty store. |
| `profile show <name>` | The stored profile as JSON. Exit 3 if missing. |
| `profile save <file> [--name N] [--activate]` | Validates the file exactly as `apply` does, writes `profiles/<N or the file's name>.json` with `name` set to that name, and with `--activate` writes `active`. Prints `saved <name>`. |
| `profile delete <name>` | Removes the file, and clears `active` if it named this profile. Exit 3 if missing. |
| `profile activate <name>` | Writes `active`. Exit 3 if missing. |
| `profile match` | Prints the name of a stored profile whose set of identities equals the set `state` reports now (disabled monitors included), else prints nothing and exits 1. When several match, the active one wins, else the most recently modified. |

Identity sets are compared as sets: order and duplicates do not matter. A monitor present in the profile and not connected, or connected and not in the profile, means no match.

## Panel

The `kr34t1v.displays` plugin (`plugin/`, kind `panel`) opens from `omarchy-shell shell summon kr34t1v.displays '{}'` on the focused screen and closes on Escape. It never touches Hyprland or the disk itself: it runs `omarchy-displays` (the `cliPath` property, default `omarchy-displays` on `PATH`) and nothing else.

A profile row sits above the canvas: a dropdown of the stored profile names, and the buttons Save, Save as, Rename and Delete. The dropdown shows `(unsaved)` while the canvas differs from the selected profile (`Model.isDirty`) or none is selected, with "edited from <name>" beside it when a profile is selected. On open the panel loads the active profile if `profile list` names one; otherwise it shows live state as `(unsaved)`.

Choosing a profile loads it into the canvas without applying it (`Model.mergeProfile`): a connected monitor present in the profile takes the profile's fields (position, mode, scale, transform, mirror, vrr, bitdepth, cm, sdr values, enabled), which is what restores the fields `state` cannot report; a connected monitor absent from the profile keeps live state; a profile monitor that is not connected is not drawn but is kept in the profile on every save. Save writes the canvas over the selected profile and activates it (with none selected it asks for a name). Save as and Rename show an inline name field: Enter confirms, Escape cancels, and a name that fails the name rule or already exists is rejected under the field. Rename saves the stored profile under the new name, then deletes the old one, keeping `active` if it was the old one. Delete asks first with the stock `ConfirmDialog`. All of it goes through `profile save|show|delete`; the panel writes no file itself.

When `state` reports an `identityWarning` on any monitor, the panel's top-right line shows it in the urgent colour. It does not block anything.

It shows the connected monitors from `state` as one rectangle each, to scale. Along the bottom edge of each rectangle sit small dimmed chips, one per workspace assigned to that monitor (`Model.workspaceChips`): the rules from `workspaces` merged with the canvas profile's `workspaces`, the profile winning for a workspace both name, numbers first in numeric order, then names. A rule matches a monitor by the `desc:` prefix rule Hyprland uses, or by connector. Chips are hidden on a rectangle under 64 px tall. A single scale factor, computed in `plugin/Model.js`, fits the bounding box of all monitors into the canvas, and never enlarges past 1:1. Each rectangle has the logical size (pixels divided by scale, width and height swapped for transforms 1, 3, 5 and 7), a number, the model name and the connector. Pressing a rectangle selects it; dragging it moves it (cursor: open hand on hover, closed hand while dragging, accent border). The pointer delta is divided by the zoom factor, so positions are in layout pixels, and each move rewrites `monitors` once through `Model.applyDrag`: the rectangle snaps, is pushed out of any overlap, and is rounded to integers (never negative). Snapping aligns an edge to an edge of another rectangle (left or right to left or right, top or bottom to top or bottom) or a corner to a corner when both axes are within the threshold; a corner match wins over single-axis matches. The threshold is `round(16 / fit)` layout pixels, 16 canvas pixels at any zoom. Edge contact is allowed; real overlap is pushed out along the axis of least penetration, up to 8 passes. Zoom-to-fit stays automatic.

With a monitor selected the arrow keys nudge it 10 layout pixels, Shift+arrow 1, through the same path. A nudge snaps only within 4 pixels (none for Shift), because a snap radius at or above the step would pull every nudge back to the edge it left. Escape still closes the panel.

When a monitor shares no edge segment or corner with another, a line under the canvas reads "Gap: <model> is not touching another monitor" in the urgent colour. Apply stays enabled, since Hyprland accepts gaps. When any two rectangles overlap, the same line reads "Overlap: monitors must not overlap" instead, and Apply is disabled; dragging and nudging cannot cause an overlap, but a mode or scale change can. Below the canvas, two number fields edit the selected monitor's `x` and `y`; only non-negative integers are accepted.

Under the X and Y fields the selected monitor has two rows of controls, plus an Advanced section behind a toggle button at the left of the action row (closed on open, so the card keeps its size). Everything writes into the same `monitors` list as position, so Apply builds the profile unchanged; nothing reaches Hyprland before Apply.

- **Enabled** toggles `disabled`. A disabled monitor is drawn at 0.4 opacity and its other controls are dimmed and inactive; Apply sends it as `enabled: false` only.
- **Mode** is a dropdown of `Preferred`, `Highest resolution`, `Highest refresh rate`, then every real mode from `availableModes` as `1920 x 1080  75 Hz`, deduplicated by the profile value `WIDTHxHEIGHT@HZ` (refresh rounded) and sorted by width, height and refresh, descending. Choosing a real mode also rewrites `width`, `height` and `refreshRate` so the rectangle resizes; a special leaves them alone and is sent as the mode string. A chosen `modeValue` overrides the size and refresh in the profile.
- **Scale** is a row of buttons plus a free number field. The buttons are the clean scales from 1 to 2 for the monitor's current mode (at most six, evenly thinned when more qualify); the field takes any value above 0 up to 10 and commits on Enter or when it loses focus. "Logical: W x H" beside it is the mode after the transform swap divided by the scale, rounded.
- **Rotation** (Hyprland's `transform`) is a dropdown of the eight Hyprland values: Normal, 90°, 180°, 270°, Flipped, Flipped 90°, Flipped 180°, Flipped 270°.

The **Advanced** section is two rows, enabled only for an enabled monitor:

- **Mirror** is a dropdown of `None` and every other enabled monitor as `Model (connector)`, leaving out any monitor that already mirrors this one. Choosing one sets the monitor's `mirror` to that identity. While a monitor mirrors an enabled monitor, its X and Y fields are dimmed and inactive.
- **VRR** is `Off`, `On`, `Fullscreen only`, `Fullscreen with video or game`, the values 0 to 3 of Hyprland's `misc:vrr`.
- **Bit depth** is `8 bit` or `10 bit`. Choosing 10 bit shows "10 bit: some apps cannot screen-capture, and border colours stay 8 bit", from the Hyprland wiki's warning.
- **Colour** is the `cm` presets: `auto`, `srgb`, `dcip3`, `dp3`, `adobe`, `wide`, `edid`, `hdr` and `hdredid`, the last two labelled "(experimental)" as the wiki does.
- **SDR brightness** (1 to 2) and **SDR saturation** (0 to 2) are text fields that commit on Enter or when they lose focus. A value outside its range or not a number is dropped and the field shows the stored value again. The wiki names 1.0 to 2.0 as the typical brightness range and gives no range for saturation; both ranges here are this panel's choice.

A **Workspaces** button next to Advanced opens one row, closing Advanced (and the reverse), so the card keeps its size: a dropdown of workspace names (from `workspaces` merged with the profile), a dropdown of monitors as `Model (connector)`, `Default` and `Persistent` toggles, and the buttons Assign and Unassign. Choosing a workspace fills the row from its rule or profile entry. Assign writes the row into the canvas's `workspaces` list, replacing an entry with the same workspace name (`Model.upsertWorkspace`). Unassign removes that entry (`Model.removeWorkspace`), leaving the workspace to `workspaces.lua` and Hyprland; it is enabled only while the profile has an entry. Nothing reaches Hyprland before Apply, and a change to the list makes the canvas differ from the saved profile (`Model.isDirty` with the canvas list). Apply, Keep and Save send the list in the profile (`Model.toProfile` passes it through); Keep persists it.

### Monitor fields

`Model.toProfile` writes the fields below only when the monitor object carries them. A key the user edited wins over the key `state` reports.

| Profile field | From the user's edit | Else from `state` |
|---|---|---|
| `mirror` | `mirror` (an identity) | none; `state`'s `mirrorOf` is a connector name, so it is not read back |
| `vrr` | `vrrMode` (0 to 3) | `vrr` boolean: `false` is 0, `true` is 1 |
| `bitdepth` | `bitdepth` (8 or 10) | none; Hyprland does not report it |
| `cm` | `cm` | `colorManagementPreset` |
| `sdrbrightness` | `sdrBrightness` | `sdrBrightness` |
| `sdrsaturation` | `sdrSaturation` | `sdrSaturation` |

`mirror` is dropped when its target is disabled or not in the list. A disabled monitor is sent as `enabled: false` only. The `state` `vrr` boolean is the active state, so a monitor configured with mode 2 that reads `false` is written back as 0 on the next Apply unless the user picks a mode.

Checked live on this machine: `mirror` with a `desc:` identity and `enabled: false` both apply through `hyprctl eval`, drop the monitor from `hyprctl -j monitors` (the default list), move its windows to a remaining monitor, and come back on `hyprctl reload` with their windows.

A scale is clean when `width * 120` and `height * 120` are both divisible by `round(scale * 120)`, the rule `omarchy-hyprland-monitor-scaling` applies. An unclean scale on any enabled monitor shows "1.4 does not divide 1920x1080 cleanly (Hyprland would warn)" in the urgent colour under the controls (the selected monitor's, else the first offender's) and disables Apply. Apply is also disabled when every monitor is disabled or any two overlap. Arrow-key nudging only runs while no control has focus; Tab walks the controls and Escape still closes the panel.

Actions:

- **Apply** builds a schema version 1 profile named after the selected profile (`default` when none) from the shown monitors (`mode` as `WIDTHxHEIGHT@HZ` with the refresh rate rounded, or the chosen special, `position` as `XxY`, `scale` as a number, `transform` as 0 to 7) into a temporary file and runs `apply <file> --timeout 15`. On exit 0 the panel reads `status` and the stock `ConfirmDialog` opens. Exit 2 shows that a countdown is already running.
- **Keep** (the dialog's confirm button) runs, in one `bash -c` chain, `confirm`, then `profile save <tmp> --name <selected or default> --activate` with the canvas (profile-only monitors included), then `persist`. An unsaved canvas with no selected profile is saved as `default`. A failed `confirm` shows "Nothing to keep"; a failed profile save shows "Kept but the profile was not saved"; a failed `persist` shows "Kept but not saved (exit N)". After a Keep the canvas is re-merged from the saved profile, so it reads as clean.
- **Revert** (the button, the dialog's cancel button, or Escape in the dialog) runs `revert`.
- The dialog mirrors `status`: the panel polls it on open, after `apply` exits 0, and every second while the dialog shows. The dialog is open exactly while `countdown` is non-null and shows its `remaining`, so reopening the panel mid-countdown shows the dialog with the right seconds. When `status` flips to null the CLI has confirmed or reloaded, the dialog closes and the panel re-reads `state`.
- **Identify** shows a large badge for 3 seconds on every screen, numbered as the rectangles are. A badge sits on the screen whose name equals the monitor's connector.

Colours, radii, spacing and fonts come from the shell's `Color` and `Style` singletons, so a theme change recolours the open panel.

## Entry points

- **Menu.** `menu/omarchy-menu.jsonc` overrides `setup.monitors` and adds two children, merged into the user's menu extension by `install.sh`. `setup.monitors` takes `"action": ""`, which makes it a submenu (the menu runs a row's `action` and never opens its children, and an override can only replace a field, not delete it). `setup.monitors.displays` ("Displays") runs `omarchy-shell shell summon kr34t1v.displays '{}'`; `setup.monitors.edit` ("Edit monitors.lua") runs the default `omarchy-launch-config-editor "$HOME/.config/hypr/monitors.lua"`. The block sits between the comment lines `// >>> omarchy-displays ...` and `// <<< omarchy-displays <<<`, which `uninstall.sh` deletes; with the block gone the default `setup.monitors` applies again. The shell hot-reloads the file.
- **Bar widget.** `install.sh` clones the stock Display widget (`omarchy plugin clone omarchy.monitor`, id `kr34t1v.monitor`) and applies `patches/configure-button.patch` to the clone's `Panel.qml`. The patch adds a bordered Configure button under the DISPLAYS list, shown only when more than one display exists. Click, or Down to it and Return, closes the widget panel and calls `bar.shell.summon("kr34t1v.displays", "{}")`. The button joins the widget's keyboard cursor as a `configure` section. The patched file carries the marker line `// omarchy-displays: opens the Displays panel`, which `install.sh` greps to skip a second patch. A clone no longer follows upstream edits to the stock widget; a patch that fails to apply stops `install.sh` with a non-zero exit.
- **Desktop entry.** `desktop/omarchy-displays.desktop` is symlinked into `~/.local/share/applications/`, so the launcher (SUPER+SPACE) lists "Displays" for the keywords monitor, monitors, display, displays, screen and resolution. Its Exec is `omarchy-shell shell summon kr34t1v.displays {}`, the same call the button makes.
