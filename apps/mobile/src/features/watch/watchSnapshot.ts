import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";
import type { PendingThreadRequests } from "@t3tools/client-runtime/state/thread-requests";
import { effectiveSnoozed } from "@t3tools/client-runtime/state/thread-settled";
import { isListedThreadLineage } from "@t3tools/contracts";
import { htmlRenderFromToolItem } from "@t3tools/shared/toolOutput";
import { msg } from "gt-react-native";

import { m } from "../../i18n/messages";

import { resolveThreadListV2Status, type ThreadListV2Status } from "../threads/threadListV2";

/** Wire format for the Apple Watch app. Keep in sync with watch/T3Watch/WatchModels.swift. */
export interface WatchSnapshot {
  readonly v: 1;
  readonly generatedAt: number;
  readonly waiting: ReadonlyArray<WatchWaitingItem>;
  readonly doneToday: number;
}

export interface WatchWaitingItem {
  readonly id: string;
  /** "finished": the agent stopped and the thread is not settled; the watch offers a spoken reply. */
  readonly kind: "approval" | "question" | "finished";
  readonly environmentId: string;
  readonly threadId: string;
  readonly requestId: string;
  readonly threadTitle: string;
  readonly project?: string;
  readonly since: number;
  readonly userMessage?: string;
  readonly agentMessage?: string;
  readonly title: string;
  readonly detail?: string;
  /** Set when the watch can answer: one question it can tap or dictate an answer to. */
  readonly questionId?: string;
  /** The question takes a free-text (dictated) answer. */
  readonly allowsText?: boolean;
  readonly options?: ReadonlyArray<{ readonly id: string; readonly label: string }>;
  readonly graphics?: ReadonlyArray<{ readonly id: string; readonly title: string }>;
}

/** The parts of a thread's visible timeline the watch shows. */
export interface WatchThreadChat {
  readonly userMessage?: string;
  readonly agentMessage?: string;
  readonly graphics: ReadonlyArray<{ readonly id: string; readonly title: string }>;
}

export interface WatchThreadInput {
  readonly thread: EnvironmentThreadShell;
  readonly projectTitle: string | null;
  /** Loaded only for threads that wait on the user; null while the detail stream loads. */
  readonly requests: PendingThreadRequests | null;
  readonly chat: WatchThreadChat | null;
}

// Keeps the WatchConnectivity context well under its size limit.
const MAX_FINISHED = 20;
const MAX_TEXT = 600;
const FINISHED_STATUSES: ReadonlySet<ThreadListV2Status> = new Set([
  "ready",
  "failed",
  "limited",
  "request",
]);

/**
 * A finished thread the iPhone still lists for the user: it ran, stopped, and is neither
 * settled, snoozed nor a subagent task. Working and settled threads stay off the watch.
 */
export function isWatchFinished(thread: EnvironmentThreadShell, nowIso: string): boolean {
  if (thread.archivedAt !== null || !isListedThreadLineage(thread.lineage)) return false;
  if (thread.latestRun === null || thread.settledOverride === "settled") return false;
  if (effectiveSnoozed(thread, { now: nowIso })) return false;
  return FINISHED_STATUSES.has(resolveThreadListV2Status(thread));
}

function clip(text: string | undefined | null): string | undefined {
  const trimmed = text?.trim();
  if (!trimmed) return undefined;
  return trimmed.length > MAX_TEXT ? `${trimmed.slice(0, MAX_TEXT - 1)}…` : trimmed;
}

function toMs(iso: string | null | undefined): number {
  const ms = iso ? Date.parse(iso) : Number.NaN;
  return Number.isFinite(ms) ? ms : 0;
}

/** Option ids carry the question id so the iPhone can answer without a lookup table. */
export function encodeWatchOptionId(questionId: string, value: string): string {
  return JSON.stringify([questionId, value]);
}

export function decodeWatchOptionId(
  optionId: string,
): { readonly questionId: string; readonly value: string } | null {
  try {
    const parsed: unknown = JSON.parse(optionId);
    if (
      Array.isArray(parsed) &&
      parsed.length === 2 &&
      typeof parsed[0] === "string" &&
      typeof parsed[1] === "string"
    ) {
      return { questionId: parsed[0], value: parsed[1] };
    }
  } catch {
    // Not one of ours.
  }
  return null;
}

type TimelineRow = { readonly item: { readonly type: string } & Record<string, unknown> };

/** Reads the last user message, the agent's reply after it, and the graphics it rendered. */
export function watchChatFromTimeline(rows: ReadonlyArray<TimelineRow>): WatchThreadChat {
  let userIndex = -1;
  for (let index = rows.length - 1; index >= 0; index -= 1) {
    if (rows[index]?.item.type === "user_message") {
      userIndex = index;
      break;
    }
  }
  const userText = userIndex >= 0 ? rows[userIndex]?.item.text : undefined;
  let agentMessage: string | undefined;
  const graphics: Array<{ id: string; title: string }> = [];
  for (const row of rows.slice(userIndex + 1)) {
    const item = row.item;
    if (item.type === "assistant_message" && typeof item.text === "string" && item.text.trim()) {
      agentMessage = item.text;
    }
    if (item.type === "dynamic_tool") {
      const render = htmlRenderFromToolItem({
        toolName: typeof item.toolName === "string" ? item.toolName : null,
        output: item.output,
      });
      if (render) graphics.push({ id: render.attachmentId, title: render.title });
    }
  }
  return {
    userMessage: clip(typeof userText === "string" ? userText : undefined),
    agentMessage: clip(agentMessage),
    graphics: graphics.slice(-3),
  };
}

