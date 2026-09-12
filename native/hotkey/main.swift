// edi-hotkey: one global hold-to-talk chord for Edi.
//
// Electron's globalShortcut reports key presses only; hold-to-talk also needs the
// release. Carbon's RegisterEventHotKey reports both, consumes the chord (so ⌥ Space
// does not type into the focused app), and needs no Input Monitoring or Accessibility
// permission because it never observes any other keystroke.
//
// Usage:   edi-hotkey <virtual key code> <Carbon modifier mask>
//          e.g. edi-hotkey 49 2048   (Space + Option)
// Output:  "ready" | "error <OSStatus>" once, then "down" / "up" lines.
// Lifetime: exits when stdin closes, so it never outlives Edi.

import AppKit
import Carbon.HIToolbox

setvbuf(stdout, nil, _IOLBF, 0)

let arguments = CommandLine.arguments
guard arguments.count == 3, let keyCode = UInt32(arguments[1]), let modifiers = UInt32(arguments[2]) else {
    print("error usage")
    exit(64)
}

func emit(_ line: String) {
    print(line)
    fflush(stdout)
}

var handlerTypes = [
    EventTypeSpec(eventClass: OSType(kEventClassKeyboard), eventKind: UInt32(kEventHotKeyPressed)),
    EventTypeSpec(eventClass: OSType(kEventClassKeyboard), eventKind: UInt32(kEventHotKeyReleased)),
]
let handler: EventHandlerUPP = { _, event, _ in
    emit(GetEventKind(event) == UInt32(kEventHotKeyPressed) ? "down" : "up")
    return noErr
}
InstallEventHandler(GetApplicationEventTarget(), handler, 2, &handlerTypes, nil, nil)

var hotKey: EventHotKeyRef?
let identifier = EventHotKeyID(signature: OSType(0x4544_4948), id: 1)  // "EDIH"
let status = RegisterEventHotKey(keyCode, modifiers, identifier, GetApplicationEventTarget(), 0, &hotKey)
guard status == noErr else {
    emit("error \(status)")
    exit(1)
}
emit("ready")

// The parent owns the lifetime: when it closes our stdin (or dies), exit.
Thread.detachNewThread {
    while readLine() != nil {}
    exit(0)
}

// A background-only app: no Dock icon, no menu bar, never activates.
let app = NSApplication.shared
app.setActivationPolicy(.prohibited)
app.run()
