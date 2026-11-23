import ExpoModulesCore
import WatchConnectivity

/// Owns the iPhone side of WatchConnectivity. Actions from the watch queue here (and in
/// UserDefaults) until JavaScript drains them, so a tap on the watch survives a suspended app.
final class T3WatchSession: NSObject, WCSessionDelegate {
  static let shared = T3WatchSession()

  private let queueKey = "t3.watch.pendingActions"
  private let lock = NSLock()
  var onAction: (() -> Void)?

  func activate() {
    guard WCSession.isSupported() else { return }
    let session = WCSession.default
    if session.delegate == nil { session.delegate = self }
    if session.activationState != .activated { session.activate() }
  }

  func state() -> [String: Any] {
    guard WCSession.isSupported() else { return ["supported": false] }
    let session = WCSession.default
    return [
      "supported": true,
      "activated": session.activationState == .activated,
      "paired": session.isPaired,
      "watchAppInstalled": session.isWatchAppInstalled,
      "reachable": session.isReachable,
    ]
  }

  func updateSnapshot(_ json: String) throws {
    guard WCSession.isSupported() else { return }
    let session = WCSession.default
    guard session.activationState == .activated, session.isPaired, session.isWatchAppInstalled else { return }
    try session.updateApplicationContext(["snapshot": json])
  }

  func drain() -> [[String: Any]] {
    lock.lock()
    defer { lock.unlock() }
    let pending = UserDefaults.standard.array(forKey: queueKey) as? [[String: Any]] ?? []
    UserDefaults.standard.removeObject(forKey: queueKey)
    return pending
  }

  private func enqueue(_ action: [String: Any]) {
    lock.lock()
    var pending = UserDefaults.standard.array(forKey: queueKey) as? [[String: Any]] ?? []
    let id = action["id"] as? String
    if id == nil || !pending.contains(where: { $0["id"] as? String == id }) {
      pending.append(action)
    }
    UserDefaults.standard.set(pending, forKey: queueKey)
    lock.unlock()
    onAction?()
  }

  // MARK: WCSessionDelegate

  func session(_ session: WCSession, activationDidCompleteWith activationState: WCSessionActivationState, error: Error?) {}

  func sessionDidBecomeInactive(_ session: WCSession) {}

  func sessionDidDeactivate(_ session: WCSession) {
    session.activate()
  }

  func session(_ session: WCSession, didReceiveMessage message: [String: Any]) {
    enqueue(message)
  }

  func session(_ session: WCSession, didReceiveUserInfo userInfo: [String: Any] = [:]) {
    enqueue(userInfo)
  }
}

public final class T3WatchBridgeModule: Module {
  public func definition() -> ModuleDefinition {
    Name("T3WatchBridge")

    Events("action")

    OnCreate {
      T3WatchSession.shared.onAction = { [weak self] in
        self?.sendEvent("action", [:])
      }
      T3WatchSession.shared.activate()
    }

    OnDestroy {
      T3WatchSession.shared.onAction = nil
    }

    Function("getState") { () -> [String: Any] in
      T3WatchSession.shared.state()
    }

    Function("updateSnapshot") { (json: String) in
      try T3WatchSession.shared.updateSnapshot(json)
    }

    Function("drainActions") { () -> [[String: Any]] in
      T3WatchSession.shared.drain()
    }
  }
}
