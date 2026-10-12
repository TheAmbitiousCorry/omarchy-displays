const test = require("node:test")
const assert = require("node:assert")
const fs = require("node:fs")
const vm = require("node:vm")

const sandbox = {}
vm.runInNewContext(fs.readFileSync(__dirname + "/Model.js", "utf8").replace(".pragma library", ""), sandbox)
const Model = sandbox

const mon = (over) => Object.assign({
  name: "DP-1", identity: "desc:Acme X1 S1", model: "X1", width: 1920, height: 1080,
  refreshRate: 74.973, x: 0, y: 1080, scale: 1, transform: 0, disabled: false,
}, over)

test("rotated monitor swaps dimensions", () => {
  for (const t of [1, 3, 5, 7]) {
    const r = Model.logicalRect(mon({ transform: t }))
    assert.deepStrictEqual([r.width, r.height], [1080, 1920])
  }
  const flat = Model.logicalRect(mon({ transform: 2 }))
  assert.deepStrictEqual([flat.width, flat.height], [1920, 1080])
})

test("scale 2 halves the logical size", () => {
  const r = Model.logicalRect(mon({ scale: 2 }))
  assert.deepStrictEqual([r.width, r.height], [960, 540])
})

test("fitScale never exceeds 1 and fits both axes", () => {
  const small = [{ x: 0, y: 0, width: 100, height: 100 }]
  assert.strictEqual(Model.fitScale(small, 2000, 2000, 10), 1)
  const rects = [
    { x: 0, y: 1080, width: 1920, height: 1080 },
    { x: 1920, y: 0, width: 1920, height: 1080 },
  ]
  const s = Model.fitScale(rects, 800, 400, 20)
  const b = Model.bounds(rects)
  assert.ok(s < 1)
  assert.ok(b.width * s <= 800 - 40 + 1e-9)
  assert.ok(b.height * s <= 400 - 40 + 1e-9)
  assert.ok(Math.abs(b.width * s - 760) < 1e-9 || Math.abs(b.height * s - 360) < 1e-9)
})

test("toProfile rounds refreshRate and preserves identity", () => {
  const p = Model.toProfile([mon({ x: 1930 })], "panel")
  assert.strictEqual(p.schemaVersion, 1)
  assert.strictEqual(p.name, "panel")
  const m = p.monitors[0]
  assert.strictEqual(m.identity, "desc:Acme X1 S1")
  assert.strictEqual(m.connector, "DP-1")
  assert.strictEqual(m.mode, "1920x1080@75")
  assert.strictEqual(m.position, "1930x1080")
  assert.strictEqual(m.enabled, true)
})

test("toProfile writes a disabled monitor as identity, connector and enabled only", () => {
  const m = Model.toProfile([mon({ disabled: true })], "p").monitors[0]
  assert.strictEqual(JSON.stringify(m), JSON.stringify({ identity: "desc:Acme X1 S1", connector: "DP-1", enabled: false }))
})

test("shortName is the model only", () => {
  assert.strictEqual(Model.shortName({ model: "S27C31x", name: "DP-1" }), "S27C31x")
  assert.strictEqual(Model.shortName({ model: "", name: "DP-1" }), "DP-1")
})

const R = (x, y, width = 100, height = 100) => ({ x, y, width, height })

test("snap pulls the left edge onto a neighbour's right edge within threshold", () => {
    assert.deepStrictEqual({ ...Model.snap(R(108, 0), [R(0, 0)], 10) }, { x: 100, y: 0 })
})

test("snap leaves a position alone one pixel outside the threshold and snaps at exactly the threshold", () => {
  assert.deepStrictEqual({ ...Model.snap(R(111, 500), [R(0, 0)], 10) }, { x: 111, y: 500 })
  assert.deepStrictEqual({ ...Model.snap(R(110, 500), [R(0, 0)], 10) }, { x: 100, y: 500 })
})

test("snap with no other rects returns the position", () => {
  assert.deepStrictEqual({ ...Model.snap(R(7, 9), [], 10) }, { x: 7, y: 9 })
})

test("corner match beats a closer single-axis match on another rect", () => {
  const corner = R(100, 100)
  const nearX = R(204, 1000)
  assert.deepStrictEqual({ ...Model.snap(R(203, 205), [corner, nearX], 10) }, { x: 200, y: 200 })
  assert.deepStrictEqual({ ...Model.snap(R(203, 205), [nearX], 10) }, { x: 204, y: 205 })
})

