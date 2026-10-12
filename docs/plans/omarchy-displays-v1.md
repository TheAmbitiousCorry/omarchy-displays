---
created: 2026-10-12
spec-impact: creates docs/context/displays.md and docs/context/core/conventions.md (new repo, no spec yet; step 1 bootstraps both)
---

# omarchy-displays v1

A display-settings GUI for Omarchy. An Omarchy shell plugin (Quickshell QML)
for the UI, a bash CLI for everything that touches Hyprland or disk, so the
CLI also works from a TTY when the shell is the thing that is broken.

## Goal

A user opens Setup > Monitors from the Omarchy menu and gets a panel that
shows their real monitor layout to scale, lets them drag monitors into place
with snapping, pick mode, refresh, scale, rotation, mirror, VRR, bit depth and
colour preset per monitor, assign workspaces, and press Apply. The change goes
live at once, a keep-or-revert countdown runs, and a kept change is written to
a generated Lua file that Hyprland loads on every start. Layouts are stored as
named profiles keyed by monitor identity (make, model, serial), never by
connector, so swapping a cable or plugging a new monitor in never puts the
wrong rule on the wrong screen. Config for monitors that are not plugged in
is never lost. When the set of connected monitors matches a saved profile, it
is applied without opening the panel.

Research behind this (five angles, each adversarially re-verified, 98 of 100
sampled claims confirmed) is summarised in the Research section at the end.

## Non-goals

- Lid and clamshell handling. Omarchy already owns it in
  `omarchy-hyprland-monitor-watch` and `omarchy-hyprland-monitor-internal`;
  the plugin must coexist with both, not replace them.
- Brightness, night light and text size. The stock `omarchy.monitor` bar
  widget and `omarchy display text size` already do these. The panel links to
  them, it does not reimplement them.
- Rewriting the stock `omarchy.monitor` widget. Step 8b clones it the
  Omarchy way and patches in one Configure button; its scale presets are
  superseded while a profile is active (see Decisions) and the README says
  so rather than removing them.
- ICC profiles, HDR tuning beyond the `cm` preset and SDR brightness and
  saturation, custom modelines, DDC/CI. All possible later through the same
  per-monitor field model; none in v1.
- Legacy hyprlang (`monitors.conf`) output. Hyprland 0.55 and later is Lua
  only; Omarchy 4 is on 0.56.
- Per-application refresh switching, kanshi config import, a second hotplug
  daemon.
- Editing the user's hand-written `monitors.lua`. The plugin never reads or
  writes it; its own generated file loads after it and wins.
- Upstreaming into Omarchy in v1. The layout is kept upstreamable (nothing
  user-specific outside the plugin id), but the target is a third-party
  plugin installed with `omarchy plugin add`.

## Decisions already made

