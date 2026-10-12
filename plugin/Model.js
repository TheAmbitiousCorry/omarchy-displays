.pragma library

var SWAPPING_TRANSFORMS = [1, 3, 5, 7]

function logicalRect(monitor) {
  var swap = SWAPPING_TRANSFORMS.indexOf(monitor.transform || 0) >= 0
  var scale = monitor.scale > 0 ? monitor.scale : 1
  var w = swap ? monitor.height : monitor.width
  var h = swap ? monitor.width : monitor.height
  return { x: monitor.x, y: monitor.y, width: w / scale, height: h / scale }
}

function bounds(rects) {
  if (rects.length === 0) return { x: 0, y: 0, width: 0, height: 0 }
  var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  rects.forEach(function (r) {
    minX = Math.min(minX, r.x)
    minY = Math.min(minY, r.y)
    maxX = Math.max(maxX, r.x + r.width)
    maxY = Math.max(maxY, r.y + r.height)
  })
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY }
}

function fitScale(rects, canvasW, canvasH, padding) {
  var b = bounds(rects)
  if (b.width <= 0 || b.height <= 0) return 1
  var availW = Math.max(1, canvasW - 2 * padding)
  var availH = Math.max(1, canvasH - 2 * padding)
  return Math.min(1, availW / b.width, availH / b.height)
}

function round3(n) {
  return Math.round(Number(n) * 1000) / 1000
}

// A user edit lives under its own key; the key state reports is the fallback.
function advancedFields(m, enabledIdentities) {
  var out = {}
  if (typeof m.mirror === "string" && m.mirror !== "" && enabledIdentities.indexOf(m.mirror) >= 0) out.mirror = m.mirror
  if (m.vrrMode !== undefined && m.vrrMode !== null) out.vrr = m.vrrMode
  else if (typeof m.vrr === "boolean") out.vrr = m.vrr ? 1 : 0
  if (m.bitdepth !== undefined && m.bitdepth !== null) out.bitdepth = m.bitdepth
  var cm = m.cm || m.colorManagementPreset
  if (cm) out.cm = cm
  if (m.sdrBrightness !== undefined && m.sdrBrightness !== null) out.sdrbrightness = round3(m.sdrBrightness)
  if (m.sdrSaturation !== undefined && m.sdrSaturation !== null) out.sdrsaturation = round3(m.sdrSaturation)
  return out
}

// `extra` is carried verbatim: stored entries for monitors that are not connected.
// `workspaces` is the canvas's workspace assignment list, passed through.
function toProfile(monitors, name, extra, workspaces) {
  var enabledIdentities = monitors.filter(function (m) { return !m.disabled }).map(function (m) { return m.identity })
  return {
    schemaVersion: 1,
    name: name,
    monitors: monitors.map(function (m) {
      var entry = { identity: m.identity, connector: m.name }
      if (m.disabled) {
        entry.enabled = false
        return entry
      }
      entry.enabled = true
      entry.mode = m.modeValue || currentModeValue(m)
      entry.position = m.x + "x" + m.y
      entry.scale = round3(m.scale)
      entry.transform = m.transform || 0
      var extra = advancedFields(m, enabledIdentities)
      Object.keys(extra).forEach(function (k) { entry[k] = extra[k] })
      return entry
    }).concat(extra || []),
    workspaces: (workspaces || []).map(workspaceEntry)
  }
}

var WORKSPACE_RE = /^[A-Za-z0-9:_-]+$/

function workspaceEntry(e) {
  return { workspace: e.workspace, monitor: e.monitor, default: !!e.default, persistent: !!e.persistent }
}

// Hyprland matches a desc: rule as a prefix of the monitor's description, and
// a connector rule by name.
function monitorMatches(ruleMonitor, identity, connector) {
  if (typeof ruleMonitor !== "string" || ruleMonitor === "") return false
  if (ruleMonitor === identity || ruleMonitor === connector) return true
  return ruleMonitor.indexOf("desc:") === 0 && typeof identity === "string" && identity.indexOf(ruleMonitor) === 0
}

