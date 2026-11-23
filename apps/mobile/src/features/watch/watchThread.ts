import { htmlRenderFromToolItem, sentMessageFromToolItem } from "@t3tools/shared/toolOutput";

import { clipWatchText } from "./watchSnapshot";

/** One line of a thread's chat on the watch. Keep in sync with watch/T3Watch/WatchModels.swift. */
export type WatchThreadEntry =
  | { readonly id: string; readonly role: "user" | "agent"; readonly text: string }
  | {
      readonly id: string;
      readonly role: "graphic";
      readonly attachmentId: string;
      readonly title: string;
    };

/** The reply to the watch's "thread" request. */
export interface WatchThreadDetail {
  readonly v: 1;
  readonly environmentId: string;
  readonly threadId: string;
  readonly entries: ReadonlyArray<WatchThreadEntry>;
  /** Older messages were left out to fit the WatchConnectivity message limit. */
  readonly truncated: boolean;
}

const MAX_ENTRIES = 40;
const MAX_ENTRY_TEXT = 1_500;
// sendMessage replies are capped at 64 KB; UTF-8 can take up to 3 bytes per UTF-16 unit.
const MAX_DETAIL_BYTES = 60_000;

type TimelineRow = {
  readonly item: { readonly id?: unknown; readonly type: string } & Record<string, unknown>;
};

function clipEntry(text: string): string {
  return clipWatchText(text.trim(), MAX_ENTRY_TEXT);
}

function entryFromRow(row: TimelineRow, index: number): WatchThreadEntry | null {
  const item = row.item;
  const id = typeof item.id === "string" ? item.id : `row-${index}`;
  if (item.type === "user_message" || item.type === "assistant_message") {
    const text = typeof item.text === "string" ? clipEntry(item.text) : "";
    if (!text) return null;
    return { id, role: item.type === "user_message" ? "user" : "agent", text };
  }
  if (item.type !== "dynamic_tool") return null;
  const tool = {
    toolName: typeof item.toolName === "string" ? item.toolName : null,
    output: item.output,
  };
  const render = htmlRenderFromToolItem(tool);
  if (render) {
    return { id, role: "graphic", attachmentId: render.attachmentId, title: render.title };
  }
  const sent = sentMessageFromToolItem(tool);
  return sent?.trim() ? { id, role: "agent", text: clipEntry(sent) } : null;
}

function utf8Bytes(text: string): number {
  let bytes = 0;
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    bytes += code < 0x80 ? 1 : code < 0x800 ? 2 : 3;
  }
  return bytes;
}

/** The newest chat messages and graphics of a thread, oldest first, sized for one watch reply. */
export function buildWatchThreadDetail(
  ref: { readonly environmentId: string; readonly threadId: string },
  rows: ReadonlyArray<TimelineRow>,
): WatchThreadDetail {
  const all: WatchThreadEntry[] = [];
  rows.forEach((row, index) => {
    const entry = entryFromRow(row, index);
    if (entry) all.push(entry);
  });
  let entries = all.slice(-MAX_ENTRIES);
  const detail = (list: ReadonlyArray<WatchThreadEntry>): WatchThreadDetail => ({
    v: 1,
    environmentId: ref.environmentId,
    threadId: ref.threadId,
    entries: list,
    truncated: list.length < all.length,
  });
  while (entries.length > 1 && utf8Bytes(JSON.stringify(detail(entries))) > MAX_DETAIL_BYTES) {
    entries = entries.slice(1);
  }
  return detail(entries);
}