| Decision | Choice | Why |
|---|---|---|
| UI host | Omarchy shell plugin, kinds `panel` and `service`, id `kr34t1v.displays`, summoned by IPC | Only a plugin shares the shell process and the theme singletons (Style, Color). A GTK or standalone Qt app would be unthemed. Stock `omarchy.monitor` is a `bar-widget`, too small for a layout canvas, so this is a new panel, not a clone. |
| Engine | `omarchy-displays` bash CLI, coreutils and `jq`, no Python, no daemon | Matches Omarchy's `omarchy-<group>-<verb>` scripts and the house convention set by omarchy-sysmon. Gives a rescue path (`omarchy-displays revert`) when the shell is down. |
| One writer, one matcher | Lua generation, identity derivation and profile matching live only in the CLI. `Model.js` holds geometry, snapping and field validation only. The service calls `omarchy-displays hotplug` and nothing else. | Two Lua writers drift. The TTY rescue path and the hotplug path both need the writer without the shell. |
| Live apply | `hyprctl eval 'hl.monitor({...})'` per monitor | `hyprctl keyword monitor` is rejected under the Lua parser. Eval confirmed live on this machine (Samsung 75 to 60Hz). |
| Revert | `hyprctl reload` | Confirmed: reload re-reads the files and discards eval'd state (Samsung back to 74.97). No separate undo bookkeeping. |
| Countdown owner | The CLI, detached (`setsid`), not the QML. A lock file under `$XDG_RUNTIME_DIR/omarchy-displays/` marks a running countdown; `apply` and `hotplug` refuse while it exists. | Survives a shell crash mid-countdown. The lock stops a second apply, or a hotplug profile, from fighting an unconfirmed change. |
| Persistence | Generated `~/.config/hypr/displays.lua`, loaded by `pcall(require, "hypr.displays")` added to `hyprland.lua` after the user's requires and before `default.hypr.toggles` | User rules stay as fallback, generated rules override them, Omarchy's laptop-disable toggle still wins. `pcall` means a bad generated file can never take the rest of the config down. The include-chain check applies a sentinel rule through the file and reads it back (nwg-displays' silent no-op, issue #143). |
| Source of truth | `~/.config/omarchy/displays/profiles/<name>.json` with `"schemaVersion": 1`; the Lua file is derived and carries a generator version header | Hyprland's JSON omits bitdepth, vrr mode and sdr_eotf, so live state alone cannot round-trip. The version field is the one-way door we pay for now. |
| Identity | `desc:<make> <model> <serial>`; `desc:<make> <model>` when serial is empty; connector only when two identical monitors have no serial, with a warning in the panel | Hyprland matches `desc:` as a prefix up to the port name. hyprmon and hyprmoncfg both land here. |
| Profiles | Keyed by the set of monitor identities present; one is active; an apply never deletes rules for monitors it does not include | nwg-displays #109 (settings erased for unplugged monitors) is the most-cited data-loss complaint. |
| Profile names | `^[A-Za-z0-9][A-Za-z0-9 _-]{0,39}$`, used as the filename | Names become paths. |
| Hotplug | The `service` entry point watches socket2 and, 2 seconds after the last `configreloaded`, runs `omarchy-displays hotplug`. No new daemon. | Omarchy's monitor-watch reacts to the same events and reloads; acting after its reload, with a debounce, avoids the two-actor race and the double apply when a dock enumerates monitors one at a time. |
| Stock scale presets | Superseded while a profile covers the monitor. README and the panel say so. | `omarchy-hyprland-monitor-scaling` evals then writes `monitors.lua`; the generated file would silently win on the next reload. Saying so beats a surprise. |
| Backups | `displays.lua.bak.<ts>`, keep the newest 10 | hyprmon's unbounded backups are a named complaint. |
| Lua safety | Every string written into Lua is validated against `^[A-Za-z0-9 ._:@/+-]+$` and quoted; anything else refuses to apply with a non-zero exit | EDID strings are attacker-controlled. Omarchy sanitises connector names for the same reason in `omarchy-hyprland-monitor-scaling`. |
| JS tests | `node` (installed via mise) runs `Model.js` tests; no Quickshell in the test loop | `Model.js` is pure JS by the decision above. |

## Unknowns

Resolve these in the step that first needs them; none blocks step 1.

1. Per-monitor `vrr` integer meanings (0 off, 1 on, 2 fullscreen only, 3
   content-typed, per the Variables page). Step 5b confirms against the wiki
   and a live eval.
2. Whether `hl.monitor` eval with `mirror` or `disabled = true` behaves like
   the config-time rule, including window migration. Step 5b tests both on
   this machine.
3. Whether a `panel` plugin window can be sized to a layout canvas (around
   900x600 logical) and accept drag with `MouseArea`. Step 2 proves the
   window, step 4 the drag.
4. Whether a later `hl.monitor` rule for the same `desc:` replaces an earlier
   one (the override premise). Step 3's verification is the test.
5. Whether socket2 `monitoraddedv2` fires before or after monitor-watch's
   `hyprctl reload`, and whether `configreloaded` is a reliable "safe to act"
   signal. Step 8 traces both with a real unplug on this machine.
6. The user's custom workspace pairing in `workspaces.lua` (Super+1..5
   switches two monitors at once). Step 7 decides whether the panel reads the
   assignment from `hyprctl workspacerules` and leaves the keybinds alone, or
   owns both. Default assumption: reads and leaves keybinds alone.
7. Whether `omarchy plugin add` can run a post-install hook, or whether the
   panel must offer "Finish install" on first summon. Step 9.
8. Which notification call Omarchy's own scripts use (`notify-send`,
   `hl.notification`, or an `omarchy` helper). Step 8 greps and copies it.

## Steps

Each step ends with its verification run on this machine (three 1080p
monitors: Samsung S27C31x on DP-1, Dell SE2726H on DP-2, ASUS VG27V on
HDMI-A-1). A step that changes spec-described behaviour updates
`docs/context/displays.md` in the same commit. Steps that add bash follow
`conventions.md` entries `script-header` (the `# omarchy:summary` block) and
`lua-whitelist`; steps that add JS follow `model-pure` (no Quickshell
imports in `Model.js`).

