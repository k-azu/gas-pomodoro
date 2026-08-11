import { useEffect, useState, type RefObject } from "react";

export type DocumentEditLeaseStatus = "owned" | "waiting" | "unsupported";

function editLockName(documentKey: string): string {
  return `gas-pomodoro:edit:${documentKey}`;
}

function startDocumentEditLease(
  documentKey: string,
  onStatus: (status: DocumentEditLeaseStatus) => void,
  beforeAcquire: () => Promise<void>,
): (beforeRelease: () => Promise<void>) => void {
  if (!navigator.locks) {
    // A shared Active Draft is only safe when the browser can guarantee one
    // editor per document. Failing closed avoids silently overwriting another
    // tab's draft in browsers without Web Locks.
    onStatus("unsupported");
    return () => undefined;
  }

  const abortController = new AbortController();
  let release: (() => void) | undefined;
  let retryTimer: ReturnType<typeof setTimeout> | undefined;
  let owned = false;
  let stopped = false;
  onStatus("waiting");

  const holdLease = async () => {
    if (stopped) return;
    // Re-read the canonical draft and requeue pending server synchronization
    // before every acquisition. This also adopts drafts whose original retry
    // timer disappeared with another tab.
    try {
      await beforeAcquire();
    } catch (error) {
      console.error("[DocumentEditLease] Failed to prepare editing:", documentKey, error);
      onStatus("waiting");
      throw error;
    }
    if (stopped) return;
    owned = true;
    onStatus("owned");
    await new Promise<void>((resolve) => {
      release = resolve;
    });
    owned = false;
  };

  const requestLease = () => {
    if (stopped) return;
    void navigator
      .locks!.request(editLockName(documentKey), { ifAvailable: true }, async (lock) => {
        if (lock) return holdLease();
        if (stopped) return;
        return navigator.locks!.request(
          editLockName(documentKey),
          { signal: abortController.signal },
          () => holdLease(),
        );
      })
      .catch((error) => {
        if (stopped || error?.name === "AbortError") return;
        console.error("[DocumentEditLease] Failed to acquire edit lock:", documentKey, error);
        onStatus("waiting");
        if (retryTimer) clearTimeout(retryTimer);
        retryTimer = setTimeout(requestLease, 1_000);
      });
  };
  requestLease();

  return (beforeRelease) => {
    stopped = true;
    if (retryTimer) clearTimeout(retryTimer);
    if (!owned) {
      abortController.abort();
      return;
    }
    void (async () => {
      let retryDelay = 250;
      while (owned) {
        try {
          await beforeRelease();
          release?.();
          return;
        } catch {
          // A tab-private editor change must reach IndexedDB before another tab
          // can become editable. Keep the lease and retry local persistence.
          await new Promise((resolve) => setTimeout(resolve, retryDelay));
          retryDelay = Math.min(2_000, retryDelay * 2);
        }
      }
    })();
  };
}

export function useDocumentEditLease(
  documentKey: string,
  enabled: boolean,
  beforeAcquireRef: RefObject<() => Promise<void>>,
  beforeReleaseRef: RefObject<() => Promise<void>>,
): DocumentEditLeaseStatus {
  const [lease, setLease] = useState<{ key: string; status: DocumentEditLeaseStatus }>(() => ({
    key: documentKey,
    status: enabled ? "waiting" : "owned",
  }));

  useEffect(() => {
    if (!enabled || !documentKey) {
      setLease({ key: documentKey, status: "owned" });
      return;
    }
    let active = true;
    const stop = startDocumentEditLease(
      documentKey,
      (next) => {
        if (active) setLease({ key: documentKey, status: next });
      },
      () => beforeAcquireRef.current(),
    );
    return () => {
      active = false;
      stop(() => beforeReleaseRef.current());
    };
  }, [beforeAcquireRef, beforeReleaseRef, documentKey, enabled]);

  return lease.key === documentKey ? lease.status : enabled ? "waiting" : "owned";
}
