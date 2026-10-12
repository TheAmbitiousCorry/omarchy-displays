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
  exit 0
fi
printf '%s\n' "$*" >> "$FAKE_LOG"
# Real eval answers only "ok", or "error: ..." with exit 7; doctor relies on that.
if [[ $1 == eval && $2 == 'assert(OMARCHY_DISPLAYS_LOADED ~= nil)' && -z ${FAKE_LOADED:-} ]]; then
  echo "error: [string \"return assert(...\"]:1: assertion failed!"
  exit 7
fi
if [[ $1 == eval && $2 == 'assert(OMARCHY_DISPLAYS_LOADED =='* && $2 != *"\"${FAKE_LOADED:-none}\""* ]]; then
  echo "error: [string \"return assert(...\"]:1: assertion failed!"
  exit 7
fi
if [[ $* == reload && -n ${FAKE_RELOAD_FAIL:-} ]]; then
  exit 1
fi
echo ok
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

reset
run apply "$(profile offmin '{"schemaVersion":1,"name":"x","monitors":[{"identity":"desc:Dell Inc. DELL SE2726H HG5QZB4","enabled":false}]}')"
eq "disabled monitor with only identity: accepted" "$rc" 0
eq "disabled monitor with only identity: eval carries disabled" \
  "$(log)" 'eval hl.monitor({ output = "desc:Dell Inc. DELL SE2726H HG5QZB4", disabled = true })'
run revert
refuse "disabled monitor with a bad mode" "$(profile offbad "$(jq '.monitors[1].enabled = false | .monitors[1].mode = "x;y"' <<<"$desk")")"
refuse "enabled monitor missing scale" "$(profile noscale "$(jq 'del(.monitors[0].scale)' <<<"$desk")")"
refuse "enabled monitor missing mode" "$(profile nomode "$(jq 'del(.monitors[0].mode)' <<<"$desk")")"

reset
run status
eq "status with no lock: exit 0" "$rc" 0
eq "status with no lock: null countdown" "$(jq -c . <<<"$out")" '{"countdown":null}'

run apply "$root/desk.json" --timeout 5
run status
rem=$(jq '.countdown.remaining' <<<"$out")
eq "status during countdown: remaining within 3..5" "$((rem >= 3 && rem <= 5))" 1
eq "status during countdown: pid is the lock's pid" "$(jq '.countdown.pid' <<<"$out")" "$(<"$lock/pid")"
eq "status during countdown: deadline matches lock file" "$(jq '.countdown.deadline' <<<"$out")" "$(<"$lock/deadline")"
run confirm
run status
eq "status after confirm: null countdown" "$(jq -c . <<<"$out")" '{"countdown":null}'


export OMARCHY_DISPLAYS_HYPR_DIR="$root/hypr"
hypr="$OMARCHY_DISPLAYS_HYPR_DIR"
last="$XDG_RUNTIME_DIR/omarchy-displays/last-applied.json"
rule_lines() { grep '^hl.monitor' "$1" || true; }
unset FAKE_LOADED FAKE_RELOAD_FAIL

run version
eq "version: prints 0.1.0" "$out" 0.1.0

reset
rm -rf "$hypr" "$last"
run apply "$root/desk.json"
eq "apply: copies the profile to last-applied.json" "$(cmp -s "$root/desk.json" "$last" && echo same || echo differ)" same
eval_rules=$(log | sed 's/^eval //')
run confirm
eq "apply: last-applied.json survives confirm" "$([[ -f $last ]] && echo yes || echo no)" yes

reset
run persist "$root/desk.json"
eq "persist explicit profile: exit 0" "$rc" 0
eq "persist: header line" "$(sed -n 1p "$hypr/displays.lua")" \
  "-- Generated by omarchy-displays 0.1.0. Do not edit: the next persist overwrites it."
eq "persist: profile line" "$(sed -n 2p "$hypr/displays.lua")" "-- Profile: desk"
eq "persist: loaded marker line" "$(sed -n 3p "$hypr/displays.lua")" 'OMARCHY_DISPLAYS_LOADED = "0.1.0"'
eq "persist: rule lines equal the eval lines apply issued" "$(rule_lines "$hypr/displays.lua")" "$eval_rules"
eq "persist: exactly one reload and nothing else" "$(log)" reload
eq "persist: first write makes no backup" "$(ls "$hypr" | grep -c '\.bak\.' || true)" 0
eq "persist: no temp file left behind" "$(ls "$hypr" | grep -c '\.tmp\.' || true)" 0

