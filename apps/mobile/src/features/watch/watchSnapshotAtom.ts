import { Atom } from "effect/reactivity";

import { environmentProjects } from "../../state/projects";
import { environmentThreadDetails, environmentThreadShells } from "../../state/threads";
import {
  buildWatchSnapshot,
  isWatchFinished,
  MAX_FINISHED_WITH_CHAT,
  watchChatFromTimeline,
  watchFinishedSince,
  type WatchThreadInput,
} from "./watchSnapshot";

/**
 * Everything the watch shows, subagent tasks included so their approvals reach the watch.
 * Waiting threads and the newest finished ones open a detail stream for their chat.
 */
export const watchSnapshotInputsAtom = Atom.make((get): ReadonlyArray<WatchThreadInput> => {
  const nowIso = new Date().toISOString();
  const threads = get(environmentThreadShells.visibleThreadShellsAtom).filter(
    (thread) => thread.archivedAt === null,
  );
  const chatKeys = new Set(
    threads
      .filter((thread) => isWatchFinished(thread, nowIso))
      .sort((a, b) => watchFinishedSince(b) - watchFinishedSince(a))
      .slice(0, MAX_FINISHED_WITH_CHAT)
      .map((thread) => `${thread.environmentId}/${thread.id}`),
  );
  return threads.map((thread) => {
    const ref = { environmentId: thread.environmentId, threadId: thread.id };
    const waiting = thread.hasPendingApprovals || thread.hasPendingUserInput;
    const withChat = waiting || chatKeys.has(`${thread.environmentId}/${thread.id}`);
    const project = get(
      environmentProjects.projectAtom({
        environmentId: thread.environmentId,
        projectId: thread.projectId,
      }),
    );
    return {
      thread,
      projectTitle: project?.title ?? null,
      requests: waiting ? get(environmentThreadDetails.pendingRequestsAtom(ref)) : null,
      chat: withChat
        ? watchChatFromTimeline(get(environmentThreadDetails.visibleTurnItemsAtom(ref)))
        : null,
    };
  });
}).pipe(Atom.withLabel("watch-snapshot-inputs"));

export function readWatchSnapshot(inputs: ReadonlyArray<WatchThreadInput>) {
  return buildWatchSnapshot(inputs, Date.now());
}
