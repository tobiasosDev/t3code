import {
  AuthOrchestrationOperateScope,
  CommandId,
  EnvironmentId,
  MessageId,
  RuntimeRequestId,
  ThreadId,
} from "@t3tools/contracts";
import { type AtomCommand, runAtomCommand } from "@t3tools/client-runtime/state/runtime";
import { requireOptionalNativeModule } from "expo";
import { AppState, Platform } from "react-native";

import { appAtomRegistry } from "../../state/atom-registry";
import { readEnvironmentScope } from "../../state/session";
import { enqueueThreadOutboxMessage } from "../../state/thread-outbox";
import { threadEnvironment } from "../../state/threads";
import { decodeWatchOptionId, watchSnapshotKey } from "./watchSnapshot";
import { readWatchSnapshot, watchSnapshotInputsAtom } from "./watchSnapshotAtom";

interface WatchBridgeState {
  readonly supported: boolean;
  readonly activated?: boolean;
  readonly paired?: boolean;
  readonly watchAppInstalled?: boolean;
}

/** What the watch sends back. Keep in sync with WatchAction in watch/T3Watch/WatchModels.swift. */
export interface WatchAction {
  readonly type: "approve" | "deny" | "answer" | "reply";
  readonly id: string;
  readonly environmentId: string;
  readonly threadId: string;
  readonly requestId: string;
  readonly questionId?: string;
  readonly text?: string;
  readonly optionId?: string;
}

interface NativeWatchBridge {
  getState(): WatchBridgeState;
  updateSnapshot(json: string): void;
  pendingActions(): ReadonlyArray<WatchAction>;
  acknowledgeActions(ids: ReadonlyArray<string>): void;
  addListener(event: "action" | "state", listener: () => void): { remove(): void };
}

const PUSH_DELAY_MS = 750;
const RETRY_DELAY_MS = 5_000;
// A request that keeps failing while its environment is connected was most likely answered elsewhere.
const MAX_FAILED_ATTEMPTS = 4;

type ActionOutcome = "done" | "retry" | "drop";

async function respond<W, A, E>(command: AtomCommand<W, A, E>, input: W): Promise<ActionOutcome> {
  const result = await runAtomCommand(appAtomRegistry, command, input, {
    label: "Answer from Apple Watch",
  });
  return result._tag === "Failure" ? "retry" : "done";
}

async function performWatchAction(action: WatchAction): Promise<ActionOutcome | "offline"> {
  const environmentId = EnvironmentId.make(action.environmentId);
  const threadId = ThreadId.make(action.threadId);
  if (!readEnvironmentScope(environmentId, AuthOrchestrationOperateScope)) return "offline";

  if (action.type === "approve" || action.type === "deny") {
    return respond(threadEnvironment.respondToApproval, {
      environmentId,
      input: {
        threadId,
        requestId: RuntimeRequestId.make(action.requestId),
        decision: action.type === "approve" ? "accept" : "decline",
      },
    });
  }

  if (action.type === "answer") {
    const option = action.optionId ? decodeWatchOptionId(action.optionId) : null;
    if (!option) return "drop";
    return respond(threadEnvironment.respondToUserInput, {
      environmentId,
      input: {
        threadId,
        requestId: RuntimeRequestId.make(action.requestId),
        answers: { [option.questionId]: option.value },
      },
    });
  }

  const text = action.text?.trim();
  if (!text) return "drop";
  if (action.requestId) {
    // A dictated answer to an open question; the watch only offers it for a single question.
    if (!action.questionId) return "drop";
    return respond(threadEnvironment.respondToUserInput, {
      environmentId,
      input: {
        threadId,
        requestId: RuntimeRequestId.make(action.requestId),
        answers: { [action.questionId]: text },
      },
    });
  }
  // The watch action id keeps a replayed reply from posting twice.
  await enqueueThreadOutboxMessage({
    environmentId,
    threadId,
    messageId: MessageId.make(action.id),
    commandId: CommandId.make(action.id),
    text,
    attachments: [],
    createdAt: new Date().toISOString(),
  });
  return "done";
}

