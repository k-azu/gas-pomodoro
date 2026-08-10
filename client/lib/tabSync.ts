export interface DocumentCommitMessage {
  type: "document-committed";
  sourceInstanceId: string;
  storeName: string;
  id: string;
  revision: number;
  updatedAt: string;
}

type Listener = (message: DocumentCommitMessage) => void;

interface TabIdClaimMessage {
  type: "tab-id-claim";
  tabId: string;
  instanceId: string;
  startedAt: number;
  reply: boolean;
}

type ChannelMessage = DocumentCommitMessage | TabIdClaimMessage;
type TabIdChangeListener = (oldTabId: string, newTabId: string) => void;

const CHANNEL_NAME = "gas-pomodoro-document-sync-v1";
const TAB_ID_KEY = "gas_pomodoro_tab_id";
const TAB_HEARTBEAT_PREFIX = "gas_pomodoro_tab_heartbeat_";
const TAB_LOCK_PREFIX = "gas-pomodoro:tab:";
const TAB_HEARTBEAT_INTERVAL_MS = 5_000;
const TAB_HEARTBEAT_TIMEOUT_MS = 15_000;
const listeners = new Set<Listener>();
const tabIdChangeListeners = new Set<TabIdChangeListener>();
let channel: BroadcastChannel | null | undefined;
let tabId: string | undefined;
let heartbeatTimer: ReturnType<typeof setInterval> | undefined;
let heldTabLockId: string | undefined;
let requestedTabLockId: string | undefined;
let requestedTabLockAbort: AbortController | undefined;
let releaseHeldTabLock: (() => void) | undefined;
const instanceId = crypto.randomUUID();
const startedAt = performance.timeOrigin || Date.now();

interface TabHeartbeat {
  instanceId: string;
  updatedAt: number;
}

function loadTabId(): string {
  try {
    const existing = sessionStorage.getItem(TAB_ID_KEY);
    if (existing) return existing;
  } catch {
    // Use an in-memory ID when sessionStorage is unavailable.
  }
  return crypto.randomUUID();
}

function persistTabId(id: string): void {
  try {
    sessionStorage.setItem(TAB_ID_KEY, id);
  } catch {
    // The in-memory ID remains stable for this page instance.
  }
}

function heartbeatKey(id: string): string {
  return `${TAB_HEARTBEAT_PREFIX}${id}`;
}

function tabLockName(id: string): string {
  return `${TAB_LOCK_PREFIX}${id}`;
}

function writeHeartbeat(): void {
  if (!tabId) return;
  try {
    localStorage.setItem(
      heartbeatKey(tabId),
      JSON.stringify({ instanceId, updatedAt: Date.now() } satisfies TabHeartbeat),
    );
  } catch {
    // Draft ownership is treated conservatively when localStorage is unavailable.
  }
}

function startHeartbeat(): void {
  writeHeartbeat();
  if (heartbeatTimer) return;
  heartbeatTimer = setInterval(writeHeartbeat, TAB_HEARTBEAT_INTERVAL_MS);
}

/** Whether a tab still owns its drafts. Unknown browser state is treated as active. */
export async function isTabActive(candidateTabId: string): Promise<boolean> {
  if (candidateTabId === getTabId()) return true;

  let heartbeatActive = false;
  let storageKnown = true;
  try {
    const raw = localStorage.getItem(heartbeatKey(candidateTabId));
    if (raw) {
      const heartbeat = JSON.parse(raw) as TabHeartbeat;
      heartbeatActive = Date.now() - heartbeat.updatedAt <= TAB_HEARTBEAT_TIMEOUT_MS;
    }
  } catch {
    storageKnown = false;
  }

  // Timers may be heavily throttled or stopped for background/frozen tabs.
  // A page-lifetime Web Lock remains held in those states and is therefore the
  // authoritative signal when the API is available. The heartbeat still gives
  // reloads a short grace period while the old page releases and the new page
  // reacquires the lock.
  if (navigator.locks) {
    try {
      const snapshot = await navigator.locks.query();
      if (snapshot.held?.some((lock) => lock.name === tabLockName(candidateTabId))) return true;
      return storageKnown ? heartbeatActive : true;
    } catch {
      return true;
    }
  }

  return storageKnown ? heartbeatActive : true;
}

