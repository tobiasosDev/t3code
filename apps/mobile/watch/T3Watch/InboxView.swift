import SwiftUI

/// Concept B1 "Liste nach Projekt": the app opens on every thread that waits for the user,
/// grouped by project with the full title. A tap opens the thread's chat.
struct InboxView: View {
  @EnvironmentObject private var store: WatchStore

  var body: some View {
    NavigationStack {
      Group {
        if store.waiting.isEmpty {
          IdleView()
        } else {
          List {
            ForEach(ProjectGroup.make(store.waiting)) { group in
              Section {
                ForEach(group.items) { item in
                  NavigationLink(value: item) {
                    ItemRow(item: item)
                  }
                }
              } header: {
                HStack {
                  Text(group.name)
                  Spacer()
                  Text("\(group.items.count)")
                }
              }
            }
          }
        }
      }
      .navigationTitle("T3 Code")
      .navigationDestination(for: WaitingItem.self) { item in
        ThreadView(item: item)
      }
      .containerBackground(Color.accentColor.gradient, for: .navigation)
    }
  }
}

/// Projects with something to answer come first; inside a project, answers before finished threads.
struct ProjectGroup: Identifiable {
  let name: String
  var items: [WaitingItem]
  var id: String { name }

  static func make(_ items: [WaitingItem]) -> [ProjectGroup] {
    let answers = items.filter(\.needsAnswer).sorted { $0.since < $1.since }
    let finished = items.filter { !$0.needsAnswer }.sorted { $0.since > $1.since }
    var groups: [ProjectGroup] = []
    for item in answers + finished {
      let name = item.project ?? "Ohne Projekt"
      if let index = groups.firstIndex(where: { $0.name == name }) {
        groups[index].items.append(item)
      } else {
        groups.append(ProjectGroup(name: name, items: [item]))
      }
    }
    return groups
  }
}

struct ItemRow: View {
  let item: WaitingItem

  var body: some View {
    HStack(alignment: .top, spacing: 8) {
      StatusIcon(item: item)
      VStack(alignment: .leading, spacing: 2) {
        Text(item.threadTitle)
          .font(.body.weight(.semibold))
        Text(meta)
          .font(.footnote)
          .foregroundStyle(.secondary)
          .lineLimit(1)
      }
    }
    .padding(.vertical, 2)
  }

  private var meta: String {
    let age = RelativeTime.short(item.since)
    return age.isEmpty ? item.statusLabel : "\(item.statusLabel) · \(age)"
  }
}

struct StatusIcon: View {
  let item: WaitingItem

  var body: some View {
    Image(systemName: symbol)
      .font(.system(size: 11, weight: .heavy))
      .foregroundStyle(foreground)
      .frame(width: 22, height: 22)
      .background(background, in: Circle())
      .padding(.top, 1)
  }

  private var symbol: String {
    switch item.kind {
    case .approval: return "hand.raised.fill"
    case .question: return "questionmark"
    case .finished:
      switch item.status {
      case "failed": return "exclamationmark"
      case "limited": return "hourglass"
      case "guest": return "person.fill"
      default: return "checkmark"
      }
    }
  }

  private var foreground: Color {
    switch item.kind {
    case .approval: return .black
    case .question: return .white
    case .finished: return item.status == "failed" ? .white : .green
    }
  }

  private var background: Color {
    switch item.kind {
    case .approval: return .orange
    case .question: return .accentColor
    case .finished: return item.status == "failed" ? .red : .white.opacity(0.14)
    }
  }
}

extension WaitingItem {
  var statusLabel: String {
    switch kind {
    case .approval: return "Freigabe"
    case .question: return "Frage"
    case .finished:
      switch status {
      case "failed": return "Fehlgeschlagen"
      case "limited": return "Limit erreicht"
      case "guest": return "Gast wartet"
      default: return "Fertig"
      }
    }
  }
}

struct IdleView: View {
  @EnvironmentObject private var store: WatchStore

  var body: some View {
    List {
      Section {
        HStack(spacing: 10) {
          Image(systemName: "checkmark.circle.fill")
            .font(.title3)
            .foregroundStyle(Color.accentColor)
          VStack(alignment: .leading, spacing: 1) {
            Text("Nichts wartet").font(.headline)
            Text(statusLine).font(.footnote).foregroundStyle(.secondary)
          }
        }
        .listRowBackground(Color.clear)
      }

      if store.snapshot.doneToday > 0 {
        Section("Fertig heute · \(store.snapshot.doneToday)") {}
      }
    }
  }

  private var statusLine: String {
    guard store.hasSnapshot else { return "Öffne T3 Code auf dem iPhone" }
    return "Stand \(RelativeTime.short(store.snapshot.generatedAt))"
  }
}

#Preview {
  InboxView().environmentObject(WatchStore())
}
