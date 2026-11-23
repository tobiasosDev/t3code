import { Atom } from "effect/reactivity";

import { environmentProjects } from "../../state/projects";
import { environmentThreadDetails, steadyNavigationThreadShellsAtom } from "../../state/threads";
import { buildWatchSnapshot, watchChatFromTimeline, type WatchThreadInput } from "./watchSnapshot";

/**
 * Everything the watch shows. Only threads that wait on the user open a detail stream,
 * the same gate childThreadApprovalsAtom uses.
 */
export const watchSnapshotInputsAtom = Atom.make((get): ReadonlyArray<WatchThreadInput> =>
  get(steadyNavigationThreadShellsAtom).map((thread) => {
    const ref = { environmentId: thread.environmentId, threadId: thread.id };
    const waiting = thread.hasPendingApprovals || thread.hasPendingUserInput;
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
      chat: waiting
        ? watchChatFromTimeline(get(environmentThreadDetails.visibleTurnItemsAtom(ref)))
        : null,
    };
  }),
).pipe(Atom.withLabel("watch-snapshot-inputs"));

export function readWatchSnapshot(inputs: ReadonlyArray<WatchThreadInput>) {
  return buildWatchSnapshot(inputs, Date.now());
}
