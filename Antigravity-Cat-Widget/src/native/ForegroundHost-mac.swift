import AppKit
import CoreGraphics
import Foundation

// Arguments: args[1] = parent PID, args[2] = optional widget window handle / ID
let args = CommandLine.arguments
let parentPid = args.count > 1 ? Int32(args[1]) ?? 0 : 0

// Watch stdin in background thread so parent exit or detach stops helper immediately
Thread.detachNewThread {
    while let line = readLine() {
        if line.contains("detach") {
            exit(0)
        }
    }
    // stdin closed
    exit(0)
}

var trackedHostId: Int = 0
var restoreGeneration: Int = 0
var previousMessage: String = ""
var lastHeartbeat = Date()

while true {
    // Check if parent process is still alive
    if parentPid > 0 && kill(parentPid, 0) != 0 {
        break
    }

    let frontApp = NSWorkspace.shared.frontmostApplication
    let frontPid = frontApp?.processIdentifier ?? 0
    let frontName = frontApp?.localizedName ?? ""
    let frontBundle = frontApp?.bundleIdentifier ?? ""

    let isHostForeground = frontName.localizedCaseInsensitiveContains("Antigravity") || frontBundle.localizedCaseInsensitiveContains("antigravity")
    let isSelfForeground = parentPid > 0 && frontPid == parentPid

    let foregroundKind: String
    if isSelfForeground {
        foregroundKind = "self"
    } else if isHostForeground {
        foregroundKind = "host"
    } else if ["Finder", "Dock"].contains(frontName) {
        foregroundKind = "desktop"
    } else if ["Google Chrome", "Safari", "Arc", "Microsoft Edge", "Firefox", "Zen"].contains(frontName) {
        foregroundKind = "browser"
    } else {
        foregroundKind = "other"
    }

    let windowList = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID) as? [[String: Any]] ?? []

    // 1. Identify which application owns the top-most regular Layer 0 window
    var topLayer0Owner: String = ""
    for w in windowList {
        let layer = w[kCGWindowLayer as String] as? Int ?? -1
        let bounds = w[kCGWindowBounds as String] as? [String: Any] ?? [:]
        let width = bounds["Width"] as? Double ?? 0
        let height = bounds["Height"] as? Double ?? 0
        let pid = w[kCGWindowOwnerPID as String] as? Int32 ?? 0
        if layer == 0 && width > 100 && height > 100 && (parentPid <= 0 || pid != parentPid) {
            topLayer0Owner = w[kCGWindowOwnerName as String] as? String ?? ""
            break
        }
    }
    let topLayer0IsHost = topLayer0Owner.localizedCaseInsensitiveContains("Antigravity")

    // 2. Locate Antigravity's window and its index in the front-to-back Z-order
    var bestWindow: [String: Any]? = nil
    var hostIndex: Int = -1
    var maxArea: Double = 0

    for (idx, w) in windowList.enumerated() {
        guard let owner = w[kCGWindowOwnerName as String] as? String,
              owner.localizedCaseInsensitiveContains("Antigravity"),
              let layer = w[kCGWindowLayer as String] as? Int, layer == 0,
              let bounds = w[kCGWindowBounds as String] as? [String: Any],
              let width = bounds["Width"] as? Double, width > 300,
              let height = bounds["Height"] as? Double, height > 200 else {
            continue
        }
        let area = width * height
        if area > maxArea {
            maxArea = area
            bestWindow = w
            hostIndex = idx
        }
    }

    // 3. Find current Catstella pet window bounds on screen, if present
    var currentPetRect: CGRect? = nil
    for w in windowList {
        let pid = w[kCGWindowOwnerPID as String] as? Int32 ?? 0
        let owner = w[kCGWindowOwnerName as String] as? String ?? ""
        if (parentPid > 0 && pid == parentPid) || owner.contains("Catstella") {
            if let bounds = w[kCGWindowBounds as String] as? [String: Any],
               let px = bounds["X"] as? Double, let py = bounds["Y"] as? Double,
               let pw = bounds["Width"] as? Double, let ph = bounds["Height"] as? Double,
               pw > 50, ph > 50 {
                currentPetRect = CGRect(x: px, y: py, width: pw, height: ph)
                break
            }
        }
    }

    // 4. Check for Z-order occlusion:
    // If another app's window is in front of Antigravity (index < hostIndex) and covers the pet's area
    var isOccluded = false
    if let hw = bestWindow, hostIndex > 0,
       let hb = hw[kCGWindowBounds as String] as? [String: Any],
       let hx = hb["X"] as? Double, let hy = hb["Y"] as? Double,
       let hwWidth = hb["Width"] as? Double, let hh = hb["Height"] as? Double {

        let checkRects: [CGRect]
        if let pet = currentPetRect {
            checkRects = [pet]
        } else {
            let rightDock = CGRect(x: hx + hwWidth - 360, y: hy + hh - 554, width: 360, height: 554)
            let leftDock = CGRect(x: hx, y: hy + hh - 554, width: 360, height: 554)
            checkRects = [rightDock, leftDock]
        }

        for i in 0..<hostIndex {
            let w = windowList[i]
            let layer = w[kCGWindowLayer as String] as? Int ?? -1
            let owner = w[kCGWindowOwnerName as String] as? String ?? ""
            let pid = w[kCGWindowOwnerPID as String] as? Int32 ?? 0

            if (parentPid > 0 && pid == parentPid) || owner.contains("Catstella") || owner.localizedCaseInsensitiveContains("Antigravity") {
                continue
            }

            guard layer >= 0 && layer < 20,
                  let wb = w[kCGWindowBounds as String] as? [String: Any],
                  let wx = wb["X"] as? Double, let wy = wb["Y"] as? Double,
                  let ww = wb["Width"] as? Double, let wh = wb["Height"] as? Double,
                  ww > 60, wh > 60 else {
                continue
            }

            let winRect = CGRect(x: wx, y: wy, width: ww, height: wh)
            if checkRects.contains(where: { winRect.intersects($0) }) {
                isOccluded = true
                break
            }
        }
    }

    // 5. Host is considered foreground ONLY IF:
    // - Antigravity is the frontmost app (or top regular window)
    // - AND Antigravity's pet area is NOT occluded by a window in front
    // - (Or if the user is interacting with Catstella itself)
    let hostIsActive = (isHostForeground || topLayer0IsHost) && !isOccluded
    let canShow = hostIsActive || isSelfForeground

    let message: String
    if let hw = bestWindow,
       let b = hw[kCGWindowBounds as String] as? [String: Any],
       let x = b["X"] as? Double, let y = b["Y"] as? Double,
       let w = b["Width"] as? Double, let h = b["Height"] as? Double,
       let id = hw[kCGWindowNumber as String] as? Int {
        if trackedHostId != id {
            trackedHostId = id
            restoreGeneration += 1
        }
        let boundsStr = "{\"x\":\(Int(round(x))),\"y\":\(Int(round(y))),\"width\":\(Int(round(w))),\"height\":\(Int(round(h)))}"
        let kind = canShow ? (hostIsActive ? "host" : "self") : "other"
        message = "{\"foregroundKind\":\"\(foregroundKind)\",\"restoreGeneration\":\(restoreGeneration),\"kind\":\"\(kind)\",\"bounds\":\(boundsStr),\"attached\":\(canShow),\"widgetVisible\":\(canShow),\"hostId\":\"\(id)\",\"nativeFollowing\":false}"
    } else {
        let kind = isSelfForeground ? "self" : "other"
        message = "{\"foregroundKind\":\"\(foregroundKind)\",\"restoreGeneration\":\(restoreGeneration),\"kind\":\"\(kind)\",\"bounds\":null,\"attached\":false,\"widgetVisible\":false,\"hostId\":\"0\",\"nativeFollowing\":false}"
    }

    let now = Date()
    if message != previousMessage || now.timeIntervalSince(lastHeartbeat) >= 1.0 {
        print(message)
        fflush(stdout)
        previousMessage = message
        lastHeartbeat = now
    }

    Thread.sleep(forTimeInterval: 0.035) // ~30 FPS poll
}
