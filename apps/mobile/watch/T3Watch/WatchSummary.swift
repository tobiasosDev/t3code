import Foundation

/// What the widget shows, shared through the iOS app's app group.
/// Keep in sync with T3WatchWidget/T3WatchWidget.swift.
enum WatchSummary {
  static let waitingCount = "t3.watch.summary.waitingCount"
  static let firstTitle = "t3.watch.summary.firstTitle"
  static let firstThread = "t3.watch.summary.firstThread"
  static let runningCount = "t3.watch.summary.runningCount"

  /// "<ios bundle id>.watchkitapp" shares "group.<ios bundle id>".
  static var defaults: UserDefaults? {
    guard let bundleId = Bundle.main.bundleIdentifier,
          let range = bundleId.range(of: ".watchkitapp") else { return nil }
    return UserDefaults(suiteName: "group." + bundleId[..<range.lowerBound])
  }
}
