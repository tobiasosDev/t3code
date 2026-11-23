import type { PendingThreadRequests } from "@t3tools/client-runtime/state/thread-requests";
import { RuntimeRequestId, ThreadId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { makeThreadShellFixture } from "../../test-fixtures";
import {
  buildWatchSnapshot,
  decodeWatchOptionId,
  watchChatFromTimeline,
  watchSnapshotKey,
} from "./watchSnapshot";

const NOW = Date.parse("2026-11-23T12:00:00.000Z");

const approvalRequests = {
  approvals: [
    {
      requestId: RuntimeRequestId.make("request-approval"),
      requestKind: "command",
      createdAt: "2026-11-23T11:55:00.000Z",
      detail: "vp run test apps/mobile",
      reason: "Will Tests ausführen",
      responseCapability: "live",
    },
  ],
  userInputs: [],
} as unknown as PendingThreadRequests;

const questionRequests = {
  approvals: [],
  userInputs: [
    {
      requestId: RuntimeRequestId.make("request-question"),
      createdAt: "2026-11-23T11:58:00.000Z",
      questions: [
        {
          id: "scope",
          header: "Scope",
          question: "Soll ich v1 auch abdecken?",
          options: [
            { label: "Ja", description: "" },
            { label: "Nein", description: "", value: "no" },
          ],
          multiSelect: false,
        },
      ],
      responseCapability: "live",
      dismissible: true,
    },
  ],
} as unknown as PendingThreadRequests;

describe("buildWatchSnapshot", () => {
  it("lists approvals and questions with their chat, oldest first", () => {
    const approvalThread = makeThreadShellFixture({
      id: ThreadId.make("thread-haptics"),
      title: "Tune the handoff haptics",
      hasPendingApprovals: true,
    });
    const questionThread = makeThreadShellFixture({
      id: ThreadId.make("thread-oom"),
      title: "Make the OOM killer explain itself",
      hasPendingUserInput: true,
    });

    const snapshot = buildWatchSnapshot(
      [
        {
          thread: questionThread,
          projectTitle: "kernel-cabin",
          requests: questionRequests,
          chat: { userMessage: "Erklär im Log, warum.", agentMessage: undefined, graphics: [] },
        },
        { thread: approvalThread, projectTitle: "t3code", requests: approvalRequests, chat: null },
      ],
      NOW,
    );

    expect(snapshot.waiting.map((item) => item.kind)).toEqual(["approval", "question"]);
    const [approval, question] = snapshot.waiting;
    expect(approval).toMatchObject({
      threadTitle: "Tune the handoff haptics",
      project: "t3code",
      requestId: "request-approval",
      title: "Will Tests ausführen",
      detail: "vp run test apps/mobile",
    });
    expect(question).toMatchObject({
      title: "Soll ich v1 auch abdecken?",
      userMessage: "Erklär im Log, warum.",
    });
    expect(question?.options?.map((option) => option.label)).toEqual(["Ja", "Nein"]);
    expect(decodeWatchOptionId(question?.options?.[1]?.id ?? "")).toEqual({
      questionId: "scope",
      value: "no",
    });
  });

  it("skips threads whose requests have not loaded yet", () => {
    const thread = makeThreadShellFixture({ hasPendingApprovals: true });
    const snapshot = buildWatchSnapshot(
      [{ thread, projectTitle: null, requests: null, chat: null }],
      NOW,
    );
    expect(snapshot.waiting).toEqual([]);
  });

  it("keeps the snapshot key stable across timestamps", () => {
    const a = buildWatchSnapshot([], NOW);
    const b = buildWatchSnapshot([], NOW + 60_000);
    expect(watchSnapshotKey(a)).toBe(watchSnapshotKey(b));
  });
});

describe("watchChatFromTimeline", () => {
  it("reads the last user message, the reply after it, and its graphics", () => {
    const chat = watchChatFromTimeline([
      { item: { type: "user_message", text: "Alte Frage" } },
      { item: { type: "assistant_message", text: "Alte Antwort" } },
      { item: { type: "user_message", text: "Erklär im Log, warum der Prozess gekillt wurde." } },
      { item: { type: "assistant_message", text: "Fallback für cgroup v2 steht." } },
    ]);
    expect(chat).toEqual({
      userMessage: "Erklär im Log, warum der Prozess gekillt wurde.",
      agentMessage: "Fallback für cgroup v2 steht.",
      graphics: [],
    });
  });
});
