import AppKit
import ApplicationServices
import Foundation

struct Bounds: Codable {
    let x: Double
    let y: Double
    let width: Double
    let height: Double
}

struct TargetWindow: Codable {
    let nativeId: UInt32
    let ownerPid: Int32
    let bundleId: String
    let appName: String
    let name: String
    let bounds: Bounds
}

enum WindowError: String, Error {
    case unavailable = "Target window is no longer visible"
    case permission = "Accessibility permission is required for Codex Remote"
    case ambiguous = "Cannot identify the exact accessibility window"
    case focus = "The selected window could not be focused"
    case invalid = "Invalid native window request"
}

func windows() -> [TargetWindow] {
    let entries = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID) as? [[String: Any]] ?? []
    return entries.compactMap { entry in
        guard let id = entry[kCGWindowNumber as String] as? UInt32,
              let pid = entry[kCGWindowOwnerPID as String] as? Int32,
              entry[kCGWindowLayer as String] as? Int == 0,
              let app = NSRunningApplication(processIdentifier: pid),
              let bundle = app.bundleIdentifier,
              app.activationPolicy == .regular,
              let rawBounds = entry[kCGWindowBounds as String] as? [String: Any],
              let rect = CGRect(dictionaryRepresentation: rawBounds as CFDictionary),
              rect.width > 0, rect.height > 0 else { return nil }
        let title = entry[kCGWindowName as String] as? String ?? ""
        return TargetWindow(nativeId: id, ownerPid: pid, bundleId: bundle,
                            appName: app.localizedName ?? bundle,
                            name: title.isEmpty ? (app.localizedName ?? bundle) : title,
                            bounds: Bounds(x: rect.origin.x, y: rect.origin.y, width: rect.width, height: rect.height))
    }
}

func attribute(_ element: AXUIElement, _ name: CFString) -> CFTypeRef? {
    var value: CFTypeRef?
    guard AXUIElementCopyAttributeValue(element, name, &value) == .success else { return nil }
    return value
}

func matches(_ element: AXUIElement, _ target: TargetWindow) -> Bool {
    // AXWindowNumber is not exposed by every app; require a unique exact frame otherwise.
    if let number = attribute(element, "AXWindowNumber" as CFString) as? NSNumber {
        return number.uint32Value == target.nativeId
    }
    guard let positionValue = attribute(element, kAXPositionAttribute as CFString),
          let sizeValue = attribute(element, kAXSizeAttribute as CFString),
          CFGetTypeID(positionValue) == AXValueGetTypeID(),
          CFGetTypeID(sizeValue) == AXValueGetTypeID() else { return false }
    var position = CGPoint.zero
    var size = CGSize.zero
    guard AXValueGetValue(positionValue as! AXValue, .cgPoint, &position),
          AXValueGetValue(sizeValue as! AXValue, .cgSize, &size) else { return false }
    let b = target.bounds
    return abs(position.x - b.x) < 2 && abs(position.y - b.y) < 2 &&
        abs(size.width - b.width) < 2 && abs(size.height - b.height) < 2
}

func focus(_ id: UInt32, _ pid: Int32, _ bundle: String) throws -> TargetWindow {
    guard AXIsProcessTrusted() else { throw WindowError.permission }
    guard let target = windows().first(where: { $0.nativeId == id && $0.ownerPid == pid && $0.bundleId == bundle }),
          let running = NSRunningApplication(processIdentifier: pid) else { throw WindowError.unavailable }
    let application = AXUIElementCreateApplication(pid)
    AXUIElementSetMessagingTimeout(application, 0.5)
    let candidates = (attribute(application, kAXWindowsAttribute as CFString) as? [AXUIElement] ?? []).filter { matches($0, target) }
    guard candidates.count == 1 else { throw WindowError.ambiguous }
    let window = candidates[0]
    _ = running.activate(options: [])
    guard AXUIElementSetAttributeValue(application, kAXFrontmostAttribute as CFString, kCFBooleanTrue) == .success,
          AXUIElementPerformAction(window, kAXRaiseAction as CFString) == .success else { throw WindowError.focus }
    _ = AXUIElementSetAttributeValue(application, kAXFocusedWindowAttribute as CFString, window)
    let deadline = Date().addingTimeInterval(0.35)
    while Date() < deadline {
        if NSWorkspace.shared.frontmostApplication?.processIdentifier == pid,
           let focused = attribute(application, kAXFocusedWindowAttribute as CFString),
           CFGetTypeID(focused) == AXUIElementGetTypeID(),
           matches(focused as! AXUIElement, target),
           let refreshed = windows().first(where: { $0.nativeId == id && $0.ownerPid == pid && $0.bundleId == bundle }) {
            return refreshed
        }
        RunLoop.current.run(until: Date().addingTimeInterval(0.01))
    }
    throw WindowError.focus
}

