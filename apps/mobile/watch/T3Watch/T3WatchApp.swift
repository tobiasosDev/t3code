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
    if let json = ProcessInfo.processInfo.environment["T3_WATCH_FIXTURE"],
       let fixture = try? JSONDecoder().decode(WatchSnapshot.self, from: Data(json.utf8)) {
      return WatchStore(preview: fixture)
    }
    #endif
    return WatchStore()
  }
}
