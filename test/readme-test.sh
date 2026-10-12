#!/usr/bin/env bash
set -euo pipefail

# Fails when README.md drifts from install.sh, uninstall.sh or `omarchy-displays help`.

here=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
repo=$(dirname "$here")
readme="$repo/README.md"
fails=0

fail() { echo "FAIL: $*" >&2; fails=$((fails + 1)); }

# The first bash fence under a "## <heading>" line.
fence_under() {
  awk -v h="## $1" '
    $0 == h { in_section = 1; next }
    in_section && /^## / { exit }
    in_section && /^```bash$/ { in_fence = 1; next }
    in_fence && /^```$/ { exit }
    in_fence { print }
  ' "$readme"
}

# The `# omarchy:examples=` value of a script, first alternative.
documented_invocation() {
  sed -n 's/^# omarchy:examples=//p' "$1" | head -1 | cut -d'|' -f1
}

install_block=$(fence_under Install)
[[ $install_block == *"git clone "* ]] || fail "install block has no git clone line"
install_cmd=$(documented_invocation "$repo/install.sh")
[[ $install_block == *"$install_cmd"* ]] \
  || fail "install block does not run '$install_cmd', install.sh's documented invocation"

uninstall_block=$(fence_under Uninstall)
uninstall_cmd=$(documented_invocation "$repo/uninstall.sh")
[[ $uninstall_block == "$uninstall_cmd" ]] \
  || fail "uninstall block is '$uninstall_block', uninstall.sh documents '$uninstall_cmd'"

# Every script the README tells you to run exists and is executable.
for script in install.sh uninstall.sh; do
  [[ -x $repo/$script ]] || fail "$script is missing or not executable"
done
for path in $(fence_under Tests | awk '{ print $NF }' | grep -E '^(test|plugin)/'); do
  [[ -e $repo/$path ]] || fail "README Tests block names $path, which does not exist"
done

# The CLI list is the set of commands help prints, usage text included.
help_cmds=$("$repo/bin/omarchy-displays" help | sed -n '2,$p' | sed -E 's/^  //; s/  +[^ ].*$//' | sort)
readme_cmds=$(sed -n '/^## CLI$/,/^## How it works$/p' "$readme" \
  | sed -nE 's/^- `omarchy-displays ([^`]+)`:.*/\1/p' | sort)
if [[ $help_cmds != "$readme_cmds" ]]; then
  fail "CLI list differs from 'omarchy-displays help':"
  diff <(echo "$help_cmds") <(echo "$readme_cmds") >&2 || true
fi

grep -qF '—' "$readme" && fail "README contains an em dash"

if ((fails)); then
  printf '%d failed\n' "$fails" >&2
  exit 1
fi
echo "readme-test: ok"
