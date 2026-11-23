import SwiftUI

/// One thread: project and full title, the chat with its graphics, and what waits on the user.
struct ThreadView: View {
  @EnvironmentObject private var store: WatchStore
  @Environment(\.dismiss) private var dismiss
  let item: WaitingItem
  @State private var jumpedToDetail = false

  private var detail: ThreadDetail? { store.details[item.threadKey] }

  /// Until the iPhone answers, the snapshot's last exchange stands in for the chat.
  private var entries: [ThreadEntry] {
    if let detail { return detail.entries }
    var list: [ThreadEntry] = []
    if let user = item.userMessage { list.append(ThreadEntry(id: "snapshot-user", role: .user, text: user)) }
    if let agent = item.agentMessage { list.append(ThreadEntry(id: "snapshot-agent", role: .agent, text: agent)) }
    for graphic in item.graphics ?? [] {
      list.append(ThreadEntry(id: "snapshot-\(graphic.id)", role: .graphic, attachmentId: graphic.id, title: graphic.title))
    }
    return list
  }

  var body: some View {
    ScrollViewReader { proxy in
      ScrollView {
        VStack(alignment: .leading, spacing: 6) {
          // The project is the navigation title; the full thread title opens the chat.
          Text(item.threadTitle)
            .font(.headline)
            .padding(.horizontal, 4)
            .padding(.bottom, 2)

          if detail?.truncated == true {
            Text("Ältere am iPhone")
              .font(.caption2)
              .foregroundStyle(.secondary)
              .frame(maxWidth: .infinity)
          }

          ForEach(entries) { entry in
            EntryView(entry: entry).id(entry.id)
          }

          if detail == nil {
            LoadNote(loading: store.loadingThreads.contains(item.threadKey), reachable: store.phoneReachable)
          }

          ActionSection(item: item, onSent: { dismiss() })
            .id("action")
        }
        .frame(maxWidth: .infinity, alignment: .leading)
      }
      .onAppear {
        store.requestThread(item)
        jump(proxy)
      }
      // Opened offline or before the session was up: load once the iPhone can answer.
      .onChange(of: store.canSend && store.phoneReachable) { _, ready in
        if ready { store.requestThread(item) }
      }
      .onChange(of: detail) {
        guard !jumpedToDetail else { return }
        jumpedToDetail = true
        jump(proxy)
      }
    }
    .navigationTitle(item.project ?? "")
    .toolbar {
      ToolbarItemGroup(placement: .bottomBar) {
        switch item.kind {
        case .approval:
          Button {
            store.send(WatchAction(kind: .deny, item: item))
            dismiss()
          } label: {
            Image(systemName: "xmark")
          }
          .tint(.red)
          .accessibilityLabel("Ablehnen")
          .disabled(!store.canSend)
          Spacer()
          Button {
            store.send(WatchAction(kind: .approve, item: item))
            dismiss()
          } label: {
            Image(systemName: "checkmark")
          }
          .buttonStyle(.glassProminent)
          .accessibilityLabel("Freigeben")
          .disabled(!store.canSend)
        case .question where item.questionId != nil && item.allowsText == true, .finished:
          Spacer()
          ReplyButton(item: item, onSent: { dismiss() })
            .disabled(!store.canSend)
        case .question:
          EmptyView()
        }
      }
    }
  }

  /// Opens at the user's last message: what they asked, what came back, and what waits now.
  private func jump(_ proxy: ScrollViewProxy) {
    guard let last = entries.last(where: { $0.role == .user }) else { return }
    DispatchQueue.main.async { proxy.scrollTo(last.id, anchor: .top) }
  }
}

struct EntryView: View {
  let entry: ThreadEntry

  var body: some View {
    switch entry.role {
    case .user:
      ChatBubble(text: entry.text ?? "", fromUser: true)
    case .agent:
      ChatBubble(text: entry.text ?? "", fromUser: false)
    case .graphic:
      GraphicEntry(attachmentId: entry.attachmentId ?? "", title: entry.title ?? "Grafik")
    }
  }
}

struct LoadNote: View {
  let loading: Bool
  let reachable: Bool

  var body: some View {
    HStack(spacing: 6) {
      if loading { ProgressView().frame(width: 18, height: 18) }
      Text(loading ? "Lädt den Chat" : reachable ? "Chat nicht geladen" : "iPhone nicht erreichbar")
        .font(.caption2)
        .foregroundStyle(.secondary)
    }
    .frame(maxWidth: .infinity, alignment: .leading)
    .padding(.horizontal, 4)
    .padding(.vertical, 2)
  }
}

