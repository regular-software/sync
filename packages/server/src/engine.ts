import Database from "better-sqlite3";
import { getChangesSince } from "./change-log";

import type {
  DeletedRow,
  JsonValue,
  SyncedRow,
  SyncResult,
  SyncTable,
} from "@regular-sync/shared";

import type { Mutation } from "./types";

export class SyncEngine {
  private tables = new Map<string, SyncTable>();

  constructor(private db: Database.Database) {}

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
  `);
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

  syncSince(version: number): SyncResult {
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
      version: latestVersion,
      rows,
      deleted,
    };
  }
}
