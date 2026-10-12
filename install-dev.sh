#!/usr/bin/env bash
set -euo pipefail

# omarchy:summary=Symlink the plugin and CLI into this user's Omarchy and enable them
# omarchy:args=(none)
# omarchy:examples=./install-dev.sh

# Safe to re-run: an existing correct link is left alone.
# Edits under plugin/ reach the shell through the symlink only after `omarchy restart shell`.

REPO=$(cd "$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")" && pwd)
ID=kr34t1v.displays
PLUGIN_LINK="$HOME/.config/omarchy/plugins/$ID"
CLI_LINK="$HOME/.local/bin/omarchy-displays"

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

link "$REPO/plugin" "$PLUGIN_LINK"
link "$REPO/bin/omarchy-displays" "$CLI_LINK"

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
