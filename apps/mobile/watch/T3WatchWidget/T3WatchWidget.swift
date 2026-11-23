import SwiftUI
import WidgetKit

/// Reads the summary the watch app leaves in the app group (see T3Watch/WatchSummary.swift).
struct WaitingEntry: TimelineEntry {
  let date: Date
  let waiting: Int
  let title: String?
  let thread: String?

  static let placeholder = WaitingEntry(date: Date(), waiting: 2, title: "Will Tests ausführen", thread: "Tune the handoff haptics")

  static func load() -> WaitingEntry {
    let defaults = groupDefaults()
    return WaitingEntry(
      date: Date(),
      waiting: defaults?.integer(forKey: "t3.watch.summary.waitingCount") ?? 0,
      title: defaults?.string(forKey: "t3.watch.summary.firstTitle"),
      thread: defaults?.string(forKey: "t3.watch.summary.firstThread")
    )
  }

  /// "<ios bundle id>.watchkitapp.widget" shares "group.<ios bundle id>".
  private static func groupDefaults() -> UserDefaults? {
    guard let bundleId = Bundle.main.bundleIdentifier,
          let range = bundleId.range(of: ".watchkitapp") else { return nil }
    return UserDefaults(suiteName: "group." + bundleId[..<range.lowerBound])
  }
}

struct WaitingProvider: TimelineProvider {
  func placeholder(in context: Context) -> WaitingEntry { .placeholder }

  func getSnapshot(in context: Context, completion: @escaping (WaitingEntry) -> Void) {
    completion(context.isPreview ? .placeholder : .load())
  }

  /// The watch app reloads the timeline whenever the iPhone sends a new snapshot.
  func getTimeline(in context: Context, completion: @escaping (Timeline<WaitingEntry>) -> Void) {
    completion(Timeline(entries: [.load()], policy: .never))
  }
}

struct WaitingWidgetView: View {
  @Environment(\.widgetFamily) private var family
  let entry: WaitingEntry

  private var tint: Color { entry.waiting > 0 ? .orange : .accentColor }

  var body: some View {
    switch family {
    case .accessoryCircular:
      ZStack {
        AccessoryWidgetBackground()
        VStack(spacing: -2) {
          Text("\(entry.waiting)")
            .font(.system(.title2, design: .rounded).weight(.bold))
            .foregroundStyle(tint)
          Text("T3")
            .font(.system(size: 10, weight: .semibold))
        }
      }
    case .accessoryCorner:
      Text("\(entry.waiting)")
        .font(.system(.title3, design: .rounded).weight(.bold))
        .foregroundStyle(tint)
        .widgetLabel(entry.waiting == 0 ? "T3 · nichts offen" : "T3 · wartet")
    case .accessoryInline:
      Text(entry.waiting == 0 ? "T3: nichts offen" : "T3: \(entry.waiting) warten")
    default:
      VStack(alignment: .leading, spacing: 1) {
        HStack(spacing: 4) {
          Circle().fill(tint).frame(width: 6, height: 6)
          Text(headline)
            .font(.headline)
            .widgetAccentable()
        }
        if entry.waiting > 0, let title = entry.title {
          Text(title).font(.footnote).lineLimit(1)
          if let thread = entry.thread {
            Text(thread).font(.footnote).foregroundStyle(.secondary).lineLimit(1)
          }
        } else {
          Text("Nichts offen")
            .font(.footnote)
            .foregroundStyle(.secondary)
        }
      }
      .frame(maxWidth: .infinity, alignment: .leading)
    }
  }

  private var headline: String {
    switch entry.waiting {
    case 0: return "T3 Code"
    case 1: return "1 wartet"
    default: return "\(entry.waiting) warten"
    }
  }
}

@main
struct T3WatchWidget: Widget {
  var body: some WidgetConfiguration {
    StaticConfiguration(kind: "T3WaitingWidget", provider: WaitingProvider()) { entry in
      WaitingWidgetView(entry: entry)
        .containerBackground(.fill.tertiary, for: .widget)
    }
    .configurationDisplayName("T3 Code")
    .description("Was auf dich wartet.")
    .supportedFamilies([.accessoryCircular, .accessoryCorner, .accessoryInline, .accessoryRectangular])
  }
}