function compareWorkspaces(a, b) {
  var an = /^\d+$/.test(a.workspace), bn = /^\d+$/.test(b.workspace)
  if (an && bn) return Number(a.workspace) - Number(b.workspace)
  if (an !== bn) return an ? -1 : 1
  return a.workspace < b.workspace ? -1 : a.workspace > b.workspace ? 1 : 0
}

// What the system reports plus what the canvas profile assigns; the profile
// wins where both name a workspace. Names the CLI would refuse are left out.
function mergeWorkspaces(workspaces, profileWorkspaces) {
  var byName = {}
  ;(workspaces || []).forEach(function (w) { byName[w.workspace] = w })
  ;(profileWorkspaces || []).forEach(function (w) { byName[w.workspace] = w })
  return Object.keys(byName).map(function (k) { return byName[k] })
    .filter(function (w) { return WORKSPACE_RE.test(w.workspace) })
    .sort(compareWorkspaces)
}

// The workspaces that sit on one monitor, for the chips along its rectangle.
function workspaceChips(workspaces, profileWorkspaces, identity, connector) {
  return mergeWorkspaces(workspaces, profileWorkspaces).filter(function (w) {
    return monitorMatches(w.monitor, identity, connector)
  })
}

// Replaces the entry for the same workspace name, else appends.
function upsertWorkspace(list, entry) {
  var next = (list || []).filter(function (w) { return w.workspace !== entry.workspace })
  next.push(workspaceEntry(entry))
  return next
}

function removeWorkspace(list, name) {
  return (list || []).filter(function (w) { return w.workspace !== name })
}

function workspaceOptions(workspaces, profileWorkspaces) {
  return mergeWorkspaces(workspaces, profileWorkspaces).map(function (w) { return { label: w.workspace, value: w.workspace } })
}

function sameWorkspaces(a, b) {
  function key(list) {
    return JSON.stringify((list || []).map(workspaceEntry).sort(compareWorkspaces))
  }
  return key(a) === key(b)
}

var SPECIAL_MODES = [
  { label: "Preferred", value: "preferred" },
  { label: "Highest resolution", value: "highres" },
  { label: "Highest refresh rate", value: "highrr" },
]

function currentModeValue(monitor) {
  return monitor.width + "x" + monitor.height + "@" + Math.round(monitor.refreshRate)
}

function modeOptions(availableModes) {
  var parsed = []
  ;(availableModes || []).forEach(function (s) {
    var m = /^(\d+)x(\d+)@([\d.]+)Hz$/.exec(s)
    if (m) parsed.push({ width: Number(m[1]), height: Number(m[2]), hz: Number(m[3]) })
  })
  parsed.sort(function (a, b) { return b.width - a.width || b.height - a.height || b.hz - a.hz })
  var seen = {}
  var real = []
  parsed.forEach(function (p) {
    var hz = Math.round(p.hz)
    var value = p.width + "x" + p.height + "@" + hz
    if (seen[value]) return
    seen[value] = true
    real.push({ label: p.width + " x " + p.height + "  " + hz + " Hz", value: value })
  })
  return SPECIAL_MODES.concat(real)
}

// The monitor fields a dropdown value implies; specials only record the choice.
function modePatch(value) {
  var m = /^(\d+)x(\d+)@(\d+)$/.exec(value)
  if (!m) return { modeValue: value }
  return { modeValue: value, width: Number(m[1]), height: Number(m[2]), refreshRate: Number(m[3]) }
}

// Hyprland needs the mode to divide into whole logical pixels in 1/120 steps.
function scaleIsClean(width, height, scale) {
  var k = Math.round(scale * 120)
  if (!(k > 0)) return false
  return (width * 120) % k === 0 && (height * 120) % k === 0
}

function cleanScales(width, height) {
  var out = []
  for (var i = 0; i <= 40; i++) {
    var s = Math.round((1 + i * 0.05) * 100) / 100
    if (scaleIsClean(width, height, s)) out.push(s)
  }
  return out
}

