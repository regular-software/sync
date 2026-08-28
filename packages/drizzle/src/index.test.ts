import assert from "node:assert/strict";
import test from "node:test";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { createDrizzleSync } from "./index";

const records = sqliteTable("records", {
  id: text("id").primaryKey(),
  value: text("value").notNull(),
  count: integer("count").notNull(),
});

test("runs Drizzle writes in the sync transaction", () => {
  const sqlite = new Database(":memory:");

  try {
    sqlite.exec(
      "CREATE TABLE records (id TEXT PRIMARY KEY, value TEXT NOT NULL, count INTEGER NOT NULL)",
    );
    const db = drizzle({ client: sqlite, schema: { records } });
    const versions: number[] = [];
    const sync = createDrizzleSync({
      db,
      sqlite,
      onVersion: (version) => versions.push(version),
      schemaVersion: 1,
    });

    sync.initialize();
    sync.registerTable(records, "id");

    assert.equal(
      sync.mutate({
        id: "mutation-1",
        run: (transaction) => {
          transaction.insert(records).values({ id: "r1", value: "one", count: 1 }).run();
        },
      }),
      1,
    );
    assert.deepEqual(versions, [1]);
    assert.equal(
      sync.mutate({
        id: "mutation-1",
        run: () => {
          throw new Error("idempotent mutations must not execute twice");
        },
      }),
      1,
    );
    const schemaFingerprint = '[{"name":"records","primaryKey":"id"}]';
    assert.deepEqual(sync.syncSince({
      version: 0,
      schemaVersion: 1,
      schemaFingerprint,
    }).rows, [
      { tableName: "records", row: { id: "r1", value: "one", count: 1 } },
    ]);
  } finally {
    sqlite.close();
  }
});
