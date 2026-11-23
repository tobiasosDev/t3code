import SwiftUI

/// Concept A2 "Nur was dich braucht": one page per approval or question, crown pages through them.
struct InboxView: View {
  @EnvironmentObject private var store: WatchStore

  var body: some View {
    NavigationStack {
      Group {
        if store.waiting.isEmpty {
          IdleView()
        } else {
          TabView {
            ForEach(store.waiting) { item in
              WaitingCard(item: item)
            }
            // The crown's last page lists what runs, so running threads stay one turn away.
            if !store.snapshot.running.isEmpty {
              IdleView()
            }
          }
          .tabViewStyle(.verticalPage)
        }
      }
      .navigationTitle(title)
      .containerBackground(Color.accentColor.gradient, for: .navigation)
      .navigationDestination(for: RunningThread.self) { thread in
        RunningThreadView(threadId: thread.id, fallback: thread)
      }
    }
  }

  private var title: String {
    let count = store.waiting.count
    switch count {
    case 0: return "T3 Code"
    case 1: return "1 wartet"
    default: return "\(count) warten"
    }
  }
}

struct WaitingCard: View {
  @EnvironmentObject private var store: WatchStore
  let item: WaitingItem

  var body: some View {
    ScrollView {
      VStack(alignment: .leading, spacing: 6) {
        HStack {
          Text(item.threadTitle).lineLimit(1)
          Spacer(minLength: 4)
          Text(RelativeTime.short(item.since))
        }
        .font(.footnote)
        .foregroundStyle(.secondary)
        // Keeps the age clear of the page indicator.
        .padding(.trailing, 8)

        if let user = item.userMessage, !user.isEmpty {
          ChatBubble(text: user, fromUser: true)
        }
        if let agent = item.agentMessage, !agent.isEmpty, item.kind != .question || agent != item.title {
          ChatBubble(text: agent, fromUser: false)
        }

        switch item.kind {
        case .approval:
          Text(item.title)
            .font(.headline)
            .padding(.top, 2)
          if let detail = item.detail, !detail.isEmpty {
            Text(detail)
              .font(.system(.footnote, design: .monospaced))
              .padding(.horizontal, 8)
              .padding(.vertical, 6)
              .frame(maxWidth: .infinity, alignment: .leading)
              .background(.white.opacity(0.1), in: RoundedRectangle(cornerRadius: 10, style: .continuous))
          }
        case .finished:
          EmptyView()
        case .question:
          ChatBubble(text: item.title, fromUser: false)
          if item.questionId == nil {
            Text("Beantworte das auf dem iPhone.")
              .font(.footnote)
              .foregroundStyle(.secondary)
          }
          ForEach(item.options ?? []) { option in
            Button(option.label) {
              store.send(WatchAction(kind: .answer, item: item, optionId: option.id))
            }
            .buttonStyle(.glass)
            .disabled(!store.canSend)
          }
        }

        ForEach(item.graphics ?? []) { graphic in
          GraphicRow(graphic: graphic)
        }
      }
      .frame(maxWidth: .infinity, alignment: .leading)
    }
    // Round icon buttons in the native bottom bar: nothing wraps on a 49 mm screen.
    .toolbar {
      ToolbarItemGroup(placement: .bottomBar) {
        switch item.kind {
        case .approval:
          Button {
            store.send(WatchAction(kind: .deny, item: item))
          } label: {
            Image(systemName: "xmark")
          }
          .tint(.red)
          .accessibilityLabel("Ablehnen")
          .disabled(!store.canSend)
          Spacer()
          Button {
            store.send(WatchAction(kind: .approve, item: item))
          } label: {
            Image(systemName: "checkmark")
          }
          .buttonStyle(.glassProminent)
          .accessibilityLabel("Freigeben")
          .disabled(!store.canSend)
        case .question where item.questionId != nil && item.allowsText == true, .finished:
          Spacer()
          ReplyButton(item: item)
            .disabled(!store.canSend)
        case .question:
          EmptyView()
        }
      }
    }
  }
}

/// Opens the system text input (dictation first on the watch) and sends the text into the thread.
struct ReplyButton: View {
  @EnvironmentObject private var store: WatchStore
  let item: WaitingItem