var MAX_SCALE_PRESETS = 6

function scalePresets(width, height) {
  var all = cleanScales(width, height).filter(function (s) { return s <= 2 })
  if (all.length <= MAX_SCALE_PRESETS) return all
  var out = []
  for (var i = 0; i < MAX_SCALE_PRESETS; i++) out.push(all[Math.round(i * (all.length - 1) / (MAX_SCALE_PRESETS - 1))])
  return out
}

function logicalSize(width, height, scale, transform) {
  var r = logicalRect({ x: 0, y: 0, width: width, height: height, scale: scale, transform: transform })
  return { width: Math.round(r.width), height: Math.round(r.height) }
}

var TRANSFORM_LABELS = ["Normal", "90°", "180°", "270°", "Flipped", "Flipped 90°", "Flipped 180°", "Flipped 270°"]

function transformOptions() {
  return TRANSFORM_LABELS.map(function (label, i) { return { label: label, value: i } })
}

function vrrOptions() {
  return [
    { label: "Off", value: 0 },
    { label: "On", value: 1 },
    { label: "Fullscreen only", value: 2 },
    { label: "Fullscreen with video or game", value: 3 },
  ]
}

function bitdepthOptions() {
  return [{ label: "8 bit", value: 8 }, { label: "10 bit", value: 10 }]
}

function cmOptions() {
  return [
    { label: "Auto", value: "auto" },
    { label: "sRGB", value: "srgb" },
    { label: "DCI P3", value: "dcip3" },
    { label: "Apple P3", value: "dp3" },
    { label: "Adobe RGB", value: "adobe" },
    { label: "Wide gamut (BT2020)", value: "wide" },
    { label: "EDID primaries", value: "edid" },
    { label: "HDR (experimental)", value: "hdr" },
    { label: "HDR with EDID primaries (experimental)", value: "hdredid" },
  ]
}

// Dropdown values are strings, so the None option round-trips as "null".
function mirrorOptions(monitors, index) {
  var self = monitors[index]
  var out = [{ label: "None", value: null }]
  monitors.forEach(function (m, i) {
    if (i === index || m.disabled || m.mirror === self.identity) return
    out.push({ label: shortName(m) + " (" + m.name + ")", value: m.identity })
  })
  return out
}

function mirrorPatch(value) {
  return { mirror: value === "null" ? null : value }
}

function parseRanged(text, min, max) {
  if (String(text).trim() === "") return null
  var v = Number(text)
  return v >= min && v <= max ? v : null
}

function shortName(monitor) {
  var model = monitor.model
  return model && model !== "" ? model : monitor.name
}

var TOUCH_EPSILON = 1

function overlaps(a, b) {
  return a.x < b.x + b.width && b.x < a.x + a.width &&
    a.y < b.y + b.height && b.y < a.y + a.height
}

function axisCandidates(start, size, oStart, oSize) {
  var targets = [oStart, oStart + oSize]
  var out = []
  targets.forEach(function (t) {
    out.push(t - start)
    out.push(t - (start + size))
  })
  return out
}

function nearest(deltas, threshold) {
  var best = null
  deltas.forEach(function (d) {
    if (Math.abs(d) <= threshold && (best === null || Math.abs(d) < Math.abs(best))) best = d
  })
  return best
}

function snap(moving, others, threshold) {
  var bestCorner = null
  var xDeltas = [], yDeltas = []
  others.forEach(function (o) {
    var xs = axisCandidates(moving.x, moving.width, o.x, o.width)
    var ys = axisCandidates(moving.y, moving.height, o.y, o.height)
    xDeltas = xDeltas.concat(xs)
    yDeltas = yDeltas.concat(ys)
    xs.forEach(function (dx) {
      ys.forEach(function (dy) {
        if (Math.abs(dx) > threshold || Math.abs(dy) > threshold) return
        var total = Math.abs(dx) + Math.abs(dy)
        if (bestCorner === null || total < bestCorner.total) bestCorner = { dx: dx, dy: dy, total: total }
      })
    })
  })
  if (bestCorner !== null) return { x: moving.x + bestCorner.dx, y: moving.y + bestCorner.dy }
  var dx = nearest(xDeltas, threshold)
  var dy = nearest(yDeltas, threshold)
  return { x: moving.x + (dx === null ? 0 : dx), y: moving.y + (dy === null ? 0 : dy) }
}

