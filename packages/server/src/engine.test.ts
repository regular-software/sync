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
      assert.equal(incremental.packets[0]?.row?.read_in_transaction, 1);
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

test("one mutation shares one version across changed rows", () => {
  const db = new Database(":memory:");
  try {
    db.exec("CREATE TABLE todos (id TEXT PRIMARY KEY, title TEXT NOT NULL)");
    const sync = new SyncEngine(db, { schemaVersion: 1 });
    sync.initialize();
    sync.registerTable({ name: "todos", primaryKey: "id" });
    const version = sync.mutate({
      id: "m1",
      run: () => {
        db.prepare("INSERT INTO todos VALUES (?, ?)").run("1", "one");
        db.prepare("INSERT INTO todos VALUES (?, ?)").run("2", "two");
      },
    });
    assert.equal(version, 1);
    const result = sync.syncSince(request(0));
    assert.equal(result.version, 1);
    assert.equal(result.kind, "snapshot");
    const incremental = sync.syncSince(request(1, result.replicaId));
    assert.equal(incremental.kind, "incremental");
  } finally {
    db.close();
  }
});

test("auditHook runs before commit and rolls back data", () => {
  const db = new Database(":memory:");
  try {
    db.exec("CREATE TABLE todos (id TEXT PRIMARY KEY, title TEXT NOT NULL)");
    const sync = new SyncEngine(db, { schemaVersion: 1 });
    sync.initialize();
    sync.registerTable({ name: "todos", primaryKey: "id" });
    assert.throws(() => sync.mutate({
      id: "m1",
      run: () => db.prepare("INSERT INTO todos VALUES (?, ?)").run("1", "one"),
      auditHook: (version) => {
        assert.equal(version, 1);
        assert.equal((db.prepare("SELECT COUNT(*) AS count FROM todos").get() as { count: number }).count, 1);
        throw new Error("audit failed");
      },
    }), /audit failed/);
    assert.equal((db.prepare("SELECT COUNT(*) AS count FROM todos").get() as { count: number }).count, 0);
    assert.equal(sync.getVersion(), 0);
  } finally {
    db.close();
  }
});

test("compaction preserves boundary version and expires older cursors", () => {
  const db = new Database(":memory:");
  try {
    db.exec("CREATE TABLE todos (id TEXT PRIMARY KEY, title TEXT NOT NULL)");
    const sync = new SyncEngine(db, { schemaVersion: 1 });
    sync.initialize();
    sync.registerTable({ name: "todos", primaryKey: "id" });
    for (let index = 1; index <= 3; index += 1) {
      sync.mutate({ id: `m${index}`, run: () => db.prepare("INSERT OR REPLACE INTO todos VALUES (?, ?)").run(String(index), String(index)) });
    }
    sync.compactChanges(2);
    const identity = sync.syncSince(request(0));
    assert.equal(identity.kind, "snapshot");
    const atBoundary = sync.syncSince(request(1, identity.replicaId));
    assert.equal(atBoundary.kind, "incremental");
    if (atBoundary.kind === "incremental") assert.deepEqual(atBoundary.packets.map((packet) => packet.version), [2, 3]);
    const afterBoundary = sync.syncSince(request(2, identity.replicaId));
    assert.equal(afterBoundary.kind, "incremental");
    if (afterBoundary.kind === "incremental") assert.deepEqual(afterBoundary.packets.map((packet) => packet.version), [3]);
    const beforeBoundary = sync.syncSince(request(0, identity.replicaId));
    assert.equal(beforeBoundary.kind, "snapshot");
    if (beforeBoundary.kind === "snapshot") assert.equal(beforeBoundary.resetReason, "cursor-expired");
  } finally {
    db.close();
  }
});

test("filtered deletes use previous row visibility", () => {
  const db = new Database(":memory:");
  try {
    db.exec("CREATE TABLE todos (id TEXT PRIMARY KEY, owner TEXT NOT NULL, title TEXT NOT NULL)");
    const sync = new SyncEngine(db, {
      schemaVersion: 1,
      filters: () => ({ todos: [{ column: "owner", operator: "=", value: "alice" }] }),
    });
    sync.initialize();
    sync.registerTable({ name: "todos", primaryKey: "id" });
    sync.mutate({ id: "m1", run: () => db.prepare("INSERT INTO todos VALUES (?, ?, ?)").run("1", "alice", "visible") });
    const snapshot = sync.syncSince(request(0));
    assert.equal(snapshot.kind, "snapshot");
    sync.mutate({ id: "m2", run: () => db.prepare("DELETE FROM todos WHERE id = ?").run("1") });
    const visibleDelete = sync.syncSince(request(1, snapshot.replicaId));
    assert.equal(visibleDelete.kind, "incremental");
    if (visibleDelete.kind === "incremental") assert.deepEqual(visibleDelete.packets.map((packet) => packet.operation), ["delete"]);

    sync.mutate({ id: "m3", run: () => db.prepare("INSERT INTO todos VALUES (?, ?, ?)").run("2", "bob", "hidden") });
    const hiddenSnapshot = sync.syncSince(request(2, snapshot.replicaId));
    assert.equal(hiddenSnapshot.kind, "incremental");
    sync.mutate({ id: "m4", run: () => db.prepare("DELETE FROM todos WHERE id = ?").run("2") });
    const hiddenDelete = sync.syncSince(request(3, snapshot.replicaId));
    assert.equal(hiddenDelete.kind, "incremental");
    if (hiddenDelete.kind === "incremental") assert.deepEqual(hiddenDelete.packets, []);
  } finally {
    db.close();
  }
});

test("filtered scope transitions emit only visible changes", () => {
  const db = new Database(":memory:");
  try {
    db.exec("CREATE TABLE todos (id TEXT PRIMARY KEY, owner TEXT NOT NULL, title TEXT NOT NULL)");
    const sync = new SyncEngine(db, {
      schemaVersion: 1,
      filters: () => ({ todos: [{ column: "owner", operator: "=", value: "alice" }] }),
    });
    sync.initialize();
    sync.registerTable({ name: "todos", primaryKey: "id" });
    sync.mutate({ id: "m1", run: () => db.prepare("INSERT INTO todos VALUES (?, ?, ?)").run("1", "bob", "hidden") });
    const start = sync.syncSince(request(0));
    sync.mutate({ id: "m2", run: () => db.prepare("UPDATE todos SET owner = ? WHERE id = ?").run("alice", "1") });
    const enters = sync.syncSince(request(1, start.replicaId));
    assert.equal(enters.kind, "incremental");
    if (enters.kind === "incremental") assert.equal(enters.packets[0]?.operation, "update");
    sync.mutate({ id: "m3", run: () => db.prepare("UPDATE todos SET title = ? WHERE id = ?").run("changed", "1") });
    const stays = sync.syncSince(request(2, start.replicaId));
    assert.equal(stays.kind, "incremental");
    if (stays.kind === "incremental") assert.equal(stays.packets[0]?.operation, "update");
    sync.mutate({ id: "m4", run: () => db.prepare("UPDATE todos SET owner = ? WHERE id = ?").run("bob", "1") });
    const leaves = sync.syncSince(request(3, start.replicaId));
    assert.equal(leaves.kind, "incremental");
    if (leaves.kind === "incremental") assert.equal(leaves.packets[0]?.operation, "delete");
  } finally {
    db.close();
  }
});
