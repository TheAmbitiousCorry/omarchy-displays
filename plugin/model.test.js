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