### 1. CLI core: state, apply, confirm, revert

Delivers `bin/omarchy-displays` with `state` (hyprctl JSON plus the derived
identity per monitor), `apply <profile.json>` (evals each monitor rule, takes
the lock, detaches a 15 second countdown that runs `hyprctl reload` unless
`confirm` arrives), `confirm`, `revert`. Bootstraps `docs/context/displays.md`
with the profile schema and `docs/context/core/conventions.md` with the three
conventions named above.

- [x] Verification: a profile setting the Samsung to 60Hz, applied with
      `apply`: `hyprctl -j monitors` shows 60.0 within 2 seconds; with no
      `confirm`, 15 seconds later it shows 74.97. Again with `confirm`: it
      stays at 60.0 (until the manual restore to 75). A second `apply` during
      the countdown exits non-zero naming the lock. A profile whose
      description contains `"` exits non-zero with no eval issued.
- Spec domain: engine.

### 2. Panel on screen, end to end

Delivers the plugin skeleton under `plugin/` (`manifest.json`, `Panel.qml`,
`Model.js`), symlinked into `~/.config/omarchy/plugins/kr34t1v.displays/`.
The canvas draws each connected monitor from `omarchy-displays state` as a
rectangle at its scaled, transformed logical size and position, labelled with
identity and connector. Position is editable with two `NumberField`s per
monitor (no drag yet). Apply builds the profile JSON, calls `apply`, and shows
the stock `ConfirmDialog` with a live countdown; Keep calls `confirm`. An
Identify button flashes a numbered badge on each physical screen for 3
seconds, reusing the shell's OSD overlay surface if it accepts a payload,
else a minimal `overlay` entry point.

- [x] Verification: `omarchy-shell shell summon kr34t1v.displays` opens a
      panel showing three rectangles matching the ASCII diagram in
      `~/.config/hypr/monitors.lua`. Changing the Dell's y to 0 and applying
      moves it live; letting the countdown lapse puts it back. Theme switch
      with `omarchy theme set` recolours the panel without restart. Identify
      shows 1, 2, 3 on the right screens. Screenshots under `.proof/` per
      `verify:visual-proof`.
- Spec domain: ui.

### 3. Persist, with the include chain verified

Delivers `persist` (writes `displays.lua` from the profile through the
whitelist, rotates backups, reloads), `doctor` (is the `pcall(require)` line
present and live), and `install.sh` which adds the require line, verifies it
with a sentinel rule, and symlinks the plugin and the CLI. Keep in the panel
now calls `confirm` then `persist`.

- [x] Verification: with `monitors.lua` still saying 75Hz for the Samsung,
      keeping a 60Hz change writes `displays.lua`, and `hyprctl reload`
      leaves the Samsung at 60.0 (unknown 4 settled). Removing the require
      line makes `doctor` exit non-zero and `install.sh` restore it. Twelve
      persists leave exactly 10 backups. A deliberately corrupted
      `displays.lua` plus `hyprctl reload` leaves `hyprctl configerrors`
      naming only that file and the keybinds still working.
- Spec domain: engine, install.

### 4. Drag and snap

Delivers drag-to-arrange with edge and corner snapping, overlap rejection,
gap detection and zoom-to-fit, as pure functions in `Model.js` with `node`
tests.

- [x] Verification: tests cover snap within threshold, no snap outside it,
      corner-to-corner, overlap rejected, rotated monitor uses swapped
      dimensions, scaled monitor uses logical size. In the panel, drag the
      Dell from above the ASUS to its right, Keep: `displays.lua` holds
      `position = "3840x1080"` for the Dell. Drag it back the same way.
- Spec domain: ui.

### 5a. Per-monitor controls: mode, scale, transform

Delivers the detail pane: enabled toggle, mode dropdown from `availableModes`
deduplicated and sorted with `preferred`, `highrr` and `highres` on top,
scale with presets plus free entry validated by the clean-divisor rule
(`(w*120) % (scale*120) == 0`, same for height, after the Omarchy scaling
script), effective logical size beside it, transform with 8 values.

- [x] Verification: scale 1.4 on 1920x1080 is rejected inline with the
      wiki's reason; 1.5 is accepted and reads 1280x720. Setting the Samsung
      to 60Hz through the dropdown and keeping it produces a `displays.lua`
      identical to step 3's. Transform 1 on the Dell rotates it live and the
      canvas shows it tall.
