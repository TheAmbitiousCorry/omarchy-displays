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
