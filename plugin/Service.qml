import QtQuick
import Quickshell
import Quickshell.Io

// Applies the saved profile that matches the connected monitors. All logic
// lives in `omarchy-displays hotplug`; this file only decides when to run it.
Item {
  id: root

  property string cliPath: "omarchy-displays"
  property int debounceMs: 2000
  property int retryMs: 2000
  property int maxRetries: 30
  property int reconnectMs: 5000
  property int retries: 0

  readonly property string socketPath: Quickshell.env("XDG_RUNTIME_DIR") + "/hypr/"
    + Quickshell.env("HYPRLAND_INSTANCE_SIGNATURE") + "/.socket2.sock"

  function watched(line) {
    return line.indexOf("monitoraddedv2>>") === 0
      || line.indexOf("monitorremovedv2>>") === 0
      || line.indexOf("configreloaded>>") === 0
  }

  // Omarchy's monitor-watch reloads Hyprland on hotplug. Acting 2 s after the
  // last event keeps this out of that reload's way, and a dock that enumerates
  // its monitors one at a time yields one run instead of one per monitor.
  Timer {
    id: debounce
    interval: root.debounceMs
    onTriggered: { root.retries = 0; hotplug.running = true }
  }

  // Exit 2 means a keep-or-revert countdown is live; try again once it clears.
  Timer {
    id: retry
    interval: root.retryMs
    onTriggered: hotplug.running = true
  }

  Process {
    id: hotplug
    command: [root.cliPath, "hotplug"]
    stdout: SplitParser {
      onRead: function(line) { console.log("omarchy-displays: " + line) }
    }
    onExited: function(exitCode) {
      if (exitCode !== 2) return
      if (root.retries++ < root.maxRetries) retry.start()
      else console.log("omarchy-displays: gave up waiting for the countdown to clear")
    }
  }

  Socket {
    id: events
    path: root.socketPath
    connected: true
    parser: SplitParser {
      onRead: function(line) { if (root.watched(line)) debounce.restart() }
    }
    onConnectedChanged: if (!connected) reconnect.start()
    onError: reconnect.start()
  }

  Timer {
    id: reconnect
    interval: root.reconnectMs
    onTriggered: events.connected = true
  }
}
