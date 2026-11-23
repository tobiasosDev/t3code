import {
  AuthOrchestrationOperateScope,
  CommandId,
  EnvironmentId,
  MessageId,
  RuntimeRequestId,
  ThreadId,
} from "@t3tools/contracts";
import { runAtomCommand } from "@t3tools/client-runtime/state/runtime";
import { requireOptionalNativeModule } from "expo";
import { AppState, Platform } from "react-native";

import { uuidv4 } from "../../lib/uuid";
import { appAtomRegistry } from "../../state/atom-registry";
import { readEnvironmentScope } from "../../state/session";
import { enqueueThreadOutboxMessage } from "../../state/thread-outbox";
import { environmentThreadDetails, threadEnvironment } from "../../state/threads";
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
  readonly text?: string;
  readonly optionId?: string;
}

interface NativeWatchBridge {
  getState(): WatchBridgeState;
  updateSnapshot(json: string): void;
  drainActions(): ReadonlyArray<WatchAction>;
  addListener(event: "action", listener: () => void): { remove(): void };
}

const PUSH_DELAY_MS = 750;
const RETRY_DELAY_MS = 5_000;
const MAX_ATTEMPTS = 4;

async function performWatchAction(action: WatchAction): Promise<boolean> {
  const environmentId = EnvironmentId.make(action.environmentId);
  const threadId = ThreadId.make(action.threadId);
  if (!readEnvironmentScope(environmentId, AuthOrchestrationOperateScope)) return false;
  const label = "Answer from Apple Watch";

  if (action.type === "approve" || action.type === "deny") {
    const result = await runAtomCommand(
      appAtomRegistry,
      threadEnvironment.respondToApproval,
      {
        environmentId,
        input: {
          threadId,
          requestId: RuntimeRequestId.make(action.requestId),
          decision: action.type === "approve" ? "accept" : "decline",
        },
      },
      { label },
    );
    return result._tag !== "Failure";
  }

  if (action.type === "answer") {
    const option = action.optionId ? decodeWatchOptionId(action.optionId) : null;
    if (!option) return true;
    const result = await runAtomCommand(
      appAtomRegistry,
      threadEnvironment.respondToUserInput,
      {
        environmentId,
        input: {
          threadId,
          requestId: RuntimeRequestId.make(action.requestId),
          answers: { [option.questionId]: option.value },
        },
      },
      { label },
    );
    return result._tag !== "Failure";
  }

  const text = action.text?.trim();
  if (!text) return true;
  // A spoken reply to a single open question answers it; anything else goes into the thread.
  const requests = action.requestId
    ? appAtomRegistry.get(environmentThreadDetails.pendingRequestsAtom({ environmentId, threadId }))
    : null;
  const userInput = requests?.userInputs.find((request) => request.requestId === action.requestId);
  const [question] = userInput?.questions ?? [];
  if (
    userInput &&
    question &&
    userInput.questions.length === 1 &&
    userInput.responseCapability === "live" &&
    question.allowCustomAnswer !== false
  ) {
    const result = await runAtomCommand(
      appAtomRegistry,
      threadEnvironment.respondToUserInput,
      {
        environmentId,
        input: { threadId, requestId: userInput.requestId, answers: { [question.id]: text } },
      },
      { label },
    );
    return result._tag !== "Failure";
  }
  await enqueueThreadOutboxMessage({
    environmentId,
    threadId,
    messageId: MessageId.make(uuidv4()),
    commandId: CommandId.make(uuidv4()),
    text,
    attachments: [],
    createdAt: new Date().toISOString(),
  });
  return true;
}

/**
 * Mirrors the threads that wait on the user to the Apple Watch app and carries out the
 * watch's answers. iOS only; a build without the watch bridge does nothing.
 */
export function installWatchConnectivity(): () => void {
  if (Platform.OS !== "ios") return () => {};
  const native = requireOptionalNativeModule<NativeWatchBridge>("T3WatchBridge");
  if (!native) return () => {};

  let disposed = false;
  let lastKey: string | null = null;
  let pushTimer: ReturnType<typeof setTimeout> | null = null;
  const retryTimers = new Set<ReturnType<typeof setTimeout>>();
  const seenActionIds = new Set<string>();

  const push = () => {
    pushTimer = null;
    if (disposed) return;
    const state = native.getState();
    if (!state.supported || !state.paired || !state.watchAppInstalled) return;
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

  const run = (action: WatchAction, attempt: number) => {
    void performWatchAction(action)
      .catch((error: unknown) => {
        console.warn("[watch] action failed", error);
        return false;
      })
      .then((done) => {
        if (done || disposed || attempt + 1 >= MAX_ATTEMPTS) return;
        const timer = setTimeout(() => {
          retryTimers.delete(timer);
          run(action, attempt + 1);
        }, RETRY_DELAY_MS);
        retryTimers.add(timer);
      });
  };
  const drain = () => {
    if (disposed) return;
    for (const action of native.drainActions()) {
      if (seenActionIds.has(action.id)) continue;
      seenActionIds.add(action.id);
      run(action, 0);
    }
  };

  const unsubscribeSnapshot = appAtomRegistry.subscribe(watchSnapshotInputsAtom, schedulePush);
  const actionSubscription = native.addListener("action", drain);
  const appStateSubscription = AppState.addEventListener("change", (next) => {
    if (next !== "active") return;
    lastKey = null;
    schedulePush();
    drain();
  });
  schedulePush();
  drain();

  return () => {
    disposed = true;
    if (pushTimer !== null) clearTimeout(pushTimer);
    for (const timer of retryTimers) clearTimeout(timer);
    unsubscribeSnapshot();
    actionSubscription.remove();
    appStateSubscription.remove();
  };
}
