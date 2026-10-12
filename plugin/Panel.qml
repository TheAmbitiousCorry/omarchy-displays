import QtQuick
import QtQuick.Layouts
import Quickshell
import Quickshell.Io
import Quickshell.Wayland
import qs.Commons
import qs.Ui
import "Model.js" as Model

// Monitor layout panel. Every change to the system goes through the
// omarchy-displays CLI; this file only reads `state` and `status` and calls
// apply, confirm, persist and revert.
Item {
  id: root

  property string omarchyPath: Quickshell.env("OMARCHY_PATH")
  property var shell: null
  property var manifest: null

  property string cliPath: "omarchy-displays"
  readonly property int countdownSeconds: 15

  property bool opened: false
  property var monitors: []
  property int selectedIndex: 0
  property string error: ""
  property bool busy: false
  property bool counting: false
  property int remaining: 0
  property string lastAction: ""
  property int dragIndex: -1
  property bool advancedOpen: false

  readonly property int snapPixels: 16
  readonly property int nudgeStep: 10

  readonly property var selected: monitors.length > 0 ? monitors[Math.min(selectedIndex, monitors.length - 1)] : null
  readonly property var rects: monitors.map(Model.logicalRect)
  readonly property var box: Model.bounds(rects)
  readonly property real fit: Model.fitScale(rects, canvas.width, canvas.height, Style.space(24))
  readonly property var gapIndexes: Model.gaps(rects)
  readonly property string gapText: {
    if (gapIndexes.length === 0) return ""
    var names = gapIndexes.map(function(i) { return Model.shortName(monitors[i]) })
    return "Gap: " + names.join(", ") + (names.length === 1 ? " is" : " are") + " not touching another monitor"
  }

  readonly property bool overlapping: Model.hasOverlap(rects)
  readonly property string layoutWarning: overlapping ? "Overlap: monitors must not overlap" : gapText

  readonly property var uncleanMonitors: monitors.filter(function(m) {
    return !m.disabled && !Model.scaleIsClean(m.width, m.height, m.scale)
  })
  readonly property bool anyEnabled: monitors.some(function(m) { return !m.disabled })
  readonly property bool selectedEditable: selected !== null && !selected.disabled
  readonly property bool selectedMirrors: selected !== null && !selected.disabled && monitors.some(function(m) {
    return !m.disabled && m.identity === selected.mirror
  })
  readonly property var scaleWarning: {
    var m = selected && uncleanMonitors.indexOf(selected) >= 0 ? selected : (uncleanMonitors[0] || null)
    if (m === null) return ""
    var s = Math.round(m.scale * 1000) / 1000
    return s + " does not divide " + m.width + "x" + m.height + " cleanly (Hyprland would warn)"
  }
  readonly property var logical: selected ? Model.logicalSize(selected.width, selected.height, selected.scale, selected.transform) : ({ width: 0, height: 0 })

  function open(payloadJson) {
    refreshState()
    refreshStatus()
    opened = true
    Qt.callLater(function() { keyCatcher.forceActiveFocus() })
  }

  function close() {
    opened = false
    error = ""
  }

  function dismiss() {
    if (root.shell && typeof root.shell.hide === "function")
      root.shell.hide((root.manifest && root.manifest.id) || "kr34t1v.displays")
    else close()
  }

  function refreshState() {
    if (stateProc.running) return
    stateProc.command = [cliPath, "state"]
    stateProc.running = true
  }

  function refreshStatus() {
    if (statusProc.running) return
    statusProc.command = [cliPath, "status"]
    statusProc.running = true
  }

  function updateMonitor(index, patch) {
    var next = monitors.slice()
    next[index] = Object.assign({}, next[index], patch)
    monitors = next
  }

  function setPosition(index, axis, value) {
    var patch = {}
    patch[axis] = value
    updateMonitor(index, patch)
  }

  function commitSdr(key, text, min, max) {
    var v = Model.parseRanged(text, min, max)
    if (v === null) return
    var patch = {}
    patch[key] = v
    updateMonitor(selectedIndex, patch)
  }

  function commitScale(text) {
    var v = parseFloat(text)
    if (!(v > 0 && v <= 10)) return
    updateMonitor(selectedIndex, { scale: v })
  }

  // Moves a monitor by (dx, dy) layout pixels from `base` rects, snapped and pushed out of overlaps.
  function moveMonitor(index, base, dx, dy, threshold) {
    if (index < 0 || index >= monitors.length) return
    var p = Model.applyDrag(index, base, dx, dy, threshold)
    var next = monitors.slice()
    next[index] = Object.assign({}, next[index], { x: p.x, y: p.y })
    monitors = next
  }

  // A snap radius at or above the step would pull every nudge back to the edge it left.
  function nudge(dx, dy, step) {
    moveMonitor(selectedIndex, rects, dx, dy, step > 1 ? Math.floor(step / 2) - 1 : 0)
  }

  function run(action, command) {
    if (runner.running) return
    lastAction = action
    error = ""
    busy = true
    runner.command = command
    runner.running = true
  }

  function apply() {
    var profile = JSON.stringify(Model.toProfile(monitors, "panel"))
    // The profile is passed as $1 so no monitor string is ever parsed by the shell.
    run("apply", ["bash", "-c",
      'f=$(mktemp --suffix=.json); printf "%s" "$1" > "$f"; "$2" apply "$f" --timeout "$3"; rc=$?; rm -f "$f"; exit $rc',
      "displays-apply", profile, cliPath, String(countdownSeconds)])
  }

  function keep() {
    counting = false
    // Exit 100 means confirm itself failed; any other non-zero is persist's.
    run("keep", ["bash", "-c", '"$1" confirm || exit 100; "$1" persist', "displays-keep", cliPath])
  }

  function revert() {
    counting = false
    run("revert", [cliPath, "revert"])
  }

  function identify() {
    identifier.show(monitors.map(function(m) { return m.name }))
  }

  Identify { id: identifier }

  Process {
    id: stateProc
    stdout: StdioCollector {
      waitForEnd: true
      onStreamFinished: {
        try {
          root.monitors = JSON.parse(text)
          root.selectedIndex = Math.min(root.selectedIndex, Math.max(0, root.monitors.length - 1))
        } catch (e) {
          root.error = "Could not read monitor state"
        }
      }
    }
    onExited: function(code) {
      if (code !== 0) root.error = "omarchy-displays state failed (exit " + code + ")"
    }
  }

  // The CLI owns the countdown clock; the dialog only mirrors what `status` reports.
  Process {
    id: statusProc
    stdout: StdioCollector {
      waitForEnd: true
      onStreamFinished: {
        var countdown
        try {
          countdown = JSON.parse(text).countdown
        } catch (e) {
          return
        }
        var wasCounting = root.counting
        root.counting = countdown !== null && countdown !== undefined
        if (root.counting) root.remaining = countdown.remaining
        else if (wasCounting) root.refreshState()
      }
    }
  }

  Process {
    id: runner
    stderr: StdioCollector {
      waitForEnd: true
      onStreamFinished: {
        var line = String(text || "").trim().split("\n")[0]
        if (line !== "" && root.error !== "") root.error = root.error + ": " + line
      }
    }
    onExited: function(code) {
      root.busy = false
      if (root.lastAction === "apply") {
        if (code === 0) {
          root.refreshStatus()
        } else {
          root.error = code === 2 ? "A countdown is already running" : "Apply failed (exit " + code + ")"
        }
      } else if (code === 100 && root.lastAction === "keep") {
        root.error = "Nothing to keep"
      } else if (code !== 0 && root.lastAction === "keep") {
        root.error = "Kept but not saved (exit " + code + ")"
      } else if (code !== 0) {
        root.error = "Revert failed (exit " + code + ")"
      }
      root.refreshState()
    }
  }

  Timer {
    interval: 1000
    repeat: true
    running: root.counting
    onTriggered: root.refreshStatus()
  }

  PanelWindow {
    visible: root.opened
    anchors { top: true; bottom: true; left: true; right: true }
    color: "transparent"
    exclusionMode: ExclusionMode.Ignore
    WlrLayershell.namespace: "omarchy-displays"
    WlrLayershell.layer: WlrLayer.Overlay
    WlrLayershell.keyboardFocus: WlrKeyboardFocus.Exclusive

    Rectangle {
      anchors.fill: parent
      color: Color.menu.scrim
      MouseArea { anchors.fill: parent; onClicked: root.dismiss() }
    }

    Item {
      id: keyCatcher
      anchors.fill: parent
      focus: true

      Keys.priority: Keys.BeforeItem
      Keys.onPressed: function(event) {
        if (dialog.handleKey(event)) { event.accepted = true; return }
        if (event.key === Qt.Key_Escape) { root.dismiss(); event.accepted = true; return }
        var step = (event.modifiers & Qt.ShiftModifier) ? 1 : root.nudgeStep
        var arrows = {}
        arrows[Qt.Key_Left] = [-step, 0]
        arrows[Qt.Key_Right] = [step, 0]
        arrows[Qt.Key_Up] = [0, -step]
        arrows[Qt.Key_Down] = [0, step]
        var d = arrows[event.key]
        if (d !== undefined && root.selected !== null && !root.counting && keyCatcher.activeFocus) {
          root.nudge(d[0], d[1], step)
          event.accepted = true
        }
      }

      BorderSurface {
        id: card
        anchors.centerIn: parent
        width: Math.min(Style.space(900), parent.width - Style.space(32))
        height: Math.min(Style.space(620), parent.height - Style.space(32))
        color: Color.popups.background
        borderSpec: Border.surfaceSpec("popups", "border", Color.popups.border, Math.max(1, Style.space(2)))
        radius: Style.cornerRadius
        padding: Style.spacing.panelPadding

        MouseArea { anchors.fill: parent }

        ColumnLayout {
          anchors.fill: parent
          anchors.topMargin: card.contentTopInset
          anchors.rightMargin: card.contentRightInset
          anchors.bottomMargin: card.contentBottomInset
          anchors.leftMargin: card.contentLeftInset
          spacing: Style.spacing.panelGap

          RowLayout {
            Layout.fillWidth: true
            Text {
              textFormat: Text.PlainText
              text: "Displays"
              color: Color.popups.text
              font.family: Style.font.family
              font.pixelSize: Style.font.heading
              font.bold: true
              Layout.fillWidth: true
            }
            Text {
              textFormat: Text.PlainText
              visible: root.error !== ""
              text: root.error
              color: Color.urgent
              font.family: Style.font.family
              font.pixelSize: Style.font.bodySmall
              elide: Text.ElideRight
              Layout.maximumWidth: Style.space(560)
            }
          }

          BorderSurface {
            id: canvas
            Layout.fillWidth: true
            Layout.fillHeight: true
            color: Style.normalFill
            borderSpec: Border.flat(Style.normalBorderColor, Style.normalBorderWidth)
            radius: Style.cornerRadius
            clip: true

            Repeater {
              // An integer model keeps delegates alive while a drag rewrites `monitors`.
              model: root.monitors.length

              BorderSurface {
                required property int index
                readonly property var rect: root.rects[index] || ({ x: 0, y: 0, width: 0, height: 0 })
                readonly property var monitor: root.monitors[index] || ({ model: "", name: "" })
                readonly property bool isSelected: index === root.selectedIndex
                readonly property bool dragging: index === root.dragIndex

                x: (canvas.width - root.box.width * root.fit) / 2 + (rect.x - root.box.x) * root.fit
                y: (canvas.height - root.box.height * root.fit) / 2 + (rect.y - root.box.y) * root.fit
                width: rect.width * root.fit
                height: rect.height * root.fit
                color: isSelected ? Style.selectedAccentFill : Style.normalFill
                borderSpec: isSelected || dragging
                  ? Border.flat(Color.accent, Math.max(2, Style.normalBorderWidth * 2))
                  : Border.flat(Style.normalBorderColor, Style.normalBorderWidth)
                radius: Style.cornerRadius
                opacity: monitor.disabled ? 0.4 : 1

                Column {
                  anchors.centerIn: parent
                  width: parent.width - Style.space(8)
                  spacing: Style.spacing.xxs

                  Text {
                    textFormat: Text.PlainText
                    width: parent.width
                    horizontalAlignment: Text.AlignHCenter
                    elide: Text.ElideRight
                    text: (index + 1) + "  " + Model.shortName(monitor)
                    color: Color.popups.text
                    font.family: Style.font.family
                    font.pixelSize: Style.font.body
                    font.bold: true
                  }
                  Text {
                    textFormat: Text.PlainText
                    width: parent.width
                    horizontalAlignment: Text.AlignHCenter
                    elide: Text.ElideRight
                    text: monitor.name
                    color: Qt.darker(Color.popups.text, 1.4)
                    font.family: Style.font.family
                    font.pixelSize: Style.font.bodySmall
                  }
                }

                MouseArea {
                  id: grab
                  anchors.fill: parent
                  cursorShape: pressed ? Qt.ClosedHandCursor : Qt.OpenHandCursor

                  // Pointer position and layout are frozen at press so the moving
                  // bounding box cannot feed back into the delta.
                  property point pressPoint: Qt.point(0, 0)
                  property real pressFit: 1
                  property var pressRects: []

                  onPressed: function(mouse) {
                    root.selectedIndex = index
                    root.dragIndex = index
                    pressPoint = mapToItem(canvas, mouse.x, mouse.y)
                    pressFit = root.fit
                    pressRects = root.rects
                  }
                  onPositionChanged: function(mouse) {
                    if (!pressed) return
                    var p = mapToItem(canvas, mouse.x, mouse.y)
                    root.moveMonitor(index, pressRects,
                      (p.x - pressPoint.x) / pressFit, (p.y - pressPoint.y) / pressFit,
                      Math.round(root.snapPixels / pressFit))
                  }
                  onReleased: root.dragIndex = -1
                  onCanceled: root.dragIndex = -1
                }
              }
            }
          }

          Text {
            textFormat: Text.PlainText
            Layout.fillWidth: true
            Layout.preferredHeight: gapMetrics.height
            text: root.layoutWarning
            color: Color.urgent
            font.family: Style.font.family
            font.pixelSize: Style.font.bodySmall
            elide: Text.ElideRight
            TextMetrics { id: gapMetrics; font.family: Style.font.family; font.pixelSize: Style.font.bodySmall; text: "Gap" }
          }

          RowLayout {
            Layout.fillWidth: true
            spacing: Style.spacing.panelGap
            enabled: root.selected !== null

            PanelSectionHeader {
              text: root.selected ? (root.selected.model + "  " + root.selected.name).toUpperCase() : ""
              foreground: Color.popups.text
              Layout.fillWidth: true
            }
            NumberField {
              id: xField
              label: "X"
              enabled: !root.selectedMirrors
              opacity: enabled ? 1 : 0.5
              foreground: Color.popups.text
              from: 0
              to: 32000
              onModified: function(v) { root.setPosition(root.selectedIndex, "x", v) }
              Binding { target: xField.field; property: "value"; value: root.selected ? root.selected.x : 0 }
            }
            NumberField {
              id: yField
              label: "Y"
              enabled: !root.selectedMirrors
              opacity: enabled ? 1 : 0.5
              foreground: Color.popups.text
              from: 0
              to: 32000
              onModified: function(v) { root.setPosition(root.selectedIndex, "y", v) }
              Binding { target: yField.field; property: "value"; value: root.selected ? root.selected.y : 0 }
            }
          }

          RowLayout {
            Layout.fillWidth: true
            spacing: Style.spacing.panelGap
            enabled: root.selected !== null

            Toggle {
              label: "Enabled"
              foreground: Color.popups.text
              checked: root.selected ? !root.selected.disabled : false
              Layout.preferredWidth: Style.space(190)
              Layout.alignment: Qt.AlignBottom
              onClicked: root.updateMonitor(root.selectedIndex, { disabled: !!root.selected && !root.selected.disabled })
            }
            Dropdown {
              id: modeDropdown
              label: "Mode"
              Layout.fillWidth: true
              enabled: root.selectedEditable
              opacity: enabled ? 1 : 0.5
              options: root.selected ? Model.modeOptions(root.selected.availableModes) : []
              Binding { target: modeDropdown; property: "value"; value: root.selected ? (root.selected.modeValue || Model.currentModeValue(root.selected)) : "" }
              onChanged: function(v) { root.updateMonitor(root.selectedIndex, Model.modePatch(v)) }
            }
            Dropdown {
              id: transformDropdown
              label: "Rotation"
              Layout.preferredWidth: Style.space(170)
              enabled: root.selectedEditable
              opacity: enabled ? 1 : 0.5
              options: Model.transformOptions()
              Binding { target: transformDropdown; property: "value"; value: root.selected ? String(root.selected.transform || 0) : "0" }
              onChanged: function(v) { root.updateMonitor(root.selectedIndex, { transform: Number(v) }) }
            }
          }

          RowLayout {
            Layout.fillWidth: true
            spacing: Style.spacing.panelGap
            enabled: root.selectedEditable
            opacity: enabled ? 1 : 0.5

            Text {
              textFormat: Text.PlainText
              text: "Scale"
              color: Qt.darker(Color.popups.text, 1.4)
              font.family: Style.font.family
              font.pixelSize: Style.font.bodySmall
              font.bold: true
            }
            ButtonGroup {
              id: scalePresets
              foreground: Color.popups.text
              background: "transparent"
              fontSize: Style.font.bodySmall
              options: root.selected ? Model.scalePresets(root.selected.width, root.selected.height).map(function(s) { return String(s) }) : []
              value: root.selected ? String(Math.round(root.selected.scale * 100) / 100) : ""
              onChanged: function(v) { root.updateMonitor(root.selectedIndex, { scale: Number(v) }) }
            }
            TextField {
              id: scaleField
              foreground: Color.popups.text
              Layout.preferredWidth: Style.space(84)
              horizontalAlignment: Text.AlignHCenter
              inputMethodHints: Qt.ImhFormattedNumbersOnly
              onEditingFinished: root.commitScale(text)
              Binding {
                target: scaleField
                property: "text"
                value: root.selected ? String(Math.round(root.selected.scale * 1000) / 1000) : ""
                when: !scaleField.activeFocus
                restoreMode: Binding.RestoreNone
              }
            }
            Text {
              textFormat: Text.PlainText
              text: "Logical: " + root.logical.width + " x " + root.logical.height
              color: Color.popups.text
              font.family: Style.font.family
              font.pixelSize: Style.font.body
              Layout.fillWidth: true
            }
          }

          Text {
            textFormat: Text.PlainText
            Layout.fillWidth: true
            Layout.preferredHeight: gapMetrics.height
            text: root.scaleWarning
            color: Color.urgent
            font.family: Style.font.family
            font.pixelSize: Style.font.bodySmall
            elide: Text.ElideRight
          }

          RowLayout {
            visible: root.advancedOpen
            Layout.fillWidth: true
            spacing: Style.spacing.panelGap
            enabled: root.selectedEditable
            opacity: enabled ? 1 : 0.5

            Dropdown {
              id: mirrorDropdown
              label: "Mirror"
              Layout.fillWidth: true
              options: root.selected ? Model.mirrorOptions(root.monitors, root.selectedIndex) : []
              Binding { target: mirrorDropdown; property: "value"; value: root.selected && root.selected.mirror ? root.selected.mirror : "null" }
              onChanged: function(v) { root.updateMonitor(root.selectedIndex, Model.mirrorPatch(v)) }
            }
            Dropdown {
              id: vrrDropdown
              label: "VRR"
              Layout.fillWidth: true
              options: Model.vrrOptions()
              Binding {
                target: vrrDropdown
                property: "value"
                value: !root.selected ? "0" : String(root.selected.vrrMode !== undefined ? root.selected.vrrMode : (root.selected.vrr ? 1 : 0))
              }
              onChanged: function(v) { root.updateMonitor(root.selectedIndex, { vrrMode: Number(v) }) }
            }
            Dropdown {
              id: bitdepthDropdown
              label: "Bit depth"
              Layout.fillWidth: true
              options: Model.bitdepthOptions()
              Binding { target: bitdepthDropdown; property: "value"; value: root.selected ? String(root.selected.bitdepth || 8) : "8" }
              onChanged: function(v) { root.updateMonitor(root.selectedIndex, { bitdepth: Number(v) }) }
            }
            Dropdown {
              id: cmDropdown
              label: "Colour"
              Layout.fillWidth: true
              options: Model.cmOptions()
              Binding { target: cmDropdown; property: "value"; value: root.selected ? (root.selected.cm || root.selected.colorManagementPreset || "srgb") : "srgb" }
              onChanged: function(v) { root.updateMonitor(root.selectedIndex, { cm: v }) }
            }
          }

          RowLayout {
            visible: root.advancedOpen
            Layout.fillWidth: true
            spacing: Style.spacing.panelGap
            enabled: root.selectedEditable
            opacity: enabled ? 1 : 0.5

            Text {
              textFormat: Text.PlainText
              text: "SDR brightness"
              color: Qt.darker(Color.popups.text, 1.4)
              font.family: Style.font.family
              font.pixelSize: Style.font.bodySmall
              font.bold: true
            }
            TextField {
              id: brightnessField
              foreground: Color.popups.text
              Layout.preferredWidth: Style.space(84)
              horizontalAlignment: Text.AlignHCenter
              inputMethodHints: Qt.ImhFormattedNumbersOnly
              onEditingFinished: {
                root.commitSdr("sdrBrightness", text, 1, 2)
                text = root.selected ? String(Math.round(root.selected.sdrBrightness * 1000) / 1000) : ""
              }
              Binding {
                target: brightnessField
                property: "text"
                value: root.selected ? String(Math.round(root.selected.sdrBrightness * 1000) / 1000) : ""
                when: !brightnessField.activeFocus
                restoreMode: Binding.RestoreNone
              }
            }
            Text {
              textFormat: Text.PlainText
              text: "SDR saturation"
              color: Qt.darker(Color.popups.text, 1.4)
              font.family: Style.font.family
              font.pixelSize: Style.font.bodySmall
              font.bold: true
            }
            TextField {
              id: saturationField
              foreground: Color.popups.text
              Layout.preferredWidth: Style.space(84)
              horizontalAlignment: Text.AlignHCenter
              inputMethodHints: Qt.ImhFormattedNumbersOnly
              onEditingFinished: {
                root.commitSdr("sdrSaturation", text, 0, 2)
                text = root.selected ? String(Math.round(root.selected.sdrSaturation * 1000) / 1000) : ""
              }
              Binding {
                target: saturationField
                property: "text"
                value: root.selected ? String(Math.round(root.selected.sdrSaturation * 1000) / 1000) : ""
                when: !saturationField.activeFocus
                restoreMode: Binding.RestoreNone
              }
            }
            Text {
              textFormat: Text.PlainText
              visible: !!root.selected && root.selected.bitdepth === 10
              text: "10 bit: some apps cannot screen-capture, and border colours stay 8 bit"
              color: Color.urgent
              font.family: Style.font.family
              font.pixelSize: Style.font.bodySmall
              elide: Text.ElideRight
              Layout.fillWidth: true
            }
            Item { Layout.fillWidth: true; visible: !(!!root.selected && root.selected.bitdepth === 10) }
          }

          RowLayout {
            Layout.fillWidth: true
            spacing: Style.spacing.controlGap

            Button {
              text: "Advanced"
              bordered: true
              focusable: true
              selected: root.advancedOpen
              foreground: Color.popups.text
              onClicked: root.advancedOpen = !root.advancedOpen
            }
            Item { Layout.fillWidth: true }
            Button {
              text: "Identify"
              bordered: true
              focusable: true
              foreground: Color.popups.text
              onClicked: root.identify()
            }
            Button {
              text: "Revert"
              bordered: true
              focusable: true
              foreground: Color.popups.text
              onClicked: root.revert()
            }
            Button {
              text: "Apply"
              bordered: true
              focusable: true
              selected: true
              enabled: !root.busy && !root.counting && root.anyEnabled && root.uncleanMonitors.length === 0 && !root.overlapping
              opacity: enabled ? 1 : 0.5
              foreground: Color.popups.text
              onClicked: root.apply()
            }
          }
        }
      }

      ConfirmDialog {
        id: dialog
        anchors.fill: parent
        opened: root.counting
        message: "Keep these display settings? Reverting in " + root.remaining + " seconds."
        cancelText: "Revert"
        confirmText: "Keep"
        onCanceled: root.revert()
        onConfirmed: root.keep()
      }
    }
  }
}
