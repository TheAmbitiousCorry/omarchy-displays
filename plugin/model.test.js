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
