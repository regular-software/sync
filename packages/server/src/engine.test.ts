import assert from "node:assert/strict";
import test from "node:test";
import Database from "better-sqlite3";
import { SyncEngine, SyncSchemaMismatchError } from "./engine";

const schemaFingerprint = '[{"name":"todos","primaryKey":"id"}]';

function request(version: number, replicaId?: string) {
  return {
    version,
    ...(replicaId ? { replicaId } : {}),
    schemaVersion: 1,
    schemaFingerprint,
  };
}

test("version zero returns rows created before trigger registration", () => {
  const db = new Database(":memory:");

  try {
    db.exec(`
      CREATE TABLE todos (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL
      );

      INSERT INTO todos (id, title)
      VALUES ('todo-1', 'Existing');
    `);

    const sync = new SyncEngine(db, { schemaVersion: 1 });
    sync.initialize();
    sync.registerTable({ name: "todos", primaryKey: "id" });

    const result = sync.syncSince(request(0));
    assert.equal(result.kind, "snapshot");
    assert.equal(result.version, 0);
    assert.equal(result.schemaVersion, 1);
    assert.equal(result.schemaFingerprint, schemaFingerprint);
    assert.deepEqual(result.rows, [
        {
          tableName: "todos",
          row: { id: "todo-1", title: "Existing" },
        },
      ]);
  } finally {
    db.close();
  }
});

test("snapshot and incremental row reads share a SQLite transaction", () => {
  const db = new Database(":memory:");

  try {
    db.function(
      "sync_transaction_state",
      { deterministic: true },
      () => (db.inTransaction ? 1 : 0),
    );
    db.exec(`
      CREATE TABLE todos (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        read_in_transaction INTEGER
          GENERATED ALWAYS AS (sync_transaction_state()) VIRTUAL
      );
    `);

    const sync = new SyncEngine(db, { schemaVersion: 1 });
    sync.initialize();
    sync.registerTable({ name: "todos", primaryKey: "id" });

    db.prepare("INSERT INTO todos (id, title) VALUES (?, ?)").run(
      "todo-1",
      "First",
    );

    const snapshot = sync.syncSince(request(0));

    assert.equal(snapshot.kind, "snapshot");
    assert.equal(snapshot.version, 1);
    assert.equal(snapshot.rows[0]?.row.read_in_transaction, 1);

    db.prepare("UPDATE todos SET title = ? WHERE id = ?").run(
      "Updated",
      "todo-1",
    );

    const incremental = sync.syncSince(
      request(snapshot.version, snapshot.replicaId),
    );

    assert.equal(incremental.kind, "incremental");

    if (incremental.kind === "incremental") {
      assert.equal(incremental.version, 2);
      assert.equal(incremental.rows[0]?.row.read_in_transaction, 1);
    }
  } finally {
    db.close();
  }
});

test("an ahead cursor receives a regressive reset snapshot", () => {
  const db = new Database(":memory:");

  try {
    db.exec("CREATE TABLE todos (id TEXT PRIMARY KEY, title TEXT NOT NULL)");
    const sync = new SyncEngine(db, { schemaVersion: 1 });
    sync.initialize();
    sync.registerTable({ name: "todos", primaryKey: "id" });
    db.prepare("INSERT INTO todos VALUES (?, ?)").run("todo-1", "Restored");
    const current = sync.syncSince(request(0));
    const reset = sync.syncSince(request(99, current.replicaId));

    assert.equal(reset.kind, "snapshot");
    if (reset.kind === "snapshot") {
      assert.equal(reset.resetReason, "cursor-ahead");
      assert.equal(reset.version, 1);
      assert.equal(reset.rows[0]?.row.title, "Restored");
    }
  } finally {
    db.close();
  }
});

test("a changed replica receives a reset snapshot", () => {
  const db = new Database(":memory:");

  try {
    db.exec("CREATE TABLE todos (id TEXT PRIMARY KEY, title TEXT NOT NULL)");
    const sync = new SyncEngine(db, { schemaVersion: 1 });
    sync.initialize();
    sync.registerTable({ name: "todos", primaryKey: "id" });
    const reset = sync.syncSince(request(1, "different-replica"));

    assert.equal(reset.kind, "snapshot");
    if (reset.kind === "snapshot") {
      assert.equal(reset.resetReason, "replica-changed");
    }
  } finally {
    db.close();
  }
});

test("replica identity survives engine recreation on the same database", () => {
  const db = new Database(":memory:");

  try {
    db.exec("CREATE TABLE todos (id TEXT PRIMARY KEY, title TEXT NOT NULL)");
    const first = new SyncEngine(db, { schemaVersion: 1 });
    first.initialize();
    first.registerTable({ name: "todos", primaryKey: "id" });
    const firstReplica = first.syncSince(request(0)).replicaId;

    const second = new SyncEngine(db, { schemaVersion: 1 });
    second.initialize();
    second.registerTable({ name: "todos", primaryKey: "id" });
    assert.equal(second.syncSince(request(0)).replicaId, firstReplica);
  } finally {
    db.close();
  }
});

test("schema mismatches fail before advancing a cursor", () => {
  const db = new Database(":memory:");

  try {
    db.exec("CREATE TABLE todos (id TEXT PRIMARY KEY, title TEXT NOT NULL)");
    const sync = new SyncEngine(db, { schemaVersion: 2 });
    sync.initialize();
    sync.registerTable({ name: "todos", primaryKey: "id" });

    assert.throws(
      () =>
        sync.syncSince({
          version: 0,
          schemaVersion: 1,
          schemaFingerprint,
        }),
      SyncSchemaMismatchError,
    );
  } finally {
    db.close();
  }
});