test("axes snap independently when no corner is in range", () => {
  assert.deepStrictEqual({ ...Model.snap(R(103, 500), [R(0, 0), R(300, 480)], 10) }, { x: 100, y: 500 })
})

test("overlaps is strict: a shared edge is not an overlap", () => {
  assert.strictEqual(Model.overlaps(R(0, 0), R(100, 0)), false)
  assert.strictEqual(Model.overlaps(R(0, 0), R(99, 0)), true)
})

test("resolveOverlap pushes a 4-pixel overlap out to edge contact", () => {
  assert.deepStrictEqual({ ...Model.resolveOverlap(R(96, 0), [R(0, 0)]) }, { x: 100, y: 0 })
  assert.deepStrictEqual({ ...Model.resolveOverlap(R(0, 96), [R(0, 0)]) }, { x: 0, y: 100 })
})

test("resolveOverlap leaves a non-overlapping rect and clamps negatives to 0", () => {
  assert.deepStrictEqual({ ...Model.resolveOverlap(R(100, 0), [R(0, 0)]) }, { x: 100, y: 0 })
  assert.deepStrictEqual({ ...Model.resolveOverlap(R(-5, -7), []) }, { x: 0, y: 0 })
})

test("resolveOverlap never leaves a rect overlapping when a free side exists at x >= 0", () => {
  const others = [R(0, 0), R(100, 0)]
  const p = Model.resolveOverlap(R(50, 50), others)
  assert.ok(p.x >= 0 && p.y >= 0)
  assert.ok(others.every((o) => !Model.overlaps({ ...R(p.x, p.y) }, o)))
})

test("gaps is empty for no rects and for a single rect", () => {
  assert.deepStrictEqual([...Model.gaps([])], [])
  assert.deepStrictEqual([...Model.gaps([R(0, 0)])], [])
})

test("gaps reports a detached rect and not the touching pair", () => {
  assert.deepStrictEqual([...Model.gaps([R(0, 0), R(100, 0), R(500, 500)])], [2])
})

test("gaps counts edge contact, a corner touch and a one-pixel gap", () => {
  assert.deepStrictEqual([...Model.gaps([R(0, 0), R(100, 100)])], [])
  assert.deepStrictEqual([...Model.gaps([R(0, 0), R(100, 30)])], [])
  assert.deepStrictEqual([...Model.gaps([R(0, 0), R(103, 0)])], [0, 1])
  assert.deepStrictEqual([...Model.gaps([R(0, 0), R(100, 150)])], [0, 1])
})

test("a rotated monitor is placed with swapped dimensions through logicalRect", () => {
  const rects = [mon({ x: 0, y: 0, width: 1920, height: 1080 }), mon({ x: 1930, y: 0, transform: 1 })].map(Model.logicalRect)
  assert.deepStrictEqual([rects[1].width, rects[1].height], [1080, 1920])
  assert.deepStrictEqual({ ...Model.applyDrag(1, rects, -5, 0, 10) }, { x: 1920, y: 0 })
  assert.deepStrictEqual([...Model.gaps(rects)], [0, 1])
  const placed = Model.applyDrag(1, rects, -5, 0, 10)
  assert.deepStrictEqual([...Model.gaps([rects[0], { ...rects[1], x: placed.x }])], [])
})

test("applyDrag never returns negative coordinates", () => {
  const rects = [R(0, 0), R(100, 0)]
  const p = Model.applyDrag(1, rects, -900, -900, 16)
  assert.ok(p.x >= 0 && p.y >= 0)
  assert.ok(!Model.overlaps(R(p.x, p.y), rects[0]))
})

test("applyDrag onto an occupied spot lands adjacent, not overlapping", () => {
  const rects = [R(0, 0), R(300, 0), R(0, 300)]
  const p = Model.applyDrag(1, rects, -280, 0, 0)
  assert.ok(!Model.overlaps(R(p.x, p.y), rects[0]))
  assert.deepStrictEqual({ ...p }, { x: 100, y: 0 })
})

