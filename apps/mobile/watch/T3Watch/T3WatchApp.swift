import SwiftUI

@main
struct T3WatchApp: App {
  @StateObject private var store = WatchApp.makeStore()

  var body: some Scene {
    WindowGroup {
      InboxView()
        .environmentObject(store)
    }
  }
}

enum WatchApp {
  static func makeStore() -> WatchStore {
    #if DEBUG
    // Layout checks launch with a fixed snapshot instead of a paired iPhone.
    let environment = ProcessInfo.processInfo.environment
    if let json = environment["T3_WATCH_FIXTURE"],
       let fixture = try? JSONDecoder().decode(WatchSnapshot.self, from: Data(json.utf8)) {
      let details = environment["T3_WATCH_DETAILS"]
        .flatMap { try? JSONDecoder().decode([String: ThreadDetail].self, from: Data($0.utf8)) } ?? [:]
      // One picture stands in for every graphic in the fixture chats.
      if let graphic = environment["T3_WATCH_GRAPHIC"], let data = FileManager.default.contents(atPath: graphic) {
        for entry in details.values.flatMap(\.entries) {
          if let id = entry.attachmentId { try? data.write(to: WatchGraphics.url(for: id)) }
        }
      }
      return WatchStore(preview: fixture, details: details)
    }
    #endif
    return WatchStore()
  }
}
