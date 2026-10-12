#!/usr/bin/env bash
set -euo pipefail

# omarchy:summary=Install the displays plugin and CLI into this user's Omarchy and Hyprland config
# omarchy:args=(none)
# omarchy:examples=./install.sh

# Safe to re-run: a second run changes nothing and prints doctor's verdict again.
# Edits under plugin/ reach the shell through the symlink only after `omarchy restart shell`.

REPO=$(cd "$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")" && pwd)
ID=kr34t1v.displays
PLUGIN_LINK="$HOME/.config/omarchy/plugins/$ID"
CLI_LINK="$HOME/.local/bin/omarchy-displays"
CLI="$REPO/bin/omarchy-displays"
CLONE_DIR="$HOME/.config/omarchy/plugins/kr34t1v.monitor"
CONFIGURE_PATCH="$REPO/patches/configure-button.patch"
CONFIGURE_MARKER='// omarchy-displays: opens the Displays panel'
DESKTOP_SRC="$REPO/desktop/omarchy-displays.desktop"
DESKTOP_LINK="$HOME/.local/share/applications/omarchy-displays.desktop"
HYPR_DIR="${OMARCHY_DISPLAYS_HYPR_DIR:-$HOME/.config/hypr}"
HYPRLAND_LUA="$HYPR_DIR/hyprland.lua"
LOADER_LINE=$("$CLI" loader-line)
ANCHOR='require("default.hypr.toggles")'

link() {
  local target=$1 link=$2
  if [[ -L $link && $(readlink -f "$link") == "$(readlink -f "$target")" ]]; then
    echo "already linked: $link"
  elif [[ -e $link || -L $link ]]; then
    echo "refusing to replace existing $link" >&2
    exit 1
  else
    mkdir -p "$(dirname "$link")"
    ln -s "$target" "$link"
    echo "linked: $link -> $target"
  fi
}

# Inserts the loader line just before the toggles require, so the generated
# rules override monitors.lua while Omarchy's laptop-disable toggle still wins.
add_loader_line() {
  local tmp
  if grep -qF -- "$LOADER_LINE" "$HYPRLAND_LUA"; then
    echo "already present: loader line in $HYPRLAND_LUA"
    return
  fi
  cp -p "$HYPRLAND_LUA" "$HYPRLAND_LUA.bak.$(date +%s)"
  tmp=$(mktemp "$HYPRLAND_LUA.tmp.XXXXXX")
  if grep -qF -- "$ANCHOR" "$HYPRLAND_LUA"; then
    awk -v loader="$LOADER_LINE" -v anchor="$ANCHOR" \
      '!done && index($0, anchor) { print loader; done = 1 } { print }' "$HYPRLAND_LUA" >"$tmp"
  else
    { cat "$HYPRLAND_LUA"; echo "$LOADER_LINE"; } >"$tmp"
  fi
  chmod --reference="$HYPRLAND_LUA" "$tmp"
  mv -f "$tmp" "$HYPRLAND_LUA"
  echo "added loader line to $HYPRLAND_LUA"
}

# Clones the stock Display widget and adds the Configure button to the clone.
# Cloning replaces the bar widget, so the shell must rescan to pick up the patch.
patch_monitor_clone() {
  local changed=0
  if [[ -d $CLONE_DIR ]]; then
    echo "already cloned: $CLONE_DIR"
  else
    omarchy plugin clone omarchy.monitor
    echo "cloned omarchy.monitor to $CLONE_DIR"
    changed=1
  fi
  if grep -qF -- "$CONFIGURE_MARKER" "$CLONE_DIR/Panel.qml"; then
    echo "already patched: $CLONE_DIR/Panel.qml"
  else
    if ! patch -d "$CLONE_DIR" -p1 --forward --no-backup-if-mismatch -r - <"$CONFIGURE_PATCH"; then
      echo "configure-button.patch does not apply to $CLONE_DIR/Panel.qml; the stock widget changed" >&2
      exit 1
    fi
    echo "patched: Configure button in $CLONE_DIR/Panel.qml"
    changed=1
  fi
  if ((changed)); then
    omarchy-shell shell rescanPlugins
    echo "rescanned plugins for the patched Display widget"
  fi
}

link_desktop_entry() {
  link "$DESKTOP_SRC" "$DESKTOP_LINK"
  if command -v update-desktop-database >/dev/null; then
    update-desktop-database "$(dirname "$DESKTOP_LINK")"
    echo "updated desktop database"
  fi
}

link "$REPO/plugin" "$PLUGIN_LINK"
link "$CLI" "$CLI_LINK"

case ":$PATH:" in
  *":$HOME/.local/bin:"*) ;;
  *) echo "note: $HOME/.local/bin is not on PATH; the panel will not find omarchy-displays" >&2 ;;
esac

omarchy-shell shell rescanPlugins
echo "rescanned plugins"
# The rescan returns before the registry has finished walking the plugin dirs.
for _ in $(seq 1 25); do
  omarchy-shell shell listPlugins | jq -e --arg id "$ID" 'any(.[]; .id == $id)' >/dev/null && break
  sleep 0.2
done
omarchy plugin enable "$ID"
echo "enabled $ID"

patch_monitor_clone
link_desktop_entry

add_loader_line
# doctor reads OMARCHY_DISPLAYS_LOADED from the running config, so a first
# install needs a displays.lua that sets it even before any profile exists.
if [[ ! -e $HYPR_DIR/displays.lua ]]; then
  "$CLI" persist --empty
else
  hyprctl reload >/dev/null
fi
"$CLI" doctor