// One process handles JSON lines so pointer events do not launch a process each time.
while let line = readLine() {
    var requestId: Any = NSNull()
    var response: [String: Any]
    do {
        guard let bytes = line.data(using: .utf8),
              let request = try JSONSerialization.jsonObject(with: bytes) as? [String: Any],
              let command = request["command"] as? String else { throw WindowError.invalid }
        requestId = request["requestId"] ?? NSNull()
        let data: Any
        switch command {
        case "list":
            data = try JSONSerialization.jsonObject(with: JSONEncoder().encode(windows()))
        case "focus":
            guard let id = request["nativeId"] as? UInt32,
                  let pid = request["ownerPid"] as? Int32,
                  let bundle = request["bundleId"] as? String else { throw WindowError.invalid }
            data = try JSONSerialization.jsonObject(with: JSONEncoder().encode(focus(id, pid, bundle)))
        case "permissions":
            data = ["accessibility": AXIsProcessTrusted(), "screen": CGPreflightScreenCaptureAccess()]
        case "reveal":
            guard let bundle = request["bundleId"] as? String,
                  let running = NSRunningApplication.runningApplications(withBundleIdentifier: bundle).first,
                  running.activationPolicy == .regular else { throw WindowError.unavailable }
            if AXIsProcessTrusted() {
                let application = AXUIElementCreateApplication(running.processIdentifier)
                let candidates = attribute(application, kAXWindowsAttribute as CFString) as? [AXUIElement] ?? []
                for candidate in candidates { _ = AXUIElementSetAttributeValue(candidate, kAXMinimizedAttribute as CFString, kCFBooleanFalse) }
            }
            data = ["activated": running.activate(options: [.activateAllWindows])]
        case "diagnostics":
            let entries = CGWindowListCopyWindowInfo([.optionAll, .excludeDesktopElements], kCGNullWindowID) as? [[String: Any]] ?? []
            data = [
                "windowCount": entries.count,
                "applications": NSWorkspace.shared.runningApplications.filter { $0.activationPolicy == .regular }.map { ["pid": $0.processIdentifier, "bundleId": $0.bundleIdentifier ?? ""] as [String: Any] },
                "windows": entries.compactMap { entry -> [String: Any]? in
                    guard let pid = entry[kCGWindowOwnerPID as String] as? Int32,
                          let app = NSRunningApplication(processIdentifier: pid),
                          let bundle = app.bundleIdentifier,
                          app.activationPolicy == .regular else { return nil }
                    return ["pid": pid, "bundleId": bundle, "id": entry[kCGWindowNumber as String] ?? 0, "layer": entry[kCGWindowLayer as String] ?? 0, "onscreen": entry[kCGWindowIsOnscreen as String] ?? false]
                }
            ]
        default:
            throw WindowError.invalid
        }
        response = ["requestId": requestId, "data": data]
    } catch {
        response = ["requestId": requestId, "error": (error as? WindowError)?.rawValue ?? error.localizedDescription]
    }
    if let output = try? JSONSerialization.data(withJSONObject: response, options: [.sortedKeys]),
       let json = String(data: output, encoding: .utf8) {
        print(json)
        fflush(stdout)
    }
}
