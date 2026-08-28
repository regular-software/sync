import Database from "better-sqlite3";
import { getChangesSince } from "./change-log";

import type {
  DeletedRow,
  JsonValue,
  SyncedRow,
  SyncResult,
  SyncRequest,
  SyncResetReason,
  SyncTable,
} from "@regular-software/sync-protocol";
import { createSyncSchemaFingerprint } from "@regular-software/sync-protocol";

import type { Mutation } from "./types";

export class SyncEngine {
  private tables = new Map<string, SyncTable>();

  constructor(
    private db: Database.Database,
    private options: { schemaVersion: number },
  ) {
    if (
      !Number.isSafeInteger(options.schemaVersion) ||
      options.schemaVersion <= 0
    ) {
      throw new Error("schemaVersion must be a positive safe integer");
    }
  }

  private installChangeTriggers(table: SyncTable) {
    const tableName = table.name;
    const primaryKey = table.primaryKey;

    this.db.exec(`
    CREATE TRIGGER IF NOT EXISTS rs_${tableName}_insert
    AFTER INSERT ON ${tableName}
    BEGIN
      INSERT INTO rs_changes (
        table_name,
        row_id,
        operation
      )
      VALUES (
        '${tableName}',
        NEW.${primaryKey},
        'insert'
      );
    END;

    CREATE TRIGGER IF NOT EXISTS rs_${tableName}_update
    AFTER UPDATE ON ${tableName}
    BEGIN
      INSERT INTO rs_changes (
        table_name,
        row_id,
        operation
      )
      VALUES (
        '${tableName}',
        NEW.${primaryKey},
        'update'
      );
    END;

    CREATE TRIGGER IF NOT EXISTS rs_${tableName}_delete
    AFTER DELETE ON ${tableName}
    BEGIN
      INSERT INTO rs_changes (
        table_name,
        row_id,
        operation
      )
      VALUES (
        '${tableName}',
        OLD.${primaryKey},
        'delete'
      );
    END;
  `);
  }

  initialize() {
    this.db.exec(`
    CREATE TABLE IF NOT EXISTS rs_changes (
      version INTEGER PRIMARY KEY AUTOINCREMENT,
      table_name TEXT NOT NULL,
      row_id TEXT NOT NULL,
      operation TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS rs_applied_mutations (
      id TEXT PRIMARY KEY,
      applied_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS rs_sync_state (
      singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
      replica_id TEXT NOT NULL
    );
  `);

    this.db
      .prepare(
        `
        INSERT OR IGNORE INTO rs_sync_state (singleton, replica_id)
        VALUES (1, ?)
        `,
      )
      .run(crypto.randomUUID());
  }

  registerTable(table: SyncTable) {
    this.tables.set(table.name, table);

    this.installChangeTriggers(table);
  }

  getVersion(): number {
    const row = this.db
      .prepare(
        `
      SELECT COALESCE(MAX(version), 0) AS version
      FROM rs_changes
    `,
      )
      .get() as { version: number };

    return row.version;
  }

  mutate(mutation: Mutation): number {
    const transaction = this.db.transaction(() => {
      const existing = this.db
        .prepare(
          `
        SELECT 1
        FROM rs_applied_mutations
        WHERE id = ?
        `,
        )
        .get(mutation.id);

      if (existing) {
        return;
      }

      mutation.run();

      this.db
        .prepare(
          `
        INSERT INTO rs_applied_mutations (
          id,
          applied_at
        )
        VALUES (?, ?)
        `,
        )
        .run(mutation.id, Date.now());
    });

    transaction();

    return this.getVersion();
  }

  syncSince(request: SyncRequest): SyncResult {
    if (
      !Number.isSafeInteger(request.version) ||
      request.version < 0 ||
      !Number.isSafeInteger(request.schemaVersion) ||
      request.schemaVersion <= 0 ||
      typeof request.schemaFingerprint !== "string" ||
      (request.replicaId !== undefined && typeof request.replicaId !== "string")
    ) {
      throw new Error("Invalid synchronization request");
    }

    const read = this.db.transaction((syncRequest: SyncRequest) => {
      const identity = this.getIdentity();

      if (
        syncRequest.schemaVersion !== identity.schemaVersion ||
        syncRequest.schemaFingerprint !== identity.schemaFingerprint
      ) {
        throw new SyncSchemaMismatchError(identity);
      }

      const currentVersion = this.getVersion();

      if (
        syncRequest.replicaId !== undefined &&
        syncRequest.replicaId !== identity.replicaId
      ) {
        return this.readSnapshot(identity, "replica-changed");
      }

      if (syncRequest.version > currentVersion) {
        return this.readSnapshot(identity, "cursor-ahead");
      }

      if (syncRequest.version === 0) {
        return this.readSnapshot(identity);
      }

      return this.readIncremental(syncRequest.version, identity);
    });

    return read(request);
  }

  private getIdentity() {
    const row = this.db
      .prepare("SELECT replica_id AS replicaId FROM rs_sync_state WHERE singleton = 1")
      .get() as { replicaId: string };

    return {
      replicaId: row.replicaId,
      schemaVersion: this.options.schemaVersion,
      schemaFingerprint: createSyncSchemaFingerprint([...this.tables.values()]),
    };
  }

  private readSnapshot(
    identity: ReturnType<SyncEngine["getIdentity"]>,
    resetReason?: SyncResetReason,
  ): SyncResult {
    const version = this.getVersion();
    const rows: SyncedRow[] = [];

    for (const table of this.tables.values()) {
      const tableRows = this.db
        .prepare(
          `
          SELECT *
          FROM ${table.name}
        `,
        )
        .all() as Record<string, JsonValue>[];

      for (const row of tableRows) {
        rows.push({ tableName: table.name, row });
      }
    }

    return {
      kind: "snapshot",
      version,
      ...identity,
      ...(resetReason ? { resetReason } : {}),
      rows,
    };
  }

  private readIncremental(
    version: number,
    identity: ReturnType<SyncEngine["getIdentity"]>,
  ): SyncResult {
    const changes = getChangesSince(this.db, version);

    const latestVersion = changes.at(-1)?.version ?? version;

    const changedRows = new Map<string, { tableName: string; rowId: string }>();

    for (const change of changes) {
      changedRows.set(`${change.tableName}:${change.rowId}`, {
        tableName: change.tableName,
        rowId: change.rowId,
      });
    }

    const rows: SyncedRow[] = [];
    const deleted: DeletedRow[] = [];

    for (const { tableName, rowId } of changedRows.values()) {
      const table = this.tables.get(tableName);

      if (!table) {
        continue;
      }

      const row = this.db
        .prepare(
          `
          SELECT *
          FROM ${table.name}
          WHERE ${table.primaryKey} = ?
        `,
        )
        .get(rowId) as Record<string, JsonValue> | undefined;

      if (row) {
        rows.push({ tableName, row });
      } else {
        deleted.push({ tableName, rowId });
      }
    }

    return {
      kind: "incremental",
      version: latestVersion,
      ...identity,
      rows,
      deleted,
    };
  }
}

export class SyncSchemaMismatchError extends Error {
  readonly status = 409;

  constructor(
    readonly expected: {
      replicaId: string;
      schemaVersion: number;
      schemaFingerprint: string;
    },
  ) {
    super("Client and server synchronization schemas do not match");
    this.name = "SyncSchemaMismatchError";
  }
}
