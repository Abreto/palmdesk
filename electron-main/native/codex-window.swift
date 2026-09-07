import AppKit
import ApplicationServices
import Foundation
import ScreenCaptureKit

// Packaged helpers inherit the host's foreground identity when AppKit initializes.
NSApplication.shared.setActivationPolicy(.prohibited)

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
    let title: String
    let isOnScreen: Bool
    let bounds: Bounds
}

struct WindowIdentity: Codable, Hashable {
    let nativeId: UInt32
    let ownerPid: Int32
    let bundleId: String

    init(_ window: TargetWindow) {
        nativeId = window.nativeId
        ownerPid = window.ownerPid
        bundleId = window.bundleId
    }
}

struct WindowThumbnail: Encodable {
    let nativeId: UInt32
    let ownerPid: Int32
    let bundleId: String
    let thumbnail: String
}

enum WindowError: String, Error {
    case unavailable, permission, ambiguous, focus, invalid
    case space, spaceUnsupported, spaceUnknown, spaceDisplay, spaceControls

    var message: String {
        switch self {
        case .unavailable: return "Target window is no longer available"
        case .permission: return "Accessibility permission is required for the PalmDesk native window helper"
        case .ambiguous: return "Cannot identify the exact accessibility window"
        case .focus: return "The selected window could not be focused"
        case .space: return "Could not switch to the selected window's desktop"
        case .spaceUnsupported: return "Desktop switching is unavailable on this macOS version"
        case .spaceUnknown: return "Cannot determine the selected window's desktop"
        case .spaceDisplay: return "Cannot locate the display for the selected window"
        case .spaceControls: return "Mission Control desktop controls are unavailable"
        case .invalid: return "Invalid native window request"
        }
    }
}

func windows() -> [TargetWindow] {
    let entries = CGWindowListCopyWindowInfo([.optionAll, .excludeDesktopElements], kCGNullWindowID) as? [[String: Any]] ?? []
    return entries.compactMap { entry in
        guard let id = entry[kCGWindowNumber as String] as? UInt32,
              let pid = entry[kCGWindowOwnerPID as String] as? Int32,
              entry[kCGWindowLayer as String] as? Int == 0,
              (entry[kCGWindowAlpha as String] as? Double ?? 1) > 0,
              let app = NSRunningApplication(processIdentifier: pid),
              let bundle = app.bundleIdentifier,
              app.activationPolicy == .regular,
              let rawBounds = entry[kCGWindowBounds as String] as? [String: Any],
              let rect = CGRect(dictionaryRepresentation: rawBounds as CFDictionary),
              rect.width > 1, rect.height > 1 else { return nil }
        let title = entry[kCGWindowName as String] as? String ?? ""
        return TargetWindow(nativeId: id, ownerPid: pid, bundleId: bundle,
                            appName: app.localizedName ?? bundle,
                            name: title.isEmpty ? (app.localizedName ?? bundle) : title,
                            title: title,
                            isOnScreen: entry[kCGWindowIsOnscreen as String] as? Bool ?? false,
                            bounds: Bounds(x: rect.origin.x, y: rect.origin.y, width: rect.width, height: rect.height))
    }
}

func attribute(_ element: AXUIElement, _ name: CFString) -> CFTypeRef? {
    var value: CFTypeRef?
    guard AXUIElementCopyAttributeValue(element, name, &value) == .success else { return nil }
    return value
}

func listedWindows() -> [TargetWindow] {
    let all = windows()
    var accessible: [Int32: [AXUIElement]] = [:]
    if AXIsProcessTrusted() {
        for pid in Set(all.filter { !$0.isOnScreen && $0.title.isEmpty }.map { $0.ownerPid }) {
            let application = AXUIElementCreateApplication(pid)
            AXUIElementSetMessagingTimeout(application, 0.1)
            if let candidates = attribute(application, kAXWindowsAttribute as CFString) as? [AXUIElement] {
                accessible[pid] = candidates
            }
        }
    }
    return all.filter { target in
        if target.isOnScreen || !target.title.isEmpty { return true }
        // AX may omit other Spaces too. Use it only to admit real untitled windows.
        if let candidates = accessible[target.ownerPid] {
            return candidates.contains { matches($0, target) }
        }
        return false
    }
}