test("applyDrag rounds to integers after snapping", () => {
  const rects = [R(0, 0), R(300.4, 0)]
  assert.deepStrictEqual({ ...Model.applyDrag(1, rects, -195.4, 0.2, 10) }, { x: 100, y: 0 })
  assert.deepStrictEqual({ ...Model.applyDrag(1, rects, -195.6, 0.2, 0) }, { x: 105, y: 0 })
  assert.deepStrictEqual({ ...Model.applyDrag(1, rects, -190.4, 0.2, 4) }, { x: 110, y: 0 })
})

test("snap picks the nearest corner when two are in range", () => {
  const far = R(110, 100)
  const near = R(-100, 100)
  assert.deepStrictEqual({ ...Model.snap(R(2, 205), [far, near], 20) }, { x: 0, y: 200 })
})

const MODES = ["1920x1080@60.00Hz", "1920x1080@164.92Hz", "1920x1080@60.00Hz", "1920x1080@59.94Hz", "1280x720@60.00Hz", "2560x1440@74.97Hz", "garbage"]

test("modeOptions puts the three specials first with their labels", () => {
  const o = Model.modeOptions(MODES).map((x) => ({ ...x }))
  assert.deepStrictEqual([...o.slice(0, 3)], [
    { label: "Preferred", value: "preferred" },
    { label: "Highest resolution", value: "highres" },
    { label: "Highest refresh rate", value: "highrr" },
  ])
})

test("modeOptions dedupes repeated and rounding-equal modes into one value", () => {
  const values = Model.modeOptions(MODES).map((x) => x.value)
  assert.strictEqual(values.filter((v) => v === "1920x1080@60").length, 1)
})

test("modeOptions sorts width, height, then refresh descending and formats labels", () => {
  const real = Model.modeOptions(MODES).slice(3).map((x) => ({ ...x }))
  assert.deepStrictEqual([...real], [
    { label: "2560 x 1440  75 Hz", value: "2560x1440@75" },
    { label: "1920 x 1080  165 Hz", value: "1920x1080@165" },
    { label: "1920 x 1080  60 Hz", value: "1920x1080@60" },
    { label: "1280 x 720  60 Hz", value: "1280x720@60" },
  ])
})

test("modeOptions with no modes still offers the specials", () => {
  assert.strictEqual(Model.modeOptions([]).length, 3)
  assert.strictEqual(Model.modeOptions(undefined).length, 3)
})

test("currentModeValue rounds the refresh rate", () => {
  assert.strictEqual(Model.currentModeValue(mon({})), "1920x1080@75")
})

test("modePatch for a real mode sets size and rate, for a special only the choice", () => {
  assert.deepStrictEqual({ ...Model.modePatch("1280x720@60") }, { modeValue: "1280x720@60", width: 1280, height: 720, refreshRate: 60 })
  assert.deepStrictEqual({ ...Model.modePatch("highrr") }, { modeValue: "highrr" })
})

test("scaleIsClean follows Hyprland's divisor rule on 1920x1080", () => {
  for (const s of [1, 1.25, 1.5, 1.6, 2]) assert.strictEqual(Model.scaleIsClean(1920, 1080, s), true, String(s))
  assert.strictEqual(Model.scaleIsClean(1920, 1080, 1.4), false)
})

test("scaleIsClean rejects zero and negative scales, and checks height as well as width", () => {
  assert.strictEqual(Model.scaleIsClean(1920, 1080, 0), false)
  assert.strictEqual(Model.scaleIsClean(1920, 1080, -1), false)
  assert.strictEqual(Model.scaleIsClean(1920, 1081, 1.5), false)
  assert.strictEqual(Model.scaleIsClean(1921, 1080, 1.5), false)
})

test("cleanScales on 1920x1080 includes the stock presets and stays within 1 to 3", () => {
  const c = Model.cleanScales(1920, 1080)
  for (const s of [1, 1.25, 1.6, 2, 3]) assert.ok(c.includes(s), String(s))
  assert.ok(!c.includes(1.4))
  assert.ok(Math.min(...c) >= 1 && Math.max(...c) <= 3)
})

test("scalePresets never exceeds six buttons and keeps 1 and the largest clean scale up to 2", () => {
  const p = Model.scalePresets(1920, 1080)
  assert.deepStrictEqual([...p], [1, 1.2, 1.25, 1.5, 1.6, 2])
  const wide = Model.scalePresets(3840, 2160)
  assert.strictEqual(wide.length, 6)
  assert.strictEqual(wide[0], 1)
  assert.strictEqual(wide[5], 2)
})

