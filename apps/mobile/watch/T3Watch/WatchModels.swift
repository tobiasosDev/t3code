import Foundation

/// Snapshot the iPhone app sends over WatchConnectivity (applicationContext key "snapshot").
/// Keep in sync with apps/mobile/src/features/watch/watchSnapshot.ts.
struct WatchSnapshot: Codable, Equatable {
  var v: Int
  var generatedAt: Double
  var waiting: [WaitingItem]
  var running: [RunningThread]
  var doneToday: Int

  static let empty = WatchSnapshot(v: 1, generatedAt: 0, waiting: [], running: [], doneToday: 0)
}

struct WaitingItem: Codable, Equatable, Identifiable {
  enum Kind: String, Codable { case approval, question, finished }

  var id: String
  var kind: Kind
  var environmentId: String
  var threadId: String
  var requestId: String
  var threadTitle: String
  var project: String?
  var since: Double
  var userMessage: String?
  var agentMessage: String?
  var title: String
  var detail: String?
  /// Set when the watch can answer: a single question.
  var questionId: String?
  var allowsText: Bool?
  var options: [QuestionOption]?
  var graphics: [Graphic]?
}

struct QuestionOption: Codable, Equatable, Identifiable {
  var id: String
  var label: String
}

struct Graphic: Codable, Equatable, Identifiable {
  var id: String
  var title: String
}

struct RunningThread: Codable, Equatable, Identifiable {
  var id: String { "\(environmentId)/\(threadId)" }
  var environmentId: String
  var threadId: String
  var title: String
  var project: String?
  var since: Double
}

/// What the watch asks the iPhone to do. Sent as a flat [String: Any] dictionary.
struct WatchAction {
  enum Kind: String { case approve, deny, answer, reply }

  var kind: Kind
  var item: WaitingItem
  var text: String? = nil
  var optionId: String? = nil

  var dictionary: [String: Any] {
    var dict: [String: Any] = [
      "type": kind.rawValue,
      "id": UUID().uuidString,
      "itemId": item.id,
      "environmentId": item.environmentId,
      "threadId": item.threadId,
      "requestId": item.requestId,
      "sentAt": Date().timeIntervalSince1970 * 1000,
    ]
    if let questionId = item.questionId { dict["questionId"] = questionId }
    if let text { dict["text"] = text }
    if let optionId { dict["optionId"] = optionId }
    return dict
  }
}

enum RelativeTime {
  static func short(_ ms: Double, now: Date = Date()) -> String {
    guard ms > 0 else { return "" }
    let seconds = max(0, now.timeIntervalSince1970 - ms / 1000)
    if seconds < 60 { return "jetzt" }
    let minutes = Int(seconds / 60)
    if minutes < 60 { return "\(minutes) min" }
    let hours = minutes / 60
    if hours < 24 { return "\(hours) h" }
    return "\(hours / 24) d"
  }
}
