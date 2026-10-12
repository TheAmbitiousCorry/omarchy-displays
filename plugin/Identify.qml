import QtQuick
import Quickshell
import Quickshell.Wayland
import qs.Commons
import qs.Ui

Scope {
  id: root

  // Connector names in badge order: badge N goes on the screen named names[N - 1].
  property var names: []
  property bool shown: false

  function show(connectors) {
    names = connectors
    shown = true
    hideTimer.restart()
  }

  Timer { id: hideTimer; interval: 3000; onTriggered: root.shown = false }

  Variants {
    model: Quickshell.screens

    PanelWindow {
      id: win
      required property var modelData
      readonly property int number: root.names.indexOf(modelData.name) + 1

      screen: modelData
      visible: root.shown && number > 0
      anchors { top: true; bottom: true; left: true; right: true }
      color: "transparent"
      exclusionMode: ExclusionMode.Ignore
      mask: Region {}
      WlrLayershell.namespace: "omarchy-displays-identify"
      WlrLayershell.layer: WlrLayer.Overlay
      WlrLayershell.keyboardFocus: WlrKeyboardFocus.None

      BorderSurface {
        anchors.centerIn: parent
        width: Style.space(200)
        height: width
        color: Util.alpha(Color.background, 0.92)
        borderSpec: Border.flat(Color.accent, Math.max(1, Style.space(3)))
        radius: Style.cornerRadius

        Text {
          anchors.centerIn: parent
          textFormat: Text.PlainText
          text: win.number
          color: Color.accent
          font.family: Style.font.family
          font.pixelSize: Style.font.displayLarge * 3
          font.bold: true
        }
      }
    }
  }
}