test("logicalSize applies the transform swap then divides by scale", () => {
  assert.deepStrictEqual({ ...Model.logicalSize(1920, 1080, 2, 1) }, { width: 540, height: 960 })
  assert.deepStrictEqual({ ...Model.logicalSize(1920, 1080, 1.5, 0) }, { width: 1280, height: 720 })
  assert.deepStrictEqual({ ...Model.logicalSize(1920, 1080, 1.6, 2) }, { width: 1200, height: 675 })
})

test("logicalSize rounds a fractional result", () => {
  assert.deepStrictEqual({ ...Model.logicalSize(1920, 1080, 1.4, 0) }, { width: 1371, height: 771 })
})

test("transformOptions lists the eight Hyprland values in order", () => {
  const o = Model.transformOptions()
  assert.deepStrictEqual([...o.map((x) => x.value)], [0, 1, 2, 3, 4, 5, 6, 7])
  assert.deepStrictEqual([...o.map((x) => x.label)], ["Normal", "90°", "180°", "270°", "Flipped", "Flipped 90°", "Flipped 180°", "Flipped 270°"])
})

test("toProfile uses an edited modeValue over the size and refresh fields", () => {
  const m = Model.toProfile([mon({ modeValue: "highrr" })], "p").monitors[0]
  assert.strictEqual(m.mode, "highrr")
})

test("toProfile emits scale as a number and keeps the transform", () => {
  const m = Model.toProfile([mon({ scale: "1.5", transform: 3 })], "p").monitors[0]
  assert.strictEqual(m.scale, 1.5)
  assert.strictEqual(typeof m.scale, "number")
  assert.strictEqual(m.transform, 3)
})

test("toProfile trims float noise from a reported scale", () => {
  assert.strictEqual(Model.toProfile([mon({ scale: 1.2000000476837158 })], "p").monitors[0].scale, 1.2)
})

test("vrrOptions lists the four Hyprland modes in order", () => {
  const o = Model.vrrOptions()
  assert.deepStrictEqual([...o.map((x) => x.value)], [0, 1, 2, 3])
  assert.deepStrictEqual([...o.map((x) => x.label)], ["Off", "On", "Fullscreen only", "Fullscreen with video or game"])
})

test("bitdepthOptions offers exactly 8 and 10", () => {
  assert.deepStrictEqual([...Model.bitdepthOptions().map((x) => x.value)], [8, 10])
})

test("cmOptions lists the nine presets and marks both hdr presets experimental", () => {
  const o = Model.cmOptions()
  assert.deepStrictEqual([...o.map((x) => x.value)], ["auto", "srgb", "dcip3", "dp3", "adobe", "wide", "edid", "hdr", "hdredid"])
  const experimental = o.filter((x) => x.label.includes("(experimental)")).map((x) => x.value)
  assert.deepStrictEqual([...experimental], ["hdr", "hdredid"])
})

const trio = () => [
  mon({ name: "DP-1", identity: "desc:A one", model: "One" }),
  mon({ name: "DP-2", identity: "desc:B two", model: "Two" }),
  mon({ name: "DP-3", identity: "desc:C three", model: "" }),
]

test("mirrorOptions starts with None, then every other monitor as shortName (connector)", () => {
  const o = Model.mirrorOptions(trio(), 0)
  assert.deepStrictEqual(Array.from(o, (x) => [x.label, x.value]), [
    ["None", null], ["Two (DP-2)", "desc:B two"], ["DP-3 (DP-3)", "desc:C three"],
  ])
})

test("mirrorOptions leaves out the monitor itself and disabled monitors", () => {
  const m = trio()
  m[2].disabled = true
  const values = Model.mirrorOptions(m, 0).map((x) => x.value)
  assert.ok(!values.includes("desc:A one"))
  assert.ok(!values.includes("desc:C three"))
  assert.ok(values.includes("desc:B two"))
})

test("mirrorOptions leaves out a monitor that already mirrors this one", () => {
  const m = trio()
  m[1].mirror = "desc:A one"
  assert.ok(!Model.mirrorOptions(m, 0).map((x) => x.value).includes("desc:B two"))
})

test("mirrorPatch maps the None option back to null and keeps an identity", () => {
  assert.deepStrictEqual({ ...Model.mirrorPatch("null") }, { mirror: null })
  assert.deepStrictEqual({ ...Model.mirrorPatch("desc:B two") }, { mirror: "desc:B two" })
})