- Spec domain: ui, engine.

### 5b. Per-monitor controls: mirror, disable, VRR, bit depth, colour

Delivers mirror-of, VRR (unknown 1), bit depth 8 or 10, colour preset, SDR
brightness and saturation. Mirror and disabled tested live (unknown 2).

- [ ] Verification: mirroring the Dell onto the ASUS shows the same image on
      both; disabling the Dell moves its windows to the ASUS; both revert
      without Keep. VRR and bit depth values round-trip through
      `displays.lua` and `hyprctl -j monitors` where the JSON exposes them.
- Spec domain: ui, engine.

### 6. Identity and profiles

Delivers profile storage, the identity rules from the decisions table, and
a profile list in the panel with save, rename, duplicate, delete and apply.
The generated `displays.lua` carries a rule per monitor in every profile,
grouped by identity, so an unplugged monitor keeps its rule.

- [ ] Verification: save the current layout as `desk`. Edit the JSON to add
      a fourth, fictional identity. Apply `desk`: the three real monitors are
      unchanged and `displays.lua` still contains the fourth rule. A name
      with `../` is refused. Two monitors with the same make and model and an
      empty serial produce a panel warning and connector rules in the file.
- Spec domain: engine, ui.

### 7. Workspace assignment

Delivers a per-monitor workspace list with drag between monitors and a
"default" marker, written as `hl.workspace_rule` into `displays.lua`
(unknown 6 settled here). Existing rules read from `hyprctl -j workspacerules`.

- [ ] Verification: moving workspace 6 from the Dell to the Samsung and
      keeping it makes `hyprctl -j workspacerules` show the Samsung identity
      for workspace 6 and `Super+6` opens it there. The paired keybinds in
      `workspaces.lua` still work for 1 through 5.
- Spec domain: engine, ui.

### 8. Hotplug profile matching

Delivers `omarchy-displays hotplug` (present identity set, exact-match
profile, `persist` without countdown, notification) and the `service` entry
point with the 2 second debounce. Unknowns 5 and 8 settled first and
recorded in the spec.

- [ ] Verification: save a two-monitor profile `no-dell` first. Unplug the
      Dell: within 5 seconds a notification names `no-dell`, the Samsung and
      ASUS are where `no-dell` says, and `displays.lua` still holds the
      Dell's rule. Plug it back: `desk` is applied and all three are back.
      `journalctl -t omarchy-hyprland-monitor-watch` shows no reload loop.
      During a running countdown, a hotplug exits non-zero on the lock and
      retries after it clears.
- Spec domain: engine.

### 8b. Entry points: bar widget button and launcher entry

Delivers (1) a Configure button at the foot of the stock Display widget's
DISPLAYS section, added by cloning `omarchy.monitor` with
`omarchy plugin clone` and applying `patches/configure-button.patch` from
`install.sh`, the pattern omarchy-sysmon uses for its bar fork; the button
summons `kr34t1v.displays` through the clone's shell facade; (2) a desktop
entry `omarchy-displays.desktop` in `~/.local/share/applications/` with
Keywords monitor, display, displays, screen, so the launcher finds the
panel; (3) install.sh does both idempotently.

- [ ] Verification: the bar's Display widget shows Configure under its
      displays list and clicking it (or Return on it) opens the panel.
      Typing "monitor" and "displays" in the Omarchy launcher lists
      "Displays" and launching it opens the panel. `install.sh` twice
      leaves one clone and one desktop file. Screenshots under `.proof/`.
- Spec domain: install, ui.

### 9. Uninstall, menu, docs

Delivers `uninstall.sh` (restores `hyprland.lua` from its backup, removes
the symlinks and menu entry), the menu extension that points Setup > Monitors
at the panel and keeps "Edit monitors.lua" as a sub-entry, and a README in
the omarchy-sysmon style per `writing:technical-writing`. Unknown 7 settled.

- [ ] Verification: `uninstall.sh` leaves `hyprland.lua` and the menu file
      byte-identical to their pre-install backups and `hyprctl configerrors`
      is empty. `install.sh` from a fresh clone brings the panel back and
      `doctor` passes. A test greps the README's install block and finds it
      identical to `install.sh`'s documented invocation.
- Spec domain: docs, install.

## Deviation log