/// What waits on the user, at the end of the chat. The buttons sit in the bottom bar.
struct ActionSection: View {
  @EnvironmentObject private var store: WatchStore
  let item: WaitingItem
  let onSent: () -> Void

  var body: some View {
    switch item.kind {
    case .approval:
      VStack(alignment: .leading, spacing: 6) {
        Text(item.title).font(.headline)
        if let detail = item.detail, !detail.isEmpty {
          Text(detail)
            .font(.system(.footnote, design: .monospaced))
            .padding(.horizontal, 8)
            .padding(.vertical, 6)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(.white.opacity(0.1), in: RoundedRectangle(cornerRadius: 10, style: .continuous))
        }
      }
      .padding(.top, 4)
    case .question:
      VStack(alignment: .leading, spacing: 6) {
        Text(item.title).font(.headline).padding(.horizontal, 4)
        if item.questionId == nil {
          Text("Beantworte das auf dem iPhone.")
            .font(.footnote)
            .foregroundStyle(.secondary)
        }
        ForEach(item.options ?? []) { option in
          Button(option.label) {
            store.send(WatchAction(kind: .answer, item: item, optionId: option.id))
            onSent()
          }
          .buttonStyle(.glass)
          .disabled(!store.canSend)
        }
      }
      .padding(.top, 4)
    case .finished:
      Text("\(item.statusLabel) · \(RelativeTime.short(item.since))")
        .font(.footnote)
        .foregroundStyle(.secondary)
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, 4)
        .padding(.top, 2)
    }
  }
}

/// Opens the system text input (dictation first on the watch) and sends the text into the thread.
struct ReplyButton: View {
  @EnvironmentObject private var store: WatchStore
  let item: WaitingItem
  let onSent: () -> Void

  var body: some View {
    TextFieldLink(prompt: Text("Antwort an den Agent")) {
      Image(systemName: "mic.fill")
        .accessibilityLabel("Sprechen")
    } onSubmit: { text in
      let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
      guard !trimmed.isEmpty else { return }
      store.send(WatchAction(kind: .reply, item: item, text: trimmed))
      onSent()
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

/// A graphic the agent rendered, as the image the iPhone sent. Tap to zoom.
struct GraphicEntry: View {
  @EnvironmentObject private var store: WatchStore
  let attachmentId: String
  let title: String

  var body: some View {
    // Re-read the cache whenever a file arrives.
    let _ = store.graphicsVersion
    if let image = UIImage(contentsOfFile: WatchGraphics.url(for: attachmentId).path) {
      NavigationLink {
        GraphicZoomView(image: image, title: title)
      } label: {
        VStack(alignment: .leading, spacing: 3) {
          Image(uiImage: image)
            .resizable()
            .scaledToFit()
            .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
          Text(title).font(.footnote).lineLimit(2).padding(.horizontal, 4)
        }
      }
      .buttonStyle(.plain)
      .accessibilityLabel(title)
    } else {
      HStack(spacing: 8) {
        Image(systemName: "chart.bar.xaxis")
          .foregroundStyle(Color.accentColor)
        VStack(alignment: .leading, spacing: 1) {
          Text(title).font(.footnote).lineLimit(2)
          Text(store.phoneReachable ? "Grafik lädt vom iPhone" : "Kommt, sobald das iPhone erreichbar ist")
            .font(.caption2)
            .foregroundStyle(.secondary)
        }
      }
      .padding(8)
      .frame(maxWidth: .infinity, alignment: .leading)
      .background(.white.opacity(0.11), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
    }
  }
}

/// Full screen graphic: the crown zooms, a finger pans.
struct GraphicZoomView: View {
  let image: UIImage
  let title: String
  @State private var zoom = 1.0

  var body: some View {
    GeometryReader { geometry in
      ScrollView([.horizontal, .vertical]) {
        Image(uiImage: image)
          .resizable()
          .scaledToFit()
          .frame(width: geometry.size.width * zoom)
      }
    }
    .focusable()
    .digitalCrownRotation($zoom, from: 1, through: 3, by: 0.1, sensitivity: .low, isContinuous: false, isHapticFeedbackEnabled: true)
    .accessibilityLabel(title)
  }
}