function startTabLock(): void {
  if (!navigator.locks || !tabId) return;
  const requestedId = tabId;
  if (heldTabLockId === requestedId || requestedTabLockId === requestedId) return;
  requestedTabLockId = requestedId;
  const abortController = new AbortController();
  requestedTabLockAbort = abortController;

  void navigator.locks
    .request(tabLockName(requestedId), { signal: abortController.signal }, async () => {
      if (requestedTabLockId === requestedId) requestedTabLockId = undefined;
      if (requestedTabLockAbort === abortController) requestedTabLockAbort = undefined;
      if (tabId !== requestedId) return;

      heldTabLockId = requestedId;
      await new Promise<void>((resolve) => {
        releaseHeldTabLock = resolve;
      });
      if (heldTabLockId === requestedId) {
        heldTabLockId = undefined;
        releaseHeldTabLock = undefined;
      }
    })
    .catch(() => {
      if (requestedTabLockId === requestedId) requestedTabLockId = undefined;
      if (requestedTabLockAbort === abortController) requestedTabLockAbort = undefined;
      // Heartbeats remain as the conservative fallback.
    });
}

function postTabIdClaim(reply: boolean): void {
  if (!channel || !tabId) return;
  channel.postMessage({
    type: "tab-id-claim",
    tabId,
    instanceId,
    startedAt,
    reply,
  } satisfies TabIdClaimMessage);
}

function rotateTabId(): void {
  const oldTabId = tabId!;
  if (heldTabLockId === oldTabId) releaseHeldTabLock?.();
  if (requestedTabLockId === oldTabId) {
    requestedTabLockAbort?.abort();
    requestedTabLockId = undefined;
    requestedTabLockAbort = undefined;
  }
  // The duplicated tab may have overwritten the shared heartbeat immediately
  // before detecting the collision. Keep it until it expires or the older tab
  // refreshes it, so its drafts are not mistaken for orphaned drafts.
  tabId = crypto.randomUUID();
  persistTabId(tabId);
  writeHeartbeat();
  tabIdChangeListeners.forEach((listener) => listener(oldTabId, tabId!));
  postTabIdClaim(false);
  startTabLock();
}

export function getTabId(): string {
  if (!tabId) {
    tabId = loadTabId();
    persistTabId(tabId);
  }
  getChannel();
  return tabId;
}

function getChannel(): BroadcastChannel | null {
  if (channel !== undefined) return channel;
  if (!tabId) {
    tabId = loadTabId();
    persistTabId(tabId);
  }
  startHeartbeat();
  startTabLock();
  if (typeof BroadcastChannel === "undefined") {
    channel = null;
    return channel;
  }
  channel = new BroadcastChannel(CHANNEL_NAME);
  channel.addEventListener("message", (event: MessageEvent<ChannelMessage>) => {
    const message = event.data;
    if (!message) return;
    if (message.type === "document-committed") {
      if (message.sourceInstanceId === instanceId) return;
      listeners.forEach((listener) => listener(message));
      return;
    }
    if (
      message.type !== "tab-id-claim" ||
      message.tabId !== tabId ||
      message.instanceId === instanceId
    ) {
      return;
    }

    const currentIsNewer =
      startedAt > message.startedAt ||
      (startedAt === message.startedAt && instanceId > message.instanceId);
    if (currentIsNewer) {
      rotateTabId();
    } else if (!message.reply) {
      postTabIdClaim(true);
    }
  });
  queueMicrotask(() => postTabIdClaim(false));
  return channel;
}

// Keep the final heartbeat across reload/navigation. If the page is truly
// closed it expires shortly; if it reloads, the new page refreshes it and
// reacquires the Web Lock without another tab stealing its draft in between.
window.addEventListener("pagehide", () => writeHeartbeat());
window.addEventListener("pageshow", () => writeHeartbeat());

export function publishDocumentCommit(
  message: Omit<DocumentCommitMessage, "type" | "sourceInstanceId">,
): void {
  getChannel()?.postMessage({
    ...message,
    type: "document-committed",
    sourceInstanceId: instanceId,
  } satisfies DocumentCommitMessage);
}

export function onDocumentCommit(listener: Listener): () => void {
  listeners.add(listener);
  getChannel();
  return () => listeners.delete(listener);
}

export function onTabIdChange(listener: TabIdChangeListener): () => void {
  tabIdChangeListeners.add(listener);
  getChannel();
  return () => tabIdChangeListeners.delete(listener);
}
