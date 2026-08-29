import "fake-indexeddb/auto";

import assert from "node:assert/strict";
import test from "node:test";
import Database from "../../server/node_modules/better-sqlite3/lib/index.js";
import { createHttpPull } from "../../browser/src/browser-sync";
import { createSyncHono } from "../../hono/src/index";
import { SyncEngine } from "../../server/src/engine";
import {
  createSyncClient,
  defineTable,
  RetryableMutationError,
} from "@regular-software/sync";
import { IndexedDbSyncStore } from "./store";

type DocumentRow = { id: string; title: string };

async function waitFor(predicate: () => Promise<boolean>): Promise<void> {
  for (let index = 0; index < 100; index += 1) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
  assert.fail("Condition was not reached");
}

test("lost mutation response retries once and confirms through Hono pull", async () => {
  const sqlite = new Database(":memory:");

  try {
    sqlite.exec(
      "CREATE TABLE documents (id TEXT PRIMARY KEY, title TEXT NOT NULL)",
    );
    const engine = new SyncEngine(sqlite, { schemaVersion: 1 });
    engine.initialize();
    engine.registerTable({ name: "documents", primaryKey: "id" });
    const transport = createSyncHono({ engine, pollIntervalMs: 0 });
    const pull = createHttpPull({
      url: "http://regular-sync.test/sync",
      fetch: async (input, init) =>
        transport.app.request(new Request(input, init)),
    });
    const store = new IndexedDbSyncStore(
      `regular-sync-e2e-${crypto.randomUUID()}`,
    );
    let attempts = 0;
    let optimisticMutationId: string | undefined;
    const client = await createSyncClient({
      store,
      schemaVersion: 1,
      pull,
      retry: { initialDelayMs: 0, maximumDelayMs: 0, jitter: 0 },
    })
      .register(
        "documents",
        defineTable<DocumentRow>({ primaryKey: "id" }),
      )
      .mutation("createDocument", {
        optimistic: (document: DocumentRow, transaction, { mutationId }) => {
          optimisticMutationId = mutationId;
          transaction.put("documents", document);
        },
        execute: async (document, { mutationId }) => {
          assert.equal(mutationId, optimisticMutationId);
          attempts += 1;
          const version = engine.mutate({
            id: mutationId,
            run: () => {
              sqlite
                .prepare("INSERT INTO documents (id, title) VALUES (?, ?)")
                .run(document.id, document.title);
            },
          });

          if (attempts === 1) {
            throw new RetryableMutationError("response was interrupted");
          }

          return { version };
        },
      })
      .build();

    await client.mutations.createDocument({ id: "document-1", title: "Local" });
    assert.match(optimisticMutationId ?? "", /^[0-9a-f-]{36}$/);
    assert.deepEqual(await client.documents.getAll(), [
      { id: "document-1", title: "Local" },
    ]);
    await client.start();
    await waitFor(async () => (await store.mutations.getAll()).length === 0);

    assert.equal(attempts, 2);
    assert.equal(
      (
        sqlite
          .prepare("SELECT COUNT(*) AS count FROM documents")
          .get() as { count: number }
      ).count,
      1,
    );
    assert.deepEqual(await client.documents.getAll(), [
      { id: "document-1", title: "Local" },
    ]);
    client.stop();
    transport.stop();
  } finally {
    sqlite.close();
  }
});