function resolveOverlap(moving, others) {
  var x = moving.x, y = moving.y
  for (var pass = 0; pass < 8; pass++) {
    var cur = { x: x, y: y, width: moving.width, height: moving.height }
    var hit = null
    for (var i = 0; i < others.length && hit === null; i++) {
      if (overlaps(cur, others[i])) hit = others[i]
    }
    if (hit === null) break
    var options = [
      { pen: cur.x + cur.width - hit.x, x: hit.x - cur.width, y: y },
      { pen: hit.x + hit.width - cur.x, x: hit.x + hit.width, y: y },
      { pen: cur.y + cur.height - hit.y, x: x, y: hit.y - cur.height },
      { pen: hit.y + hit.height - cur.y, x: x, y: hit.y + hit.height },
    ]
    var pick = options.reduce(function (a, b) { return b.pen < a.pen ? b : a })
    x = pick.x
    y = pick.y
  }
  return { x: x, y: y }
}

function hasOverlap(rects) {
  return rects.some(function (r, i) {
    return rects.some(function (o, j) { return j > i && overlaps(r, o) })
  })
}

function touches(a, b) {
  var e = TOUCH_EPSILON
  var yReach = a.y <= b.y + b.height + e && b.y <= a.y + a.height + e
  var xReach = a.x <= b.x + b.width + e && b.x <= a.x + a.width + e
  var sideBySide = Math.abs(a.x + a.width - b.x) <= e || Math.abs(b.x + b.width - a.x) <= e
  var stacked = Math.abs(a.y + a.height - b.y) <= e || Math.abs(b.y + b.height - a.y) <= e
  return (sideBySide && yReach) || (stacked && xReach)
}

function gaps(rects) {
  if (rects.length < 2) return []
  var out = []
  rects.forEach(function (r, i) {
    var any = rects.some(function (o, j) { return i !== j && touches(r, o) })
    if (!any) out.push(i)
  })
  return out
}

function applyDrag(index, rects, dx, dy, threshold) {
  var r = rects[index]
  var others = rects.filter(function (_, i) { return i !== index })
  var moved = { x: r.x + dx, y: r.y + dy, width: r.width, height: r.height }
  var snapped = snap(moved, others, threshold)
  var placed = resolveOverlap({ x: snapped.x, y: snapped.y, width: r.width, height: r.height }, others)
  return { x: Math.round(placed.x), y: Math.round(placed.y) }
}

// Hyprland positions are absolute, so a layout whose top-left corner is not at
// the origin would pin the leftmost monitor: it could never move further left.
// Dragging therefore works in unbounded space and the whole layout is shifted
// back so its leftmost edge is x 0 and its topmost edge is y 0.
function normalize(positions) {
  if (positions.length === 0) return []
  var minX = Infinity, minY = Infinity
  positions.forEach(function (p) {
    minX = Math.min(minX, p.x)
    minY = Math.min(minY, p.y)
  })
  return positions.map(function (p) { return { x: p.x - minX, y: p.y - minY } })
}

// One position per rect after dragging rects[index] by (dx, dy): the dragged
// rect through applyDrag, the others unmoved, then the layout normalized.
function dragLayout(index, rects, dx, dy, threshold) {
  var moved = applyDrag(index, rects, dx, dy, threshold)
  return normalize(rects.map(function (r, i) {
    return i === index ? moved : { x: r.x, y: r.y }
  }))
}

