import { describe, expect, it } from "vite-plus/test";

import { buildWatchThreadDetail } from "./watchThread";

const ref = { environmentId: "env-1", threadId: "thread-oom" };
const graphic = {
  htmlRender: {
    attachmentId: "thread-oom-memory.html",
    title: "Speicher pro Prozess",
    height: 320,
  },
  message: "Rendered above your reply.",
};

describe("buildWatchThreadDetail", () => {
  it("keeps the chat in order with graphics in place and skips work items", () => {
    const detail = buildWatchThreadDetail(ref, [
      {
        item: {
          id: "u1",
          type: "user_message",
          text: "Erklär im Log, warum der Prozess gekillt wurde.",
        },
      },
      { item: { id: "r1", type: "reasoning", text: "thinking" } },
      { item: { id: "c1", type: "command_execution", command: "vp run test" } },
      { item: { id: "a1", type: "assistant_message", text: "Ich logge jetzt Grund und cgroup." } },
      {
        item: {
          id: "g1",
          type: "dynamic_tool",
          toolName: "mcp__t3-code__html_render",
          output: graphic,
        },
      },
      { item: { id: "a2", type: "assistant_message", text: "   " } },
      {
        item: {
          id: "s1",
          type: "dynamic_tool",
          toolName: "mcp__t3-code__send_to_user",
          output: { sentMessage: "Fallback für cgroup v2 steht." },
        },
      },
    ]);

    expect(detail.entries).toEqual([
      { id: "u1", role: "user", text: "Erklär im Log, warum der Prozess gekillt wurde." },
      { id: "a1", role: "agent", text: "Ich logge jetzt Grund und cgroup." },
      {
        id: "g1",
        role: "graphic",
        attachmentId: "thread-oom-memory.html",
        title: "Speicher pro Prozess",
      },
      { id: "s1", role: "agent", text: "Fallback für cgroup v2 steht." },
    ]);
    expect(detail.truncated).toBe(false);
  });

  it("never cuts an emoji in half when clipping a long message", () => {
    const text = `${"a".repeat(1_498)}😀x`;
    const detail = buildWatchThreadDetail(ref, [
      { item: { id: "a1", type: "assistant_message", text } },
    ]);
    const clipped = detail.entries[0]?.role === "agent" ? detail.entries[0].text : "";
    expect(clipped).toBe(`${"a".repeat(1_498)}…`);
    expect(JSON.stringify(detail)).not.toMatch(/\\ud83d/i);
  });

  it("drops the oldest messages to fit one WatchConnectivity reply", () => {
    const long = "ü".repeat(1_400);
    const rows = Array.from({ length: 60 }, (_, index) => ({
      item: { id: `m${index}`, type: "assistant_message", text: `${index} ${long}` },
    }));

    const detail = buildWatchThreadDetail(ref, rows);

    expect(detail.truncated).toBe(true);
    expect(detail.entries.at(-1)?.id).toBe("m59");
    expect(new TextEncoder().encode(JSON.stringify(detail)).length).toBeLessThanOrEqual(60_000);
  });
});