test("toProfile omits every advanced field a plain state monitor does not carry", () => {
  const m = Model.toProfile([mon({})], "p").monitors[0]
  for (const k of ["mirror", "vrr", "bitdepth", "cm", "sdrbrightness", "sdrsaturation"]) assert.ok(!(k in m), k)
})

test("toProfile maps state's colour fields to cm, sdrbrightness and sdrsaturation", () => {
  const m = Model.toProfile([mon({ colorManagementPreset: "srgb", sdrBrightness: 1.2, sdrSaturation: 0.98 })], "p").monitors[0]
  assert.strictEqual(m.cm, "srgb")
  assert.strictEqual(m.sdrbrightness, 1.2)
  assert.strictEqual(m.sdrsaturation, 0.98)
})

test("toProfile trims float noise from reported sdr values", () => {
  const m = Model.toProfile([mon({ sdrBrightness: 1.2000000476837158 })], "p").monitors[0]
  assert.strictEqual(m.sdrbrightness, 1.2)
})

test("toProfile maps the reported vrr boolean to 0 or 1", () => {
  assert.strictEqual(Model.toProfile([mon({ vrr: false })], "p").monitors[0].vrr, 0)
  assert.strictEqual(Model.toProfile([mon({ vrr: true })], "p").monitors[0].vrr, 1)
})

test("toProfile lets a user-set vrrMode win over the reported boolean, including 0", () => {
  assert.strictEqual(Model.toProfile([mon({ vrr: false, vrrMode: 2 })], "p").monitors[0].vrr, 2)
  assert.strictEqual(Model.toProfile([mon({ vrr: true, vrrMode: 0 })], "p").monitors[0].vrr, 0)
})

test("toProfile emits bitdepth only once it is set", () => {
  assert.strictEqual(Model.toProfile([mon({ bitdepth: 10 })], "p").monitors[0].bitdepth, 10)
})

test("toProfile lets an edited cm replace the reported preset", () => {
  const m = Model.toProfile([mon({ colorManagementPreset: "srgb", cm: "wide" })], "p").monitors[0]
  assert.strictEqual(m.cm, "wide")
})

test("toProfile emits mirror when the target is another enabled monitor", () => {
  const m = trio()
  m[0].mirror = "desc:B two"
  assert.strictEqual(Model.toProfile(m, "p").monitors[0].mirror, "desc:B two")
})

test("toProfile drops a mirror whose target is disabled or gone, and for a null mirror", () => {
  const m = trio()
  m[0].mirror = "desc:B two"
  m[1].disabled = true
  assert.ok(!("mirror" in Model.toProfile(m, "p").monitors[0]))
  m[0].mirror = "desc:not plugged in"
  assert.ok(!("mirror" in Model.toProfile(m, "p").monitors[0]))
  m[0].mirror = null
  assert.ok(!("mirror" in Model.toProfile(m, "p").monitors[0]))
})

test("toProfile writes only enabled:false for a disabled monitor, whatever advanced fields it carries", () => {
  const m = Model.toProfile([mon({ disabled: true, vrr: true, cm: "wide", bitdepth: 10 })], "p").monitors[0]
  assert.deepStrictEqual(Object.keys(m).sort(), ["connector", "enabled", "identity"])
})

test("parseRanged accepts the bounds, rejects just outside them and non-numbers", () => {
  assert.strictEqual(Model.parseRanged("1", 1, 2), 1)
  assert.strictEqual(Model.parseRanged("2", 1, 2), 2)
  assert.strictEqual(Model.parseRanged("0.99", 1, 2), null)
  assert.strictEqual(Model.parseRanged("2.01", 1, 2), null)
  assert.strictEqual(Model.parseRanged("abc", 1, 2), null)
  assert.strictEqual(Model.parseRanged("", 0, 2), null)
  assert.strictEqual(Model.parseRanged("0", 0, 2), 0)
})

test("hasOverlap is false for two rects that only touch, true once they overlap by one pixel", () => {
  const a = { x: 0, y: 0, width: 100, height: 100 }
  assert.strictEqual(Model.hasOverlap([a, { x: 100, y: 0, width: 100, height: 100 }]), false)
  assert.strictEqual(Model.hasOverlap([a, { x: 0, y: 100, width: 100, height: 100 }]), false)
  assert.strictEqual(Model.hasOverlap([a, { x: 99, y: 0, width: 100, height: 100 }]), true)
})

