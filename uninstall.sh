#!/usr/bin/env bash
set -euo pipefail

# omarchy:summary=Remove everything install.sh added and put the stock Display widget back
# omarchy:args=[--purge]
# omarchy:examples=./uninstall.sh|./uninstall.sh --purge

# Safe to re-run: each step reports "already gone" when there is nothing to do.
# Saved profiles stay under ~/.config/omarchy/displays unless --purge is given.

REPO=$(cd "$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")" && pwd)
ID=kr34t1v.displays
CLONE_ID=kr34t1v.monitor
STOCK_ID=omarchy.monitor
PLUGIN_LINK="$HOME/.config/omarchy/plugins/$ID"
CLONE_DIR="$HOME/.config/omarchy/plugins/$CLONE_ID"
CLI_LINK="$HOME/.local/bin/omarchy-displays"
CLI="$REPO/bin/omarchy-displays"
CONFIGURE_MARKER='// omarchy-displays: opens the Displays panel'
DESKTOP_LINK="$HOME/.local/share/applications/omarchy-displays.desktop"
HYPR_DIR="${OMARCHY_DISPLAYS_HYPR_DIR:-$HOME/.config/hypr}"
HYPRLAND_LUA="$HYPR_DIR/hyprland.lua"
CONFIG_DIR="${OMARCHY_DISPLAYS_CONFIG_DIR:-$HOME/.config/omarchy/displays}"
MENU_FILE="${OMARCHY_DISPLAYS_MENU_FILE:-$HOME/.config/omarchy/extensions/omarchy-menu.jsonc}"
MENU_BEGIN='>>> omarchy-displays'
MENU_END='<<< omarchy-displays'
LOADER_LINE=$("$CLI" loader-line)

purge=0
case "${1:-}" in
  "") ;;
  --purge) purge=1 ;;
  -h | --help) echo "Usage: ./uninstall.sh [--purge]"; exit 0 ;;
  *) echo "unknown option: $1" >&2; exit 2 ;;
esac

unlink_ours() {
  local target=$1 link=$2
  if [[ -L $link && $(readlink -f "$link") == "$(readlink -f "$target")" ]]; then
    rm -f "$link"
    echo "removed link: $link"
  elif [[ -e $link || -L $link ]]; then
    echo "left alone, not ours: $link"
  else
    echo "already gone: $link"
  fi
}

# Deletes the exact loader line and nothing else, so the file ends byte-identical
# to the backup install.sh took before it added the line.
remove_loader_line() {
  local tmp
  if [[ ! -f $HYPRLAND_LUA ]] || ! grep -qxF -- "$LOADER_LINE" "$HYPRLAND_LUA"; then
    echo "already gone: loader line in $HYPRLAND_LUA"
    return
  fi
  tmp=$(mktemp "$HYPRLAND_LUA.tmp.XXXXXX")
  grep -vxF -- "$LOADER_LINE" "$HYPRLAND_LUA" >"$tmp" || true
  chmod --reference="$HYPRLAND_LUA" "$tmp"
  mv -f "$tmp" "$HYPRLAND_LUA"
  echo "removed loader line from $HYPRLAND_LUA"
}

remove_generated_files() {
  local files=()
  [[ -e $HYPR_DIR/displays.lua ]] && files+=("$HYPR_DIR/displays.lua")
  while IFS= read -r f; do files+=("$f"); done < <(compgen -G "$HYPR_DIR/displays.lua.bak.*" || true)
  if ((${#files[@]})); then
    rm -f -- "${files[@]}"
    echo "removed ${#files[@]} generated file(s): displays.lua and its backups in $HYPR_DIR"
  else
    echo "already gone: displays.lua and its backups in $HYPR_DIR"
  fi
}

# Deletes the marked block install.sh inserted. A file install.sh created
# (nothing left but the braces) is removed too.
remove_menu_entry() {
  local tmp
  if [[ ! -f $MENU_FILE ]] || ! grep -qF -- "$MENU_BEGIN" "$MENU_FILE"; then
    echo "already gone: menu entry in $MENU_FILE"
    return
  fi
  tmp=$(mktemp "$MENU_FILE.tmp.XXXXXX")
  awk -v b="$MENU_BEGIN" -v e="$MENU_END" '
    index($0, b) { skip = 1 }
    !skip { print }
    skip && index($0, e) { skip = 0 }
  ' "$MENU_FILE" >"$tmp"
  if [[ $(tr -d '[:space:]' <"$tmp") == '{}' ]]; then
    rm -f "$tmp" "$MENU_FILE"
    echo "removed menu entry and the empty $MENU_FILE"
  else
    chmod --reference="$MENU_FILE" "$tmp"
    mv -f "$tmp" "$MENU_FILE"
    echo "removed menu entry from $MENU_FILE"
  fi
}

# Removing an enabled clone makes the shell restore the stock widget in the
# clone's bar position; the folder is moved to a hidden backup, not deleted.
restore_stock_widget() {
  if [[ ! -d $CLONE_DIR ]]; then
    echo "already gone: $CLONE_DIR"
  elif ! grep -qF -- "$CONFIGURE_MARKER" "$CLONE_DIR/Panel.qml" 2>/dev/null; then
    echo "left alone, no Configure patch in it: $CLONE_DIR"
  else
    omarchy plugin remove "$CLONE_ID" --yes
  fi
  if omarchy-shell shell listPlugins | jq -e --arg id "$STOCK_ID" 'any(.[]; .id == $id and .enabled)' >/dev/null; then
    echo "stock widget active: $STOCK_ID"
  else
    omarchy plugin enable "$STOCK_ID"
  fi
}

remove_loader_line
remove_generated_files

if [[ -L $PLUGIN_LINK && $(readlink -f "$PLUGIN_LINK") == "$(readlink -f "$REPO/plugin")" ]]; then
  omarchy plugin remove "$ID" --yes
else
  unlink_ours "$REPO/plugin" "$PLUGIN_LINK"
fi
unlink_ours "$CLI" "$CLI_LINK"
unlink_ours "$REPO/desktop/omarchy-displays.desktop" "$DESKTOP_LINK"
if command -v update-desktop-database >/dev/null; then
  update-desktop-database "$(dirname "$DESKTOP_LINK")"
  echo "updated desktop database"
fi

remove_menu_entry
restore_stock_widget

if ((purge)); then
  if [[ -d $CONFIG_DIR ]]; then
    rm -rf -- "$CONFIG_DIR"
    echo "purged profiles: $CONFIG_DIR"
  else
    echo "already gone: $CONFIG_DIR"
  fi
elif [[ -d $CONFIG_DIR ]]; then
  echo "kept profiles in $CONFIG_DIR (--purge deletes them)"
fi

hyprctl reload >/dev/null
echo "reloaded Hyprland"
errors=$(hyprctl configerrors)
echo "hyprctl configerrors: ${errors:-(none)}"
[[ -z $errors ]]
