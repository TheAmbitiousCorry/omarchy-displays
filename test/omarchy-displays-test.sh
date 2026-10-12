#!/usr/bin/env bash
# Runs against a fake hyprctl on PATH so no case can reach the real monitors.
set -euo pipefail

here=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
cli="${1:-$here/../bin/omarchy-displays}"
root=$(mktemp -d)
export XDG_RUNTIME_DIR="$root/run"
export FAKE_LOG="$root/hyprctl.log"
lock="$XDG_RUNTIME_DIR/omarchy-displays/countdown"
mkdir -p "$root/bin" "$XDG_RUNTIME_DIR"

cleanup() {
  local pid
  [[ -f $lock/pid ]] && pid=$(<"$lock/pid") && kill "$pid" 2>/dev/null || true
  rm -rf "$root"
}
trap cleanup EXIT

cat > "$root/bin/hyprctl" <<'FAKE'
#!/usr/bin/env bash
if [[ $* == "-j monitors all" ]]; then
  cat "$FAKE_FIXTURE"
else
  printf '%s\n' "$*" >> "$FAKE_LOG"
  echo ok
fi
FAKE
chmod +x "$root/bin/hyprctl"
export PATH="$root/bin:$PATH"

passes=0
fails=0

reset() { # clears the log and any lock left by a previous case
  : > "$FAKE_LOG"
  rm -rf "$lock"
}

run() { # args -> $out and $rc, stderr folded into out
  out=$(bash "$cli" "$@" 2>&1) && rc=0 || rc=$?
}

eq() { # name got want
  if [[ $2 == "$3" ]]; then
    printf 'ok   %s\n' "$1"
    passes=$((passes + 1))
  else
    printf 'FAIL %s\n  want: %s\n  got:  %s\n' "$1" "$3" "$2"
    fails=$((fails + 1))
  fi
}

log() { cat "$FAKE_LOG"; }

profile() { # name json
  printf '%s\n' "$2" > "$root/$1.json"
  printf '%s' "$root/$1.json"
}

desk='{
  "schemaVersion": 1, "name": "desk", "workspaces": [],
  "monitors": [
    { "identity": "desc:Samsung Electric Company S27C31x H9DWB00491", "connector": "DP-1",
      "enabled": true, "mode": "1920x1080@60", "position": "0x1080", "scale": 1, "transform": 1,
      "mirror": null, "vrr": 2, "bitdepth": 10, "cm": "srgb", "sdrbrightness": 1.25, "sdrsaturation": 0.5 },
    { "identity": "desc:Dell Inc. DELL SE2726H HG5QZB4",
      "enabled": true, "mode": "1920x1080@144", "position": "1920x0", "scale": 1.5, "mirror": "DP-1" },
    { "identity": "desc:ASUSTek COMPUTER INC ASUS VG27V 0x00023706",
      "enabled": true, "mode": "preferred", "position": "auto", "scale": 1 }
  ]
}'


export FAKE_FIXTURE="$here/fixtures/monitors-three.json"
run state
eq "state: three monitors" "$(jq 'length' <<<"$out")" 3
eq "state: serials give desc: identities" \
  "$(jq -r '[.[].identity | startswith("desc:")] | all' <<<"$out")" true
eq "state: identity is the description" \
  "$(jq -r '.[] | select(.name == "DP-1") | .identity' <<<"$out")" \
  "desc:Samsung Electric Company S27C31x H9DWB00491"
eq "state: no warning when serials exist" "$(jq '[.[] | has("identityWarning")] | any' <<<"$out")" false

export FAKE_FIXTURE="$here/fixtures/monitors-twins.json"
run state
eq "state twins: connector identities" \
  "$(jq -r '[.[] | select(.serial == "") | .identity] | sort | join(",")' <<<"$out")" "DP-2,HDMI-A-1"
eq "state twins: warning on both twins" \
  "$(jq -r '[.[] | select(.serial == "") | .identityWarning] | unique | join("|")' <<<"$out")" \
  "duplicate make and model without serial; matched by connector"
eq "state twins: third keeps desc:" \
  "$(jq -r '.[] | select(.name == "DP-1") | .identity' <<<"$out")" \
  "desc:Samsung Electric Company S27C31x H9DWB00491"
eq "state twins: third has no warning" \
  "$(jq '.[] | select(.name == "DP-1") | has("identityWarning")' <<<"$out")" false


