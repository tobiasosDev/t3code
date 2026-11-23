import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import {
  htmlRenderFileName,
  htmlRenderTheme,
  htmlRenderThemeFragment,
} from "@t3tools/shared/htmlRender";
import { Option } from "effect";

import { DEFAULT_MOBILE_THEME_ID, getMobileThemeColors, nativeColors } from "../../lib/mobileTheme";
import { refreshAssetUrl } from "../../state/assets";
import { appAtomRegistry } from "../../state/atom-registry";
import { environmentThreadDetails, environmentThreads } from "../../state/threads";
import { buildWatchThreadDetail } from "./watchThread";

/** The watch asks for a thread's chat. Keep in sync with WatchStore.requestThread. */
export interface WatchThreadRequest {
  readonly requestId: string;
  readonly environmentId: string;
  readonly threadId: string;
  /** Graphics the watch already has cached. */
  readonly have?: ReadonlyArray<string>;
}

export interface WatchThreadResponder {
  respondToRequest(requestId: string, json: string): void;
  sendGraphic(url: string, attachmentId: string): Promise<boolean>;
}

// The watch gives up after 25 s; a thread that is not loaded by then has no chat to show.
const LOAD_TIMEOUT_MS = 10_000;

/** Graphics render dark on the watch's black screen. */
const WATCH_GRAPHIC_FRAGMENT = htmlRenderThemeFragment(
  htmlRenderTheme(
    { ...nativeColors(getMobileThemeColors(DEFAULT_MOBILE_THEME_ID, "dark")), canvas: "#000000" },
    "dark",
  ),
);

function waitForThread(ref: {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
}): Promise<boolean> {
  const stateAtom = environmentThreadDetails.stateAtom(ref);
  const loaded = () => Option.isSome(appAtomRegistry.get(stateAtom).data);
  return new Promise((resolve) => {
    if (loaded()) {
      resolve(true);
      return;
    }
    let unsubscribe = () => {};
    const timer = setTimeout(() => {
      unsubscribe();
      resolve(false);
    }, LOAD_TIMEOUT_MS);
    unsubscribe = appAtomRegistry.subscribe(stateAtom, () => {
      if (!loaded()) return;
      clearTimeout(timer);
      unsubscribe();
      resolve(true);
    });
  });
}

/** Loads the thread, replies with its chat, then renders the graphics the watch is missing. */
export async function answerWatchThreadRequest(
  native: WatchThreadResponder,
  request: WatchThreadRequest,
): Promise<void> {
  const ref = {
    environmentId: EnvironmentId.make(request.environmentId),
    threadId: ThreadId.make(request.threadId),
  };
  const release = appAtomRegistry.mount(
    environmentThreads.stateAtom(ref.environmentId, ref.threadId),
  );
  try {
    if (!(await waitForThread(ref))) {
      // No entries: the watch keeps the chat it already has.
      native.respondToRequest(request.requestId, JSON.stringify({ v: 1, error: "not_loaded" }));
      return;
    }
    const detail = buildWatchThreadDetail(
      request,
      appAtomRegistry.get(environmentThreadDetails.visibleTurnItemsAtom(ref)),
    );
    native.respondToRequest(request.requestId, JSON.stringify(detail));

    const have = new Set(request.have ?? []);
    const graphics = detail.entries
      .flatMap((entry) => (entry.role === "graphic" ? [entry] : []))
      .filter((entry) => !have.has(entry.attachmentId))
      .reverse();
    for (const graphic of graphics) {
      const url = await refreshAssetUrl(ref.environmentId, {
        _tag: "attachment",
        attachmentId: graphic.attachmentId,
        fileName: htmlRenderFileName(graphic.title),
        mimeType: "text/html",
        disposition: "inline",
      }).catch(() => null);
      if (url === null) continue;
      await native.sendGraphic(url + WATCH_GRAPHIC_FRAGMENT, graphic.attachmentId);
    }
  } finally {
    release();
  }
}