  var body: some View {
    TextFieldLink(prompt: Text("Antwort an den Agent")) {
      Image(systemName: "mic.fill")
        .accessibilityLabel("Sprechen")
    } onSubmit: { text in
      let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
      guard !trimmed.isEmpty else { return }
      store.send(WatchAction(kind: .reply, item: item, text: trimmed))
    }
    .buttonStyle(.glassProminent)
  }
}

struct ChatBubble: View {
  let text: String
  let fromUser: Bool

  var body: some View {
    Text(text)
      .font(fromUser ? .footnote : .body)
      .lineLimit(fromUser ? 3 : 8)
      .padding(.horizontal, 10)
      .padding(.vertical, 7)
      .frame(maxWidth: .infinity, alignment: .leading)
      .background(
        fromUser ? AnyShapeStyle(Color.accentColor.opacity(0.85)) : AnyShapeStyle(.white.opacity(0.11)),
        in: RoundedRectangle(cornerRadius: 14, style: .continuous)
      )
      .padding(.leading, fromUser ? 16 : 0)
  }
}

/// watchOS has no web view, so a rendered HTML graphic shows as a card that points to the iPhone.
struct GraphicRow: View {
  let graphic: Graphic

  var body: some View {
    HStack(spacing: 8) {
      Image(systemName: "chart.bar.xaxis")
        .foregroundStyle(Color.accentColor)
      VStack(alignment: .leading, spacing: 1) {
        Text(graphic.title).font(.footnote).lineLimit(2)
        Text("Grafik auf dem iPhone").font(.caption2).foregroundStyle(.secondary)
      }
    }
    .padding(8)
    .frame(maxWidth: .infinity, alignment: .leading)
    .background(.white.opacity(0.11), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
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
            Text(store.waiting.isEmpty ? "Nichts wartet" : "Läuft gerade").font(.headline)
            Text(statusLine).font(.footnote).foregroundStyle(.secondary)
          }
        }
        .listRowBackground(Color.clear)
      }

      if !store.snapshot.running.isEmpty {
        Section("Läuft · \(store.snapshot.running.count)") {
          ForEach(store.snapshot.running) { thread in
            NavigationLink(value: thread) {
              VStack(alignment: .leading, spacing: 1) {
                Text(thread.title).font(.body.weight(.semibold)).lineLimit(2)
                Text([thread.project, RelativeTime.short(thread.since)].compactMap { $0 }.joined(separator: " · "))
                  .font(.footnote)
                  .foregroundStyle(.secondary)
              }
            }
          }
        }
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

/// A running thread: its latest chat, live while the iPhone sends snapshots, and a spoken reply.
struct RunningThreadView: View {
  @EnvironmentObject private var store: WatchStore
  let threadId: String
  let fallback: RunningThread

  private var thread: RunningThread {
    store.snapshot.running.first { $0.id == threadId } ?? fallback
  }

  private var stillRunning: Bool {
    store.snapshot.running.contains { $0.id == threadId }
  }

  var body: some View {
    ScrollView {
      VStack(alignment: .leading, spacing: 6) {
        Text(thread.title)
          .font(.headline)
          .lineLimit(3)
        if let user = thread.userMessage, !user.isEmpty {
          ChatBubble(text: user, fromUser: true)
        }
        if let agent = thread.agentMessage, !agent.isEmpty {
          ChatBubble(text: agent, fromUser: false)
        }
        HStack(spacing: 6) {
          if stillRunning {
            ProgressView().frame(width: 16, height: 16)
            Text("Agent arbeitet · \(RelativeTime.short(thread.since))")
          } else {
            Image(systemName: "checkmark.circle.fill").foregroundStyle(Color.accentColor)
            Text("Fertig")
          }
        }
        .font(.footnote)
        .foregroundStyle(.secondary)
        .padding(.top, 2)
      }
      .frame(maxWidth: .infinity, alignment: .leading)
    }
    .navigationTitle(thread.project ?? "Thread")
    .containerBackground(Color.accentColor.gradient, for: .navigation)
    .toolbar {
      ToolbarItemGroup(placement: .bottomBar) {
        Spacer()
        ReplyButton(item: thread.replyTarget)
          .disabled(!store.canSend)
      }
    }
  }
}

#Preview {
  InboxView().environmentObject(WatchStore())
}
