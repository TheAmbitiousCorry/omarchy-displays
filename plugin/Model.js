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
