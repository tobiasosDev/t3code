import Foundation
import WatchConnectivity
import WatchKit
import WidgetKit

/// Receives snapshots from the iPhone app and sends the user's answers back.
final class WatchStore: NSObject, ObservableObject, WCSessionDelegate {
  @Published private(set) var snapshot: WatchSnapshot = .empty
  @Published private(set) var sentItemIds: Set<String> = []
  @Published private(set) var phoneReachable = false
  /// Answers need an activated session; until then the cards stay read-only.
  @Published private(set) var canSend = false
  /// Full chats the iPhone sent back, by "<environmentId>/<threadId>".
  @Published private(set) var details: [String: ThreadDetail] = [:]
  @Published private(set) var loadingThreads: Set<String> = []
  /// Bumped when a graphic file arrives so open threads reload their images.
  @Published private(set) var graphicsVersion = 0

  private let cacheKey = "t3.watch.snapshot"
  private let detailsKey = "t3.watch.details"
  private let isPreview: Bool

  #if DEBUG
  /// Previews and layout checks: a fixed snapshot, no WatchConnectivity.
  init(preview: WatchSnapshot, details: [String: ThreadDetail] = [:]) {
    isPreview = true
    super.init()
    snapshot = preview
    self.details = details
    canSend = true
    phoneReachable = true
  }
  #endif

  override init() {
    isPreview = false
    super.init()
    if let data = UserDefaults.standard.data(forKey: cacheKey),
       let cached = try? JSONDecoder().decode(WatchSnapshot.self, from: data) {
      snapshot = cached
    }
    if let data = UserDefaults.standard.data(forKey: detailsKey),
       let cached = try? JSONDecoder().decode([String: ThreadDetail].self, from: data) {
      details = cached
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
    guard isPreview || session.activationState == .activated else { return }
    let payload = action.dictionary
    sentItemIds.insert(action.item.id)
    WKInterfaceDevice.current().play(.success)
    publishSummary()
    guard !isPreview else { return }
    if session.isReachable {
      session.sendMessage(payload, replyHandler: nil) { _ in
        session.transferUserInfo(payload)
      }
    } else {
      session.transferUserInfo(payload)
    }
  }

  /// Asks the iPhone for the thread's chat; it replies with the text and sends graphics as files.
  func requestThread(_ item: WaitingItem) {
    let key = item.threadKey
    let session = WCSession.default
    guard !isPreview, !loadingThreads.contains(key),
          session.activationState == .activated, session.isReachable else { return }
    loadingThreads.insert(key)
    let message: [String: Any] = [
      "type": "thread",
      "requestId": UUID().uuidString,
      "environmentId": item.environmentId,
      "threadId": item.threadId,
      "have": WatchGraphics.cachedIds(),
    ]
    session.sendMessage(message, replyHandler: { reply in
      // A reply without entries (the iPhone could not load the thread) keeps the cached chat.
      let detail = (reply["thread"] as? Data)
        .flatMap { try? JSONDecoder().decode(ThreadDetail.self, from: $0) }
      DispatchQueue.main.async {
        self.loadingThreads.remove(key)
        guard let detail else { return }
        self.details[key] = detail
        self.persistDetails()
      }
    }, errorHandler: { _ in
      DispatchQueue.main.async { self.loadingThreads.remove(key) }
    })
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
      // Chats are kept only for threads the snapshot still lists.
      let keys = Set(next.waiting.map(\.threadKey))
      self.details = self.details.filter { keys.contains($0.key) }
      self.persistDetails()
      self.publishSummary()
    }
  }

  private func persistDetails() {
    guard !isPreview, let data = try? JSONEncoder().encode(details) else { return }
    UserDefaults.standard.set(data, forKey: detailsKey)
  }

  /// Leaves the widget what it shows and asks WidgetKit to redraw it.
  private func publishSummary() {
    guard let defaults = WatchSummary.defaults else { return }
    let first = waiting.first
    defaults.set(waiting.count, forKey: WatchSummary.waitingCount)
    defaults.set(first?.title, forKey: WatchSummary.firstTitle)
    defaults.set(first?.threadTitle, forKey: WatchSummary.firstThread)
    WidgetCenter.shared.reloadAllTimelines()
  }

  private func updateReachability(_ session: WCSession) {
    let reachable = session.isReachable
    DispatchQueue.main.async {
      self.phoneReachable = reachable
      #if DEBUG
      if reachable { self.runRequestProbe() }
      #endif
    }
  }

  // MARK: WCSessionDelegate

  func session(_ session: WCSession, activationDidCompleteWith activationState: WCSessionActivationState, error: Error?) {
    apply(session.receivedApplicationContext)
    updateReachability(session)
    let activated = activationState == .activated
    DispatchQueue.main.async { self.canSend = activated }
  }

  #if DEBUG
  /// Simulator check of the thread request: T3_WATCH_REQUEST="<environmentId>/<threadId>".
  private var probed = false

  private func runRequestProbe() {
    guard !probed, let ref = ProcessInfo.processInfo.environment["T3_WATCH_REQUEST"],
          let slash = ref.firstIndex(of: "/") else { return }
    probed = true
    let item = WaitingItem(
      id: "probe", kind: .finished, environmentId: String(ref[..<slash]),
      threadId: String(ref[ref.index(after: slash)...]), requestId: "", threadTitle: "probe",
      since: 0, title: "probe"
    )
    requestThread(item)
    DispatchQueue.main.asyncAfter(deadline: .now() + 20) {
      let entries = self.details[item.threadKey]?.entries ?? []
      NSLog("[T3WatchProbe] entries=%d roles=%@ graphics=%@", entries.count,
            entries.map(\.role.rawValue).joined(separator: ","), WatchGraphics.cachedIds().joined(separator: ","))
    }
  }
  #endif

  func session(_ session: WCSession, didReceiveApplicationContext applicationContext: [String: Any]) {
    apply(applicationContext)
  }

  func sessionReachabilityDidChange(_ session: WCSession) {
    updateReachability(session)
  }

  // The file is deleted when this returns, so it moves into the cache right here.
  func session(_ session: WCSession, didReceive file: WCSessionFile) {
    guard file.metadata?["type"] as? String == "graphic",
          let attachmentId = file.metadata?["attachmentId"] as? String else { return }
    WatchGraphics.store(file.fileURL, attachmentId: attachmentId)
    DispatchQueue.main.async { self.graphicsVersion += 1 }
  }
}