func thumbnails(_ requested: [WindowIdentity]) -> [WindowThumbnail] {
    guard #available(macOS 14.0, *), CGPreflightScreenCaptureAccess(), !requested.isEmpty else { return [] }
    let identities = Set(requested)
    let targets = listedWindows().filter { identities.contains(WindowIdentity($0)) }
    if targets.isEmpty { return [] }

    // Pump the main run loop for ScreenCaptureKit callbacks, with one deadline for the whole batch.
    let deadline = Date().addingTimeInterval(3)
    var content: SCShareableContent?
    var listed = false
    SCShareableContent.getExcludingDesktopWindows(true, onScreenWindowsOnly: false) { result, _ in
        DispatchQueue.main.async {
            content = result
            listed = true
        }
    }
    while !listed && Date() < deadline {
        RunLoop.current.run(until: Date().addingTimeInterval(0.01))
    }
    guard let content, Date() < deadline else { return [] }

    var pending = 0
    var images: [WindowThumbnail] = []
    for target in targets {
        guard let window = content.windows.first(where: {
            $0.windowID == target.nativeId &&
            $0.owningApplication?.processID == target.ownerPid &&
            $0.owningApplication?.bundleIdentifier == target.bundleId
        }), window.frame.width > 1, window.frame.height > 1 else { continue }
        let filter = SCContentFilter(desktopIndependentWindow: window)
        let config = SCStreamConfiguration()
        let scale = min(320 / window.frame.width, 180 / window.frame.height, 1)
        config.width = max(1, Int(window.frame.width * scale))
        config.height = max(1, Int(window.frame.height * scale))
        config.showsCursor = false
        config.scalesToFit = true
        config.ignoreShadowsSingleWindow = true
        if #available(macOS 14.2, *) { config.includeChildWindows = false }
        pending += 1
        SCScreenshotManager.captureImage(contentFilter: filter, configuration: config) { image, _ in
            DispatchQueue.main.async {
                defer { pending -= 1 }
                guard Date() < deadline, let image,
                      let jpeg = NSBitmapImageRep(cgImage: image).representation(using: .jpeg, properties: [.compressionFactor: 0.55]) else { return }
                let thumbnail = "data:image/jpeg;base64," + jpeg.base64EncodedString()
                guard thumbnail.utf8.count <= 40000 else { return }
                images.append(WindowThumbnail(nativeId: target.nativeId, ownerPid: target.ownerPid,
                                              bundleId: target.bundleId, thumbnail: thumbnail))
            }
        }
    }
    while pending > 0 && Date() < deadline {
        RunLoop.current.run(until: Date().addingTimeInterval(0.01))
    }
    let remaining = Set(windows().map { WindowIdentity($0) })
    return images.filter { image in
        targets.contains { target in
            target.nativeId == image.nativeId && remaining.contains(WindowIdentity(target))
        }
    }
}

