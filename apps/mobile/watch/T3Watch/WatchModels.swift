import Foundation

/// Snapshot the iPhone app sends over WatchConnectivity (applicationContext key "snapshot").
/// Keep in sync with apps/mobile/src/features/watch/watchSnapshot.ts.
struct WatchSnapshot: Codable, Equatable {
  var v: Int
  var generatedAt: Double
  var waiting: [WaitingItem]
  var doneToday: Int

  static let empty = WatchSnapshot(v: 1, generatedAt: 0, waiting: [], doneToday: 0)
}

struct WaitingItem: Codable, Hashable, Identifiable {
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
  /// Finished threads only: done, failed, limited or guest.
  var status: String?
}

struct QuestionOption: Codable, Hashable, Identifiable {
  var id: String
  var label: String
}

struct Graphic: Codable, Hashable, Identifiable {
  var id: String
  var title: String
}

extension WaitingItem {
  var threadKey: String { "\(environmentId)/\(threadId)" }
  var needsAnswer: Bool { kind != .finished }
}

/// The iPhone's reply to a "thread" request: the newest chat lines, oldest first.
/// Keep in sync with apps/mobile/src/features/watch/watchThread.ts.
struct ThreadDetail: Codable, Equatable {
  var entries: [ThreadEntry]
  var truncated: Bool
}

struct ThreadEntry: Codable, Equatable, Identifiable {
  enum Role: String, Codable { case user, agent, graphic }

  var id: String
  var role: Role
  var text: String?
  var attachmentId: String?
  var title: String?
}

/// Rendered agent graphics the iPhone sends as JPEG files, cached by attachment id.
enum WatchGraphics {
  static var directory: URL {
    let base = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0]
    let dir = base.appendingPathComponent("graphics", isDirectory: true)
    try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
    return dir
  }

  static func url(for attachmentId: String) -> URL {
    let name = attachmentId.addingPercentEncoding(withAllowedCharacters: .alphanumerics) ?? attachmentId
    return directory.appendingPathComponent(name + ".jpg")
  }

  static func cachedIds() -> [String] {
    let files = (try? FileManager.default.contentsOfDirectory(atPath: directory.path)) ?? []
    return files.compactMap { file in
      guard file.hasSuffix(".jpg") else { return nil }
      return String(file.dropLast(4)).removingPercentEncoding
    }
  }

  static func store(_ file: URL, attachmentId: String) {
    let target = url(for: attachmentId)
    try? FileManager.default.removeItem(at: target)
    try? FileManager.default.moveItem(at: file, to: target)
  }
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