test("hasOverlap finds an overlap between non-adjacent rects and handles zero or one rect", () => {
  const far = { x: 500, y: 500, width: 10, height: 10 }
  const rects = [{ x: 0, y: 0, width: 100, height: 100 }, far, { x: 50, y: 50, width: 100, height: 100 }]
  assert.strictEqual(Model.hasOverlap(rects), true)
  assert.strictEqual(Model.hasOverlap([far]), false)
  assert.strictEqual(Model.hasOverlap([]), false)
})

const live = () => [
  mon({ name: "DP-1", identity: "desc:A", x: 0, y: 1080, vrr: false, bitdepth: undefined }),
  mon({ name: "DP-2", identity: "desc:B", x: 1920, y: 0, refreshRate: 143.98599 }),
]
const entry = (over) => Object.assign({
  identity: "desc:A", enabled: true, mode: "1920x1080@60", position: "100x200", scale: 1.5, transform: 1,
  mirror: null, vrr: 2, bitdepth: 10, cm: "dcip3", sdrbrightness: 1.25, sdrsaturation: 0.5,
}, over)
const prof = (...monitors) => ({ schemaVersion: 1, name: "desk", monitors })

test("validateName accepts the boundaries: 1 and 40 characters, inner space, underscore and hyphen", () => {
  for (const n of ["a", "A1", "a b", "a_b-c", "x".repeat(40), "a_", "a-"]) assert.strictEqual(Model.validateName(n), "", n)
})

test("validateName refuses 41 characters, empty, path characters, a leading dot, space or hyphen, and a trailing space", () => {
  for (const n of ["", "x".repeat(41), "..", "../x", "a/b", ".a", " a", "-a", "_a", "a ", "a\n", "é"])
    assert.notStrictEqual(Model.validateName(n), "", JSON.stringify(n))
})

test("validateName refuses a name that already exists and accepts it once the list lacks it", () => {
  assert.match(Model.validateName("desk", ["desk", "work"]), /already exists/)
  assert.strictEqual(Model.validateName("desk", ["work"]), "")
})

test("mergeProfile: the profile's fields win over live state", () => {
  const { monitors, extra } = Model.mergeProfile(prof(entry()), live())
  const a = monitors[0]
  assert.deepStrictEqual([a.x, a.y, a.scale, a.transform], [100, 200, 1.5, 1])
  assert.deepStrictEqual([a.modeValue, a.width, a.height, a.refreshRate], ["1920x1080@60", 1920, 1080, 60])
  assert.deepStrictEqual([a.vrrMode, a.bitdepth, a.cm, a.sdrBrightness, a.sdrSaturation], [2, 10, "dcip3", 1.25, 0.5])
  assert.strictEqual(a.disabled, false)
  assert.deepStrictEqual(extra, [])
})

test("mergeProfile: a connected monitor the profile lacks keeps live state exactly", () => {
  const l = live()
  const { monitors } = Model.mergeProfile(prof(entry()), l)
  assert.deepStrictEqual(monitors[1], l[1])
})

test("mergeProfile: profile-only monitors are carried in extra, not drawn", () => {
  const ghost = entry({ identity: "desc:Ghost", position: "3840x0" })
  const { monitors, extra } = Model.mergeProfile(prof(entry(), ghost), live())
  assert.strictEqual(monitors.length, 2)
  assert.deepStrictEqual(extra, [ghost])
})

test("mergeProfile: a disabled entry disables the monitor and leaves its other fields live", () => {
  const l = live()
  const { monitors } = Model.mergeProfile(prof({ identity: "desc:A", enabled: false }), l)
  assert.strictEqual(monitors[0].disabled, true)
  assert.strictEqual(monitors[0].x, l[0].x)
})

test("mergeProfile: a special mode is kept as the choice and the live size stays", () => {
  const { monitors } = Model.mergeProfile(prof(entry({ mode: "preferred" })), live())
  assert.deepStrictEqual([monitors[0].modeValue, monitors[0].width, monitors[0].refreshRate], ["preferred", 1920, 74.973])
})

