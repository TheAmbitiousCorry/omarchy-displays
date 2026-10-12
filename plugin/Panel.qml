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
// apply, confirm and revert.
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

  readonly property var selected: monitors.length > 0 ? monitors[Math.min(selectedIndex, monitors.length - 1)] : null
  readonly property var rects: monitors.map(Model.logicalRect)
  readonly property var box: Model.bounds(rects)
  readonly property real fit: Model.fitScale(rects, canvas.width, canvas.height, Style.space(24))

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

  function setPosition(index, axis, value) {
    var next = monitors.slice()
    var patch = {}
    patch[axis] = value
    next[index] = Object.assign({}, next[index], patch)
    monitors = next
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
    run("confirm", [cliPath, "confirm"])
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
      } else if (code !== 0 && root.lastAction === "confirm") {
        root.error = "Nothing to keep"
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
        if (event.key === Qt.Key_Escape) { root.dismiss(); event.accepted = true }
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
              model: root.rects

              BorderSurface {
                required property int index
                required property var modelData
                readonly property var rect: modelData
                readonly property var monitor: root.monitors[index] || ({ model: "", name: "" })
                readonly property bool isSelected: index === root.selectedIndex

                x: (canvas.width - root.box.width * root.fit) / 2 + (rect.x - root.box.x) * root.fit
                y: (canvas.height - root.box.height * root.fit) / 2 + (rect.y - root.box.y) * root.fit
                width: rect.width * root.fit
                height: rect.height * root.fit
                color: isSelected ? Style.selectedAccentFill : Style.normalFill
                borderSpec: isSelected
                  ? Border.flat(Color.accent, Math.max(2, Style.normalBorderWidth * 2))
                  : Border.flat(Style.normalBorderColor, Style.normalBorderWidth)
                radius: Style.cornerRadius

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
                  anchors.fill: parent
                  cursorShape: Qt.PointingHandCursor
                  onClicked: root.selectedIndex = index
                }
              }
            }
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
              foreground: Color.popups.text
              from: 0
              to: 32000
              onModified: function(v) { root.setPosition(root.selectedIndex, "x", v) }
              Binding { target: xField.field; property: "value"; value: root.selected ? root.selected.x : 0 }
            }
            NumberField {
              id: yField
              label: "Y"
              foreground: Color.popups.text
              from: 0
              to: 32000
              onModified: function(v) { root.setPosition(root.selectedIndex, "y", v) }
              Binding { target: yField.field; property: "value"; value: root.selected ? root.selected.y : 0 }
            }
          }

          RowLayout {
            Layout.fillWidth: true
            spacing: Style.spacing.controlGap

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
              enabled: !root.busy && !root.counting && root.monitors.length > 0
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
