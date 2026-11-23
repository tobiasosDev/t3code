import ExpoModulesCore
import WatchConnectivity

/// Owns the iPhone side of WatchConnectivity. Actions from the watch stay queued in
/// UserDefaults until JavaScript acknowledges them, so a tap survives a suspended or offline app.
final class T3WatchSession: NSObject, WCSessionDelegate {
  static let shared = T3WatchSession()

  private let queueKey = "t3.watch.pendingActions"
  private let lock = NSLock()
  var onAction: (() -> Void)?
  var onStateChange: (() -> Void)?

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

  func pendingActions() -> [[String: Any]] {
    lock.lock()
    defer { lock.unlock() }
    return UserDefaults.standard.array(forKey: queueKey) as? [[String: Any]] ?? []
  }

  func acknowledge(_ ids: [String]) {
    lock.lock()
    defer { lock.unlock() }
    let remove = Set(ids)
    let pending = UserDefaults.standard.array(forKey: queueKey) as? [[String: Any]] ?? []
    let kept = pending.filter { action in
      guard let id = action["id"] as? String else { return false }
      return !remove.contains(id)
    }
    UserDefaults.standard.set(kept, forKey: queueKey)
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

  func session(_ session: WCSession, activationDidCompleteWith activationState: WCSessionActivationState, error: Error?) {
    onStateChange?()
  }

  func sessionWatchStateDidChange(_ session: WCSession) {
    onStateChange?()
  }

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

    Events("action", "state")

    OnCreate {
      T3WatchSession.shared.onAction = { [weak self] in
        self?.sendEvent("action", [:])
      }
      T3WatchSession.shared.onStateChange = { [weak self] in
        self?.sendEvent("state", [:])
      }
      T3WatchSession.shared.activate()
    }

    OnDestroy {
      T3WatchSession.shared.onAction = nil
      T3WatchSession.shared.onStateChange = nil
    }

    Function("getState") { () -> [String: Any] in
      T3WatchSession.shared.state()
    }

    Function("updateSnapshot") { (json: String) in
      try T3WatchSession.shared.updateSnapshot(json)
    }

    Function("pendingActions") { () -> [[String: Any]] in
      T3WatchSession.shared.pendingActions()
    }

    Function("acknowledgeActions") { (ids: [String]) in
      T3WatchSession.shared.acknowledge(ids)
    }
  }
}