var NAME_RE = /^[A-Za-z0-9]([A-Za-z0-9 _-]{0,38}[A-Za-z0-9_-])?$/

// The CLI enforces the same rule; this only spares a round trip. Returns an error message, or "".
function validateName(name, existing) {
  if (typeof name !== "string" || !NAME_RE.test(name))
    return "Use 1 to 40 letters, digits, spaces, _ or -, not starting with a space or ending in one"
  if (existing && existing.indexOf(name) >= 0) return "A profile named " + name + " already exists"
  return ""
}

// The profile's fields win over what state reports; connected monitors the
// profile lacks keep live state; profile entries with no connected monitor
// come back in `extra` so a save does not drop them.
function mergeProfile(profile, stateMonitors) {
  var entries = {}
  ;(profile.monitors || []).forEach(function (e) { entries[e.identity] = e })
  var connected = {}
  var monitors = stateMonitors.map(function (m) {
    connected[m.identity] = true
    var e = entries[m.identity]
    if (!e) return m
    if (!e.enabled) return Object.assign({}, m, { disabled: true })
    var patch = { disabled: false }
    if (typeof e.mode === "string") Object.assign(patch, modePatch(e.mode))
    var pos = /^(-?\d+)x(-?\d+)$/.exec(e.position || "")
    if (pos) { patch.x = Number(pos[1]); patch.y = Number(pos[2]) }
    if (typeof e.scale === "number") patch.scale = e.scale
    if (typeof e.transform === "number") patch.transform = e.transform
    if (e.mirror !== undefined) patch.mirror = e.mirror
    if (typeof e.vrr === "number") patch.vrrMode = e.vrr
    if (typeof e.bitdepth === "number") patch.bitdepth = e.bitdepth
    if (typeof e.cm === "string") patch.cm = e.cm
    if (typeof e.sdrbrightness === "number") patch.sdrBrightness = e.sdrbrightness
    if (typeof e.sdrsaturation === "number") patch.sdrSaturation = e.sdrsaturation
    return Object.assign({}, m, patch)
  })
  var extra = (profile.monitors || []).filter(function (e) { return !connected[e.identity] })
  return { monitors: monitors, extra: extra }
}

var COMPARED_FIELDS = ["mode", "position", "scale", "vrr", "bitdepth", "cm", "sdrbrightness", "sdrsaturation"]
var ROUNDED_FIELDS = ["scale", "sdrbrightness", "sdrsaturation"]

// A field the profile does not carry is unspecified, not a difference, except
// transform and mirror, whose absence means 0 and none. Workspaces are
// compared only when the caller passes the canvas list. Profile monitors that
// are not connected cannot differ; a connected monitor the profile lacks does.
function isDirty(canvasMonitors, profile, canvasWorkspaces) {
  if (canvasWorkspaces !== undefined && !sameWorkspaces(canvasWorkspaces, profile.workspaces)) return true
  var entries = {}
  ;(profile.monitors || []).forEach(function (e) { entries[e.identity] = e })
  return toProfile(canvasMonitors, profile.name).monitors.some(function (c) {
    var e = entries[c.identity]
    if (!e) return true
    if (c.enabled !== !!e.enabled) return true
    if (!c.enabled) return false
    if ((c.transform || 0) !== (e.transform || 0)) return true
    if ((c.mirror || null) !== (e.mirror || null)) return true
    return COMPARED_FIELDS.some(function (k) {
      if (e[k] === undefined || e[k] === null) return false
      if (ROUNDED_FIELDS.indexOf(k) >= 0) return round3(c[k]) !== round3(e[k])
      return c[k] !== e[k]
    })
  })
}

var UNSAVED = "(unsaved)"

// The dropdown rows: each profile, plus "(unsaved)" while the canvas has no
// clean profile behind it.
function profileOptions(names, unsaved) {
  var out = names.map(function (n) { return { label: n, value: n } })
  if (unsaved) out.unshift({ label: UNSAVED, value: UNSAVED })
  return out
}