function base(input: WatchThreadInput) {
  const { thread } = input;
  return {
    environmentId: thread.environmentId,
    threadId: thread.id,
    threadTitle: thread.title,
    ...(input.projectTitle ? { project: input.projectTitle } : {}),
    ...(input.chat?.userMessage ? { userMessage: input.chat.userMessage } : {}),
    ...(input.chat?.agentMessage ? { agentMessage: input.chat.agentMessage } : {}),
    ...(input.chat && input.chat.graphics.length > 0 ? { graphics: input.chat.graphics } : {}),
  };
}

function waitingItems(input: WatchThreadInput): WatchWaitingItem[] {
  const { thread, requests } = input;
  if (requests === null) return [];
  const items: WatchWaitingItem[] = [];
  for (const approval of requests.approvals) {
    if (approval.responseCapability !== "live") continue;
    items.push({
      ...base(input),
      id: `${thread.environmentId}/${thread.id}/${approval.requestId}`,
      kind: "approval",
      requestId: approval.requestId,
      since: toMs(approval.createdAt),
      title: clip(approval.reason) ?? m(msg("Wants to continue")),
      ...(clip(approval.detail) ? { detail: clip(approval.detail) } : {}),
    });
  }
  for (const request of requests.userInputs) {
    if (request.responseCapability === "not_resumable") continue;
    const [question] = request.questions;
    if (!question) continue;
    const single = request.questions.length === 1 && !question.multiSelect;
    items.push({
      ...base(input),
      id: `${thread.environmentId}/${thread.id}/${request.requestId}`,
      kind: "question",
      requestId: request.requestId,
      since: toMs(request.createdAt),
      title: clip(question.question) ?? question.header,
      ...(request.questions.length === 1 &&
      (!question.multiSelect || question.allowCustomAnswer !== false)
        ? { questionId: question.id, allowsText: question.allowCustomAnswer !== false }
        : {}),
      ...(single
        ? {
            options: question.options.map((option) => ({
              id: encodeWatchOptionId(question.id, option.value ?? option.label),
              label: option.label,
            })),
          }
        : {}),
    });
  }
  return items;
}

function finishedTitle(status: ThreadListV2Status): string {
  if (status === "failed") return m(msg("Failed"));
  if (status === "limited") return m(msg("Usage limit reached"));
  if (status === "request") return m(msg("A guest is waiting"));
  return m(msg("Done"));
}

function finishedItem(input: WatchThreadInput): WatchWaitingItem {
  const { thread } = input;
  const latest = thread.source.latestVisibleMessage;
  const agentMessage =
    input.chat?.agentMessage ?? (latest?.role === "assistant" ? clip(latest.text) : undefined);
  return {
    ...base(input),
    ...(agentMessage ? { agentMessage } : {}),
    id: `${thread.environmentId}/${thread.id}/finished/${thread.latestRun?.completedAt ?? ""}`,
    kind: "finished",
    requestId: "",
    since: toMs(thread.latestRun?.completedAt ?? thread.updatedAt),
    title: finishedTitle(resolveThreadListV2Status(thread)),
  };
}

export function buildWatchSnapshot(
  inputs: ReadonlyArray<WatchThreadInput>,
  nowMs: number,
): WatchSnapshot {
  const waiting: WatchWaitingItem[] = [];
  const finished: WatchWaitingItem[] = [];
  let doneToday = 0;
  const startOfDay = new Date(nowMs);
  startOfDay.setHours(0, 0, 0, 0);
  const nowIso = new Date(nowMs).toISOString();

  for (const input of inputs) {
    const { thread } = input;
    const status = resolveThreadListV2Status(thread);
    if (status === "approval" || status === "input") {
      waiting.push(...waitingItems(input));
      continue;
    }
    if (isWatchFinished(thread, nowIso)) {
      finished.push(finishedItem(input));
    } else if (
      thread.lineage.parentThreadId === null &&
      toMs(thread.latestRun?.completedAt) >= startOfDay.getTime()
    ) {
      doneToday += 1;
    }
  }

  waiting.sort((a, b) => a.since - b.since);
  finished.sort((a, b) => b.since - a.since);
  return {
    v: 1,
    generatedAt: nowMs,
    waiting: [...waiting, ...finished.slice(0, MAX_FINISHED)],
    doneToday,
  };
}

/** Snapshots compare without their timestamp, so an unchanged state is not resent. */
export function watchSnapshotKey(snapshot: WatchSnapshot): string {
  return JSON.stringify({ ...snapshot, generatedAt: 0 });
}