func matches(_ element: AXUIElement, _ target: TargetWindow) -> Bool {
    // Native IDs disambiguate same-title, same-frame windows even across Spaces.
    if let number = attribute(element, "AXWindowNumber" as CFString) as? NSNumber {
        return number.uint32Value == target.nativeId
    }
    if let symbol = dlsym(UnsafeMutableRawPointer(bitPattern: -2), "_AXUIElementGetWindow") {
        typealias WindowNumber = @convention(c) (AXUIElement, UnsafeMutablePointer<UInt32>) -> Int32
        let readNumber = unsafeBitCast(symbol, to: WindowNumber.self)
        var number: UInt32 = 0
        if readNumber(element, &number) == 0 && number != 0 { return number == target.nativeId }
    }
    // If native AX IDs are unavailable, callers require a unique title/frame match.
    let title = attribute(element, kAXTitleAttribute as CFString) as? String ?? ""
    if title != target.title { return false }
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

func activateOffscreenWindow(_ target: TargetWindow) throws {
    // AXWindows can omit unvisited Spaces. Read membership through optional SkyLight APIs,
    // then select the desktop through Mission Control; no window is moved between Spaces.
    // Dock AX hierarchy: https://www.hammerspoon.org/docs/hs.spaces.html#gotoSpace
    guard let library = dlopen("/System/Library/PrivateFrameworks/SkyLight.framework/SkyLight", RTLD_LAZY) else { throw WindowError.space }
    defer { dlclose(library) }
    guard let connectionSymbol = dlsym(library, "SLSMainConnectionID"),
          let membershipSymbol = dlsym(library, "SLSCopySpacesForWindows"),
          let displaysSymbol = dlsym(library, "SLSCopyManagedDisplaySpaces"),
          let notificationSymbol = dlsym(UnsafeMutableRawPointer(bitPattern: -2), "CoreDockSendNotification") else { throw WindowError.spaceUnsupported }
    typealias Connection = @convention(c) () -> Int32
    typealias Membership = @convention(c) (Int32, Int32, CFArray) -> Unmanaged<CFArray>?
    typealias Displays = @convention(c) (Int32) -> Unmanaged<CFArray>?
    typealias Notification = @convention(c) (CFString, Int32) -> Int32
    let connection = unsafeBitCast(connectionSymbol, to: Connection.self)()
    let membership = unsafeBitCast(membershipSymbol, to: Membership.self)
    let displays = unsafeBitCast(displaysSymbol, to: Displays.self)
    let notifyDock = unsafeBitCast(notificationSymbol, to: Notification.self)
    guard let spaces = membership(connection, 7, [NSNumber(value: target.nativeId)] as CFArray)?.takeRetainedValue() as? [NSNumber],
          !spaces.isEmpty else { throw WindowError.spaceUnknown }
    func location() -> (display: String, index: Int, count: Int, current: Bool)? {
        let entries = displays(connection)?.takeRetainedValue() as? [[String: Any]] ?? []
        for entry in entries {
            guard let uuid = entry["Display Identifier"] as? String,
                  let desktops = entry["Spaces"] as? [[String: Any]] else { continue }
            let current = (entry["Current Space"] as? [String: Any])?["ManagedSpaceID"] as? NSNumber
            if let current, spaces.contains(current) { return (uuid, 0, desktops.count, true) }
            if let index = desktops.firstIndex(where: { desktop in
                guard let id = desktop["ManagedSpaceID"] as? NSNumber else { return false }
                return spaces.contains(id)
            }) { return (uuid, index, desktops.count, false) }
        }
        return nil
    }
    guard let destination = location() else { throw WindowError.spaceUnknown }
    if destination.current { return }
    guard let screen = NSScreen.screens.first(where: { screen in
        if destination.display == "Main" { return screen == NSScreen.screens.first }
        guard let id = screen.deviceDescription[NSDeviceDescriptionKey("NSScreenNumber")] as? UInt32,
              let uuid = CGDisplayCreateUUIDFromDisplayID(id)?.takeRetainedValue() else { return false }
        return CFUUIDCreateString(nil, uuid) as String == destination.display
    }), let displayId = screen.deviceDescription[NSDeviceDescriptionKey("NSScreenNumber")] as? UInt32,
       let dockApp = NSRunningApplication.runningApplications(withBundleIdentifier: "com.apple.dock").first else { throw WindowError.spaceDisplay }
    let dock = AXUIElementCreateApplication(dockApp.processIdentifier)
    AXUIElementSetMessagingTimeout(dock, 0.2)
    func children(_ element: AXUIElement) -> [AXUIElement] {
        attribute(element, kAXChildrenAttribute as CFString) as? [AXUIElement] ?? []
    }
    func child(_ element: AXUIElement, _ identifier: String) -> AXUIElement? {
        children(element).first { attribute($0, kAXIdentifierAttribute as CFString) as? String == identifier }
    }
    let opened = child(dock, "mc") == nil
    if opened { _ = notifyDock("com.apple.expose.awake" as CFString, 0) }
    defer {
        if opened && child(dock, "mc") != nil { _ = notifyDock("com.apple.expose.awake" as CFString, 0) }
    }
    RunLoop.current.run(until: Date().addingTimeInterval(0.3))
    let deadline = Date().addingTimeInterval(2)
    while Date() < deadline {
        if let mc = child(dock, "mc"),
           let display = children(mc).first(where: { attribute($0, "AXDisplayID" as CFString) as? UInt32 == displayId }),
           let group = child(display, "mc.spaces"),
           let list = child(group, "mc.spaces.list"),
           let refreshed = location(), refreshed.display == destination.display {
            let buttons = children(list)
            if refreshed.current { return }
            if buttons.count == refreshed.count, buttons.indices.contains(refreshed.index),
               AXUIElementPerformAction(buttons[refreshed.index], kAXPressAction as CFString) == .success {
                let transitionDeadline = Date().addingTimeInterval(2)
                repeat {
                    RunLoop.current.run(until: Date().addingTimeInterval(0.05))
                    if child(dock, "mc") == nil, location()?.current == true { return }
                } while Date() < transitionDeadline
                throw WindowError.space
            }
        }
        RunLoop.current.run(until: Date().addingTimeInterval(0.05))
    }
    throw WindowError.spaceControls
}

func focus(_ id: UInt32, _ pid: Int32, _ bundle: String) throws -> TargetWindow {
    guard AXIsProcessTrusted() else { throw WindowError.permission }
    var appWindows = windows().filter { $0.ownerPid == pid && $0.bundleId == bundle }
    guard var target = appWindows.first(where: { $0.nativeId == id }),
          let running = NSRunningApplication(processIdentifier: pid) else { throw WindowError.unavailable }
    let application = AXUIElementCreateApplication(pid)
    AXUIElementSetMessagingTimeout(application, 0.5)
    var candidates = (attribute(application, kAXWindowsAttribute as CFString) as? [AXUIElement] ?? []).filter { matches($0, target) }
    if !target.isOnScreen && candidates.isEmpty {
        try activateOffscreenWindow(target)
        let deadline = Date().addingTimeInterval(2)
        repeat {
            RunLoop.current.run(until: Date().addingTimeInterval(0.05))
            appWindows = windows().filter { $0.ownerPid == pid && $0.bundleId == bundle }
            guard let refreshed = appWindows.first(where: { $0.nativeId == id }) else { throw WindowError.unavailable }
            target = refreshed
            candidates = (attribute(application, kAXWindowsAttribute as CFString) as? [AXUIElement] ?? []).filter { matches($0, target) }
        } while candidates.isEmpty && Date() < deadline
    }
    guard candidates.count == 1,
          appWindows.filter({ matches(candidates[0], $0) }).count == 1 else { throw WindowError.ambiguous }
    let window = candidates[0]
    func focusedTarget() -> TargetWindow? {
        guard NSWorkspace.shared.frontmostApplication?.processIdentifier == pid,
              let focused = attribute(application, kAXFocusedWindowAttribute as CFString),
              CFGetTypeID(focused) == AXUIElementGetTypeID(),
              CFEqual(focused, window) else { return nil }
        let refreshedWindows = windows().filter { $0.ownerPid == pid && $0.bundleId == bundle }
        guard let refreshed = refreshedWindows.first(where: { $0.nativeId == id }),
              refreshed.isOnScreen,
              matches(window, refreshed),
              refreshedWindows.filter({ matches(window, $0) }).count == 1 else { return nil }
        return refreshed
    }

    if let refreshed = focusedTarget() { return refreshed }
    if attribute(window, kAXMinimizedAttribute as CFString) as? Bool == true {
        guard AXUIElementSetAttributeValue(window, kAXMinimizedAttribute as CFString, kCFBooleanFalse) == .success else { throw WindowError.focus }
    }
    // Choose the exact main window before activating an app with windows on multiple Spaces.
    _ = AXUIElementSetAttributeValue(window, kAXMainAttribute as CFString, kCFBooleanTrue)
    _ = AXUIElementPerformAction(window, kAXRaiseAction as CFString)
    if !target.isOnScreen { try activateOffscreenWindow(target) }
    _ = running.activate(options: [])
    // Apps can reject individual AX setters even when activation succeeds.
    // Authorize input only from the verified foreground window below.
    _ = AXUIElementSetAttributeValue(application, kAXFrontmostAttribute as CFString, kCFBooleanTrue)
    _ = AXUIElementPerformAction(window, kAXRaiseAction as CFString)
    _ = AXUIElementSetAttributeValue(application, kAXFocusedWindowAttribute as CFString, window)
    let deadline = Date().addingTimeInterval(2)
    while Date() < deadline {
        if let refreshed = focusedTarget() { return refreshed }
        RunLoop.current.run(until: Date().addingTimeInterval(0.025))
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
            data = try JSONSerialization.jsonObject(with: JSONEncoder().encode(listedWindows()))
        case "thumbnails":
            guard let requested = request["windows"] as? [[String: Any]] else { throw WindowError.invalid }
            let identities = try JSONDecoder().decode([WindowIdentity].self, from: JSONSerialization.data(withJSONObject: requested))
            data = try JSONSerialization.jsonObject(with: JSONEncoder().encode(thumbnails(identities)))
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
    } catch let error as WindowError {
        response = ["requestId": requestId, "error": error.message, "errorCode": error.rawValue]
    } catch {
        response = ["requestId": requestId, "error": error.localizedDescription]
    }
    if let output = try? JSONSerialization.data(withJSONObject: response, options: [.sortedKeys]),
       let json = String(data: output, encoding: .utf8) {
        print(json)
        fflush(stdout)
    }
}
