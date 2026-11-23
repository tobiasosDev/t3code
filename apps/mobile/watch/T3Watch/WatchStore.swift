import Foundation
import WatchConnectivity
import WatchKit

/// Receives snapshots from the iPhone app and sends the user's answers back.
final class WatchStore: NSObject, ObservableObject, WCSessionDelegate {
  @Published private(set) var snapshot: WatchSnapshot = .empty
  @Published private(set) var sentItemIds: Set<String> = []
  @Published private(set) var phoneReachable = false
  /// Answers need an activated session; until then the cards stay read-only.
  @Published private(set) var canSend = false

  private let cacheKey = "t3.watch.snapshot"

  override init() {
    super.init()
    if let data = UserDefaults.standard.data(forKey: cacheKey),
       let cached = try? JSONDecoder().decode(WatchSnapshot.self, from: data) {
      snapshot = cached
    }
    if WCSession.isSupported() {
      WCSession.default.delegate = self
      WCSession.default.activate()
    }
  }

  /// Items still waiting, minus the ones answered on this watch since the last snapshot.
  var waiting: [WaitingItem] {
    snapshot.waiting.filter { !sentItemIds.contains($0.id) }
  }

  var hasSnapshot: Bool { snapshot.generatedAt > 0 }

  func send(_ action: WatchAction) {
    let session = WCSession.default
    guard session.activationState == .activated else { return }
    let payload = action.dictionary
    sentItemIds.insert(action.item.id)
    WKInterfaceDevice.current().play(.success)
    if session.isReachable {
      session.sendMessage(payload, replyHandler: nil) { _ in
        session.transferUserInfo(payload)
      }
    } else {
      session.transferUserInfo(payload)
    }
  }

  private func apply(_ context: [String: Any]) {
    guard let json = context["snapshot"] as? String,
          let data = json.data(using: .utf8),
          let next = try? JSONDecoder().decode(WatchSnapshot.self, from: data) else { return }
    DispatchQueue.main.async {
      guard next.generatedAt >= self.snapshot.generatedAt else { return }
      self.snapshot = next
      let ids = Set(next.waiting.map(\.id))
      self.sentItemIds = self.sentItemIds.intersection(ids)
      UserDefaults.standard.set(data, forKey: self.cacheKey)
    }
  }

  private func updateReachability(_ session: WCSession) {
    let reachable = session.isReachable
    DispatchQueue.main.async { self.phoneReachable = reachable }
  }

  // MARK: WCSessionDelegate

  func session(_ session: WCSession, activationDidCompleteWith activationState: WCSessionActivationState, error: Error?) {
    apply(session.receivedApplicationContext)
    updateReachability(session)
    let activated = activationState == .activated
    DispatchQueue.main.async { self.canSend = activated }
  }

  func session(_ session: WCSession, didReceiveApplicationContext applicationContext: [String: Any]) {
    apply(applicationContext)
  }

  func sessionReachabilityDidChange(_ session: WCSession) {
    updateReachability(session)
  }
}