test("mergeProfile: position auto and an entry without optional fields leave those live", () => {
  const { monitors } = Model.mergeProfile(prof({ identity: "desc:A", enabled: true, mode: "preferred", position: "auto", scale: 2 }), live())
  assert.deepStrictEqual([monitors[0].x, monitors[0].y, monitors[0].scale, monitors[0].transform], [0, 1080, 2, 0])
  assert.strictEqual(monitors[0].bitdepth, undefined)
})

test("mergeProfile then toProfile round-trips the vrr, bitdepth, cm and sdr fields the live readback loses", () => {
  const { monitors, extra } = Model.mergeProfile(prof(entry()), live())
  const back = Model.toProfile(monitors, "desk", extra).monitors[0]
  assert.deepStrictEqual([back.vrr, back.bitdepth, back.cm, back.sdrbrightness, back.sdrsaturation], [2, 10, "dcip3", 1.25, 0.5])
})

test("toProfile appends extra entries verbatim after the connected ones", () => {
  const ghost = entry({ identity: "desc:Ghost" })
  const p = Model.toProfile(live(), "desk", [ghost])
  assert.deepStrictEqual(p.monitors.map((m) => m.identity), ["desc:A", "desc:B", "desc:Ghost"])
  assert.strictEqual(p.monitors[2], ghost)
})

test("isDirty is false right after a merge, and when only a disconnected profile monitor differs", () => {
  const p = prof(entry(), entry({ identity: "desc:Ghost" }))
  const { monitors } = Model.mergeProfile(p, [live()[0]])
  assert.strictEqual(Model.isDirty(monitors, p), false)
})

test("isDirty: any one edited field flips it", () => {
  const p = prof(entry())
  const base = Model.mergeProfile(p, [live()[0]]).monitors
  const edits = { x: 101, y: 201, scale: 1.25, transform: 2, vrrMode: 1, bitdepth: 8, cm: "srgb", sdrBrightness: 1.5, sdrSaturation: 1, modeValue: "1920x1080@75", disabled: true }
  for (const k of Object.keys(edits)) {
    assert.strictEqual(Model.isDirty([Object.assign({}, base[0], { [k]: edits[k] })], p), true, k)
  }
})

test("isDirty: a connected monitor the profile lacks is dirty", () => {
  const p = prof(entry())
  assert.strictEqual(Model.isDirty(Model.mergeProfile(p, live()).monitors, p), true)
})

test("isDirty: a field the profile does not carry is unspecified, but transform and mirror default to 0 and none", () => {
  const p = prof({ identity: "desc:A", enabled: true, mode: "1920x1080@75", position: "0x1080", scale: 1 })
  const m = mon({ identity: "desc:A", vrr: true, cm: "hdr" })
  assert.strictEqual(Model.isDirty([m], p), false)
  assert.strictEqual(Model.isDirty([mon({ identity: "desc:A", transform: 1 })], p), true)
  assert.strictEqual(Model.isDirty([mon({ identity: "desc:A", mirror: "desc:B" }), mon({ identity: "desc:B", x: 5000 })], p), true)
})

test("isDirty compares scale at the precision toProfile writes", () => {
  const p = prof(entry({ scale: 1.5 }))
  const base = Model.mergeProfile(p, [live()[0]]).monitors[0]
  assert.strictEqual(Model.isDirty([Object.assign({}, base, { scale: 1.5004 })], p), false)
  assert.strictEqual(Model.isDirty([Object.assign({}, base, { scale: 1.501 })], p), true)
})

test("profileOptions lists the names, with (unsaved) first only when asked", () => {
  assert.deepStrictEqual(Model.profileOptions(["a", "b"], false).map((o) => o.value), ["a", "b"])
  const o = Model.profileOptions(["a"], true)
  assert.deepStrictEqual([o[0].label, o[0].value, o[1].value], ["(unsaved)", Model.UNSAVED, "a"])
})

const SAM = "desc:Samsung Electric Company S27C31x H9DWB00491"
const DELL = "desc:Dell Inc. DELL SE2726H HG5QZB4"
const ASUS = "desc:ASUSTek COMPUTER INC ASUS VG27V 0x00023706"
const ws = (workspace, monitor, over) => Object.assign({ workspace, monitor, default: true, persistent: false }, over)
const names = (chips) => Array.from(chips, (c) => c.workspace)