- 2026-10-12, step 3: no departure on the loader (`hyprctl reload` runs a
  fresh Lua state, so `pcall(require, "hypr.displays")` stands). The sentinel
  rule became a marker: `hyprctl eval` prints only `ok` or an error, so
  `doctor` asserts `OMARCHY_DISPLAYS_LOADED` equals the version instead of
  applying and reading back a rule. Added `persist --empty` (so a fresh
  install has a marker) and `loader-line`; profile `name` now passes the
  string whitelist because it is written into a Lua comment; `install.sh`
  backs up `hyprland.lua` only on a run that changes it; `install-dev.sh` is
  replaced by `install.sh`.

- 2026-10-12, user scope change: a Configure button in the stock Display
  bar widget and a launcher entry, added as step 8b; the non-goal on the
  stock widget narrowed to "no rewrite".
- 2026-10-12, step 5a: verified by keyboard: unclean scale blocks Apply,
  1.5 reads 1280x720, the mode dropdown selects 120 Hz, transform 1 on the
  Dell applied live and lapsed. The Apply button cannot be reached by Tab
  from here, so "mode change from the dropdown, then Apply and Keep" joins
  the user's mouse checklist; its pieces (dropdown writes modeValue,
  toProfile prefers modeValue, Keep persists) are each proven.
- 2026-10-12, step 4: no pointer-synthesis tool on this machine, so the
  mouse drag was verified only through its shared code path (keyboard
  nudge walks the same applyDrag). A real drag and the Keep that follows
  are on the user's checklist. Nudge uses a smaller snap radius than
  drag, or every 10 px step snapped back to the edge it left.
- 2026-10-12, step 2: the shell does not see QML edits made through the
  plugin symlink, so a changed Panel.qml needs `omarchy restart shell`;
  install-dev.sh says so. Roast moved the countdown clock into the CLI
  (`status`) so the panel can reopen mid-countdown, dropped the fake
  mode/position/scale the validator forced onto disabled monitors, and
  removed an unused Model.js export.

- 2026-10-12, before step 1, roast-plan pass: moved the require line and
  include-chain check from the last step to step 3 (every "survives reload"
  verification depended on it); collapsed two Lua writers into the CLI;
  split per-monitor controls into 5a and 5b; added the countdown lock,
  profile-name whitelist, `pcall` guard, schema version, hotplug debounce,
  and the stock scale-preset conflict as a documented decision.

## Research

Five parallel research angles, each adversarially re-verified against its
sources. The claims below drove the decisions table.

What incumbents are praised for:
- wdisplays: drag with snapping, live preview, zoom and pan.
- nwg-displays: identify overlay, snap threshold, writes config files.
- kanshi: profiles that switch on hotplug, matching by make, model, serial.
  The gold standard Hyprland users compare against.
- hyprmoncfg (the closest Hyprland competitor): safe apply with revert,
  include-chain verification, identity matching, hotplug and lid daemon.
- Windows and GNOME: keep-or-revert countdown is the expected safety net.

What incumbents are hated for:
- nwg-displays reports success when nothing includes its file (#143),
  erases settings for unplugged monitors (#109), has no profiles (#2, the
  most-reacted issue, and #88), matches by connector name.
- wdisplays does not persist on Hyprland; the next hotplug restores the
  config rules.
- hyprmon applies live via connector names, never auto-switches, leaves
  unbounded backups.
- KDE, Windows: layouts lost on dock, sleep or lid. Fractional scaling blur
  on XWayland (GNOME, Hyprland). macOS hides resolutions.
- Omarchy specifically: the manual sends users to hand-edit the config and
  to a TUI; the top Hacker News comment on Omarchy names multi-monitor setup
  as the blocker.

Hyprland 0.56 surface a GUI can drive: mode (incl. preferred, highres,
highrr), position, scale with the clean-divisor rule, transform 0 to 7,
mirror, disabled, vrr, bitdepth, cm presets (auto, srgb, dcip3, dp3, adobe,
wide, edid, hdr, hdredid), sdr_eotf, sdrbrightness, sdrsaturation, icc,
reserved_area, workspace rules. Live apply is `hyprctl eval`, revert is
`hyprctl reload`, events are socket2.

Omarchy integration points: plugin manifest kinds (`panel`, `service`,
`overlay`), `omarchy-shell shell summon`, the `qs.Ui` widget kit
(`ConfirmDialog`, `Dropdown`, `NumberField`, `Toggle`), theme singletons, the
JSONC menu with `setup.monitors` currently opening an editor, and the
precedent of `omarchy-hyprland-monitor-scaling` (eval then persist, with
input sanitising).