rm -f "$last"
reset
run persist
eq "persist with no argument and no apply: exit 3" "$rc" 3
eq "persist with no argument and no apply: hyprctl never called" "$(log | wc -c)" 0

run apply "$(profile other "$(jq '.name = "other"' <<<"$desk")")"
run confirm
reset
run persist
eq "persist with no argument after apply: exit 0" "$rc" 0
eq "persist with no argument after apply: uses the applied profile" "$(sed -n 2p "$hypr/displays.lua")" "-- Profile: other"

# Backups: 11 persists after the first write give 10 candidates, the 12th must prune.
rm -rf "$hypr"
reset
for i in $(seq 1 11); do
  run persist "$(profile "p$i" "$(jq --arg n "p$i" '.name = $n' <<<"$desk")")"
done
bak_count() { ls "$hypr" | grep -c '^displays\.lua\.bak\.' || true; }
eq "backups: 11 persists leave 10 (nothing pruned yet)" "$(bak_count)" 10
run persist "$(profile p12 "$(jq '.name = "p12"' <<<"$desk")")"
eq "backups: 12 persists leave exactly 10" "$(bak_count)" 10
newest=$(ls "$hypr" | grep '^displays\.lua\.bak\.' | sort -t. -k4 -n | tail -n 1)
oldest=$(ls "$hypr" | grep '^displays\.lua\.bak\.' | sort -t. -k4 -n | head -n 1)
eq "backups: newest holds the previous write" "$(sed -n 2p "$hypr/$newest")" "-- Profile: p11"
eq "backups: oldest kept is the 2nd write, the 1st was pruned" "$(sed -n 2p "$hypr/$oldest")" "-- Profile: p2"

# A refused profile must leave the live file, its backups and hyprctl alone.
before=$(cksum < "$hypr/displays.lua")
baks=$(bak_count)
reset
run persist "$(profile badcm2 "$(jq '.monitors[0].cm = "srgb)"' <<<"$desk")")"
eq "persist bad string: exit 3" "$rc" 3
eq "persist bad string: displays.lua untouched" "$(cksum < "$hypr/displays.lua")" "$before"
eq "persist bad string: no backup added" "$(bak_count)" "$baks"
eq "persist bad string: no temp file" "$(ls "$hypr" | grep -c '\.tmp\.' || true)" 0
eq "persist bad string: hyprctl never called" "$(log | wc -c)" 0
run persist "$(profile badname "$(jq '.name = "x\nos.exit()"' <<<"$desk")")"
eq "persist newline in name: exit 3" "$rc" 3
eq "persist newline in name: displays.lua untouched" "$(cksum < "$hypr/displays.lua")" "$before"

FAKE_RELOAD_FAIL=1 run persist "$root/desk.json"
eq "persist with failing reload: exit 1" "$rc" 1
eq "persist with failing reload: file is still written" "$(sed -n 2p "$hypr/displays.lua")" "-- Profile: desk"

rm -rf "$hypr"
run persist --empty
eq "persist --empty: exit 0" "$rc" 0
eq "persist --empty: loaded marker, no rules" \
  "$(sed -n 3p "$hypr/displays.lua"; rule_lines "$hypr/displays.lua" | wc -l)" $'OMARCHY_DISPLAYS_LOADED = "0.1.0"\n0'

# doctor
rm -rf "$hypr"; mkdir -p "$hypr"
printf 'require("hypr.monitors")\nrequire("default.hypr.toggles")\n' > "$hypr/hyprland.lua"
FAKE_LOADED=0.1.0 run doctor
eq "doctor without the loader line: exit 1" "$rc" 1
eq "doctor without the loader line: names the line" "${out%% is not in*}" 'missing: pcall(require, "hypr.displays")'

printf 'require("hypr.monitors")\npcall(require, "hypr.displays")\nrequire("default.hypr.toggles")\n' > "$hypr/hyprland.lua"
FAKE_LOADED=0.1.0 run doctor
eq "doctor with the line and a matching marker: exit 0" "$rc" 0
eq "doctor with the line and a matching marker: message" "$out" 'ok: pcall(require, "hypr.displays") is live'
FAKE_LOADED=0.0.9 run doctor
eq "doctor with a stale marker in the running config: exit 0" "$rc" 0
eq "doctor with a stale marker: notes the version" "${out%%;*}" 'note: displays.lua was generated by another version'
FAKE_LOADED= run doctor
eq "doctor with no marker in the running config: exit 1" "$rc" 1
eq "doctor changes nothing" "$(ls "$hypr")" hyprland.lua

printf '\n%d passed, %d failed\n' "$passes" "$fails"
exit $((fails > 0))
