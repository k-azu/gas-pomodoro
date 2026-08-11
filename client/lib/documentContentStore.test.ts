import assert from "node:assert/strict";
import test from "node:test";
import type { DocumentContentReadModel } from "./documentContentModel";
import { DocumentContentStore } from "./documentContentStoreCore";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

function committed(revision: number): DocumentContentReadModel {
  return {
    content: `server v${revision}`,
    revision,
    source: "committed",
    versionToken: `committed:${revision}`,
  };
}

test("読込中のinvalidationを破棄せず最新状態まで再読込する", async () => {
  const first = deferred<DocumentContentReadModel | null>();
  let calls = 0;
  const store = new DocumentContentStore(async () => {
    calls += 1;
    return calls === 1 ? first.promise : committed(2);
  });
  const notified: Array<DocumentContentReadModel | null> = [];
  store.subscribe("memos", "memo-1", (snapshot) => notified.push(snapshot));

  const loading = store.refresh("memos", "memo-1");
  store.invalidate("memos", "memo-1");
  store.invalidate("memos", "memo-1");
  first.resolve(committed(1));

  assert.deepEqual(await loading, committed(2));
  assert.equal(calls, 2);
  assert.deepEqual(notified, [committed(2)]);
});

test("同じversionTokenの再読込では購読者へ重複通知しない", async () => {
  const snapshot = committed(1);
  const store = new DocumentContentStore(async () => snapshot);
  let notifications = 0;
  store.subscribe("memos", "memo-1", () => {
    notifications += 1;
  });

  await store.refresh("memos", "memo-1");
  await store.refresh("memos", "memo-1");

  assert.equal(notifications, 1);
});

test("競合のremote revision更新を別versionとして通知する", async () => {
  let remoteRevision = 2;
  const store = new DocumentContentStore(async () => ({
    content: "local edit",
    revision: remoteRevision,
    source: "draft",
    versionToken: `conflict:1:${remoteRevision}`,
    conflict: {
      key: "memos:memo-1",
      content: `server v${remoteRevision}`,
      revision: remoteRevision,
      updatedAt: "",
    },
  }));
  const tokens: string[] = [];
  store.subscribe("memos", "memo-1", (snapshot) => {
    if (snapshot) tokens.push(snapshot.versionToken);
  });

  await store.refresh("memos", "memo-1");
  remoteRevision = 3;
  await store.refresh("memos", "memo-1");

  assert.deepEqual(tokens, ["conflict:1:2", "conflict:1:3"]);
});
