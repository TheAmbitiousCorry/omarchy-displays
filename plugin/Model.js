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

function toProfile(monitors, name) {
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
      entry.mode = m.width + "x" + m.height + "@" + Math.round(m.refreshRate)
      entry.position = m.x + "x" + m.y
      entry.scale = m.scale
      entry.transform = m.transform || 0
      return entry
    })
  }
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
  var x = Math.max(0, moving.x), y = Math.max(0, moving.y)
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
    var inBounds = options.filter(function (o) { return o.x >= 0 && o.y >= 0 })
    var pool = inBounds.length > 0 ? inBounds : options
    var pick = pool.reduce(function (a, b) { return b.pen < a.pen ? b : a })
    x = Math.max(0, pick.x)
    y = Math.max(0, pick.y)
  }
  return { x: x, y: y }
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
