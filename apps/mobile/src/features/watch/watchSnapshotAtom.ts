import { Atom } from "effect/reactivity";

import { environmentProjects } from "../../state/projects";
import { environmentThreadDetails, environmentThreadShells } from "../../state/threads";
import {
  buildWatchSnapshot,
  isWatchFinished,
  watchChatFromTimeline,
  type WatchThreadInput,
} from "./watchSnapshot";

/**
 * Everything the watch shows, subagent tasks included so their approvals reach the watch.
 * Only threads the watch lists (waiting or finished) open a detail stream for their chat.
 */
export const watchSnapshotInputsAtom = Atom.make((get): ReadonlyArray<WatchThreadInput> =>
  get(environmentThreadShells.visibleThreadShellsAtom).flatMap((thread) => {
    if (thread.archivedAt !== null) return [];
    const ref = { environmentId: thread.environmentId, threadId: thread.id };
    const waiting = thread.hasPendingApprovals || thread.hasPendingUserInput;
    const listed = waiting || isWatchFinished(thread, new Date().toISOString());
    const project = get(
      environmentProjects.projectAtom({
        environmentId: thread.environmentId,
        projectId: thread.projectId,
      }),
    );
    return [
      {
        thread,
        projectTitle: project?.title ?? null,
        requests: waiting ? get(environmentThreadDetails.pendingRequestsAtom(ref)) : null,
        chat: listed
          ? watchChatFromTimeline(get(environmentThreadDetails.visibleTurnItemsAtom(ref)))
          : null,
      },
    ];
  }),
).pipe(Atom.withLabel("watch-snapshot-inputs"));

export function readWatchSnapshot(inputs: ReadonlyArray<WatchThreadInput>) {
  return buildWatchSnapshot(inputs, Date.now());
}