test("workspaceChips: a desc: rule without serial matches the monitor identity that extends it", () => {
  const rules = [ws("1", "desc:ASUSTek COMPUTER INC ASUS VG27V"), ws("6", "desc:Dell Inc. DELL SE2726H")]
  assert.deepStrictEqual(names(Model.workspaceChips(rules, [], ASUS)), ["1"])
  assert.deepStrictEqual(names(Model.workspaceChips(rules, [], DELL)), ["6"])
  assert.deepStrictEqual(names(Model.workspaceChips(rules, [], SAM)), [])
})

test("workspaceChips: a connector rule matches by connector, and a prefix of the wrong monitor does not match", () => {
  assert.deepStrictEqual(names(Model.workspaceChips([ws("4", "DP-1")], [], SAM, "DP-1")), ["4"])
  assert.deepStrictEqual(names(Model.workspaceChips([ws("4", "DP-1")], [], SAM, "DP-2")), [])
  assert.deepStrictEqual(names(Model.workspaceChips([ws("4", "desc:Dell Inc.")], [], ASUS)), [])
})

test("workspaceChips: the profile entry wins over the system rule for the same workspace", () => {
  const rules = [ws("6", DELL), ws("7", DELL)]
  const profile = [ws("6", SAM)]
  assert.deepStrictEqual(names(Model.workspaceChips(rules, profile, DELL)), ["7"])
  assert.deepStrictEqual(names(Model.workspaceChips(rules, profile, SAM)), ["6"])
})

test("workspaceChips: numbers sort numerically before names, and an invalid name is left out", () => {
  const rules = [ws("10", SAM), ws("2", SAM), ws("special:x", SAM), ws("9", SAM), ws("bad name", SAM)]
  assert.deepStrictEqual(names(Model.workspaceChips(rules, [], SAM)), ["2", "9", "10", "special:x"])
})

test("workspaceChips: empty inputs give no chips", () => {
  assert.strictEqual(Model.workspaceChips([], [], SAM).length, 0)
  assert.strictEqual(Model.workspaceChips(undefined, undefined, SAM).length, 0)
})

test("upsertWorkspace replaces the entry with the same name and appends a new one", () => {
  const list = [ws("6", DELL), ws("7", DELL)]
  const replaced = Model.upsertWorkspace(list, ws("6", SAM, { default: false, persistent: true }))
  assert.deepStrictEqual(JSON.parse(JSON.stringify(replaced)), [ws("7", DELL), ws("6", SAM, { default: false, persistent: true })])
  assert.strictEqual(list.length, 2)
  assert.strictEqual(Model.upsertWorkspace(list, ws("8", DELL)).length, 3)
  assert.strictEqual(Model.upsertWorkspace(undefined, ws("8", DELL)).length, 1)
})

test("removeWorkspace drops only the named entry and leaves the input alone", () => {
  const list = [ws("6", DELL), ws("7", DELL)]
  assert.deepStrictEqual(names(Model.removeWorkspace(list, "6")), ["7"])
  assert.deepStrictEqual(names(Model.removeWorkspace(list, "99")), ["6", "7"])
  assert.strictEqual(list.length, 2)
})

test("toProfile passes the canvas workspaces through, as booleans, and defaults to an empty list", () => {
  const p = Model.toProfile([mon({})], "p", [], [{ workspace: "6", monitor: SAM, default: 1 }])
  assert.deepStrictEqual(JSON.parse(JSON.stringify(p.workspaces)), [ws("6", SAM, { persistent: false })])
  assert.deepStrictEqual(JSON.parse(JSON.stringify(Model.toProfile([mon({})], "p").workspaces)), [])
})

test("isDirty: workspaces differ only when the caller passes them and they differ in content", () => {
  const p = Object.assign(prof(entry()), { workspaces: [ws("6", DELL), ws("7", DELL)] })
  const base = Model.mergeProfile(p, [live()[0]]).monitors
  assert.strictEqual(Model.isDirty(base, p), false)
  assert.strictEqual(Model.isDirty(base, p, [ws("7", DELL), ws("6", DELL)]), false)
  assert.strictEqual(Model.isDirty(base, p, [ws("6", DELL)]), true)
  assert.strictEqual(Model.isDirty(base, p, [ws("6", SAM), ws("7", DELL)]), true)
  assert.strictEqual(Model.isDirty(base, p, [ws("6", DELL), ws("7", DELL, { persistent: true })]), true)
  assert.strictEqual(Model.isDirty(base, prof(entry()), []), false)
})
