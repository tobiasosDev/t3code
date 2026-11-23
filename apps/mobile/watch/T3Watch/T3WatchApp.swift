import SwiftUI

@main
struct T3WatchApp: App {
  @StateObject private var store = WatchStore()

  var body: some Scene {
    WindowGroup {
      InboxView()
        .environmentObject(store)
    }
  }
}