export FAKE_FIXTURE="$here/fixtures/monitors-three.json"
reset
run apply "$(profile desk "$desk")"
eq "apply: exit 0" "$rc" 0
eq "apply: summary line" "${out%% (pid*}" "applied 3 monitors; countdown 15s"
eq "apply: eval lines in fixed field order" "$(log)" 'eval hl.monitor({ output = "desc:Samsung Electric Company S27C31x H9DWB00491", mode = "1920x1080@60", position = "0x1080", scale = 1, transform = 1, vrr = 2, bitdepth = 10, cm = "srgb", sdrbrightness = 1.25, sdrsaturation = 0.5 })
eval hl.monitor({ output = "desc:Dell Inc. DELL SE2726H HG5QZB4", mode = "1920x1080@144", position = "1920x0", scale = 1.5, mirror = "DP-1" })
eval hl.monitor({ output = "desc:ASUSTek COMPUTER INC ASUS VG27V 0x00023706", mode = "preferred", position = "auto", scale = 1 })'
eq "apply: lock exists" "$([[ -d $lock ]] && echo yes || echo no)" yes

run apply "$root/desk.json"
eq "apply during countdown: exit 2" "$rc" 2
eq "apply during countdown: names the lock" "${out%%;*}" "a countdown is already running (pid $(<"$lock/pid"))"
eq "apply during countdown: issues no eval" "$(log | wc -l)" 3

run confirm
eq "confirm: exit 0" "$rc" 0
eq "confirm: lock gone" "$([[ -e $lock ]] && echo yes || echo no)" no
eq "confirm: no reload logged" "$(log | grep -c '^reload' || true)" 0

run confirm
eq "confirm with no countdown: exit 1" "$rc" 1
eq "confirm with no countdown: message" "$out" "nothing to confirm"


reset
run apply "$root/desk.json" --timeout 1
eq "apply --timeout 1: summary" "${out%% (pid*}" "applied 3 monitors; countdown 1s"
sleep 2
eq "timeout: exactly one reload" "$(log | grep -c '^reload$' || true)" 1
eq "timeout: lock gone" "$([[ -e $lock ]] && echo yes || echo no)" no

reset
run revert
eq "revert with no countdown: exit 0" "$rc" 0
eq "revert with no countdown: one reload" "$(log)" reload

reset
run apply "$root/desk.json" --timeout 2
: > "$FAKE_LOG"
run revert
eq "revert during countdown: exit 0" "$rc" 0
eq "revert during countdown: lock gone" "$([[ -e $lock ]] && echo yes || echo no)" no
sleep 2.6
eq "revert during countdown: countdown does not reload again" "$(log)" reload

reset
mkdir -p "$lock"
(true) & dead=$!
wait "$dead"
echo "$dead" > "$lock/pid"
run apply "$root/desk.json"
eq "stale lock (dead pid): apply proceeds" "$rc" 0
run revert


refuse() { # name file
  reset
  run apply "$2"
  eq "$1: exit 3" "$rc" 3
  eq "$1: hyprctl never called" "$(log | wc -c)" 0
  eq "$1: no lock taken" "$([[ -e $lock ]] && echo yes || echo no)" no
}

mon='"enabled": true, "mode": "1920x1080@60", "position": "0x0", "scale": 1'
refuse "quote in identity" "$(profile quote "{\"schemaVersion\":1,\"name\":\"x\",\"monitors\":[{\"identity\":\"desc:Evil\\\" }) os.exit() --\",$mon}]}")"
refuse "trailing newline in identity" "$(profile newline "{\"schemaVersion\":1,\"name\":\"x\",\"monitors\":[{\"identity\":\"desc:Evil\\n\",$mon}]}")"
refuse "schemaVersion 2" "$(profile v2 "$(jq '.schemaVersion = 2' <<<"$desk")")"
refuse "scale as a string" "$(profile strscale "$(jq '.monitors[0].scale = "1; os.exit()"' <<<"$desk")")"
refuse "bad character in cm" "$(profile badcm "$(jq '.monitors[0].cm = "srgb)"' <<<"$desk")")"
refuse "missing required position" "$(profile nopos "$(jq 'del(.monitors[0].position)' <<<"$desk")")"
refuse "empty monitors" "$(profile empty "$(jq '.monitors = []' <<<"$desk")")"
refuse "not JSON" "$(profile junk 'not json')"


reset
run apply "$(profile off "$(jq '.monitors[1].enabled = false' <<<"$desk")")"
eq "disabled monitor: eval carries disabled and no mode" \
  "$(log | sed -n 2p)" 'eval hl.monitor({ output = "desc:Dell Inc. DELL SE2726H HG5QZB4", disabled = true })'
run revert

printf '\n%d passed, %d failed\n' "$passes" "$fails"
exit $((fails > 0))