/**
 * Mirrors the threads that wait on the user to the Apple Watch app and carries out the
 * watch's answers. iOS only, and idle until a paired watch has the app installed.
 */
export function installWatchConnectivity(): () => void {
  if (Platform.OS !== "ios") return () => {};
  const native = requireOptionalNativeModule<NativeWatchBridge>("T3WatchBridge");
  if (!native) return () => {};

  let disposed = false;
  let lastKey: string | null = null;
  let pushTimer: ReturnType<typeof setTimeout> | null = null;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  let unsubscribeSnapshot: (() => void) | null = null;
  const inFlight = new Set<string>();
  const failedAttempts = new Map<string, number>();

  const watchReady = () => {
    const state = native.getState();
    return (
      state.supported &&
      state.activated === true &&
      state.paired === true &&
      state.watchAppInstalled === true
    );
  };

  const push = () => {
    pushTimer = null;
    if (disposed || unsubscribeSnapshot === null) return;
    const snapshot = readWatchSnapshot(appAtomRegistry.get(watchSnapshotInputsAtom));
    const key = watchSnapshotKey(snapshot);
    if (key === lastKey) return;
    try {
      native.updateSnapshot(JSON.stringify(snapshot));
      lastKey = key;
    } catch (error) {
      console.warn("[watch] snapshot update failed", error);
    }
  };
  const schedulePush = () => {
    if (pushTimer !== null || disposed) return;
    pushTimer = setTimeout(push, PUSH_DELAY_MS);
  };

  const scheduleRetry = () => {
    if (retryTimer !== null || disposed) return;
    retryTimer = setTimeout(() => {
      retryTimer = null;
      drain();
    }, RETRY_DELAY_MS);
  };
  const finish = (action: WatchAction, outcome: ActionOutcome | "offline") => {
    inFlight.delete(action.id);
    if (disposed) return;
    if (outcome === "retry") {
      const attempts = (failedAttempts.get(action.id) ?? 0) + 1;
      failedAttempts.set(action.id, attempts);
      if (attempts < MAX_FAILED_ATTEMPTS) {
        scheduleRetry();
        return;
      }
    }
    if (outcome === "offline") {
      scheduleRetry();
      return;
    }
    failedAttempts.delete(action.id);
    native.acknowledgeActions([action.id]);
  };
  const drain = () => {
    if (disposed) return;
    for (const action of native.pendingActions()) {
      if (inFlight.has(action.id)) continue;
      inFlight.add(action.id);
      void performWatchAction(action)
        .catch((error: unknown): ActionOutcome => {
          console.warn("[watch] action failed", error);
          return "retry";
        })
        .then((outcome) => finish(action, outcome));
    }
  };

  // Detail streams for waiting threads stay closed unless a watch can show them.
  const sync = () => {
    if (disposed) return;
    const ready = watchReady();
    if (ready && unsubscribeSnapshot === null) {
      unsubscribeSnapshot = appAtomRegistry.subscribe(watchSnapshotInputsAtom, schedulePush);
      lastKey = null;
      schedulePush();
    } else if (!ready && unsubscribeSnapshot !== null) {
      unsubscribeSnapshot();
      unsubscribeSnapshot = null;
    }
  };

  const actionSubscription = native.addListener("action", drain);
  const stateSubscription = native.addListener("state", sync);
  const appStateSubscription = AppState.addEventListener("change", (next) => {
    if (next !== "active") return;
    lastKey = null;
    sync();
    schedulePush();
    drain();
  });
  sync();
  drain();

  return () => {
    disposed = true;
    if (pushTimer !== null) clearTimeout(pushTimer);
    if (retryTimer !== null) clearTimeout(retryTimer);
    unsubscribeSnapshot?.();
    actionSubscription.remove();
    stateSubscription.remove();
    appStateSubscription.remove();
  };
}
