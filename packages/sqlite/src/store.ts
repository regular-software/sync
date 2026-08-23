import type Database from "better-sqlite3";
import type { SyncStore } from "@regular-sync/client";
import { TableRegistry } from "@regular-sync/client";
import type { SyncResult, SyncTable } from "@regular-sync/shared";
import { deleteRow, getAllRows, getRow, putRow } from "./rows";
import { getVersion, initializeMetadata, setVersion } from "./metadata";

export class SQLiteSyncStore implements SyncStore {
  private tables = new TableRegistry();

  constructor(private db: Database.Database) {
    initializeMetadata(db);
  }

  async registerTable(table: SyncTable): Promise<void> {
    this.tables.register(table);
  }

  async getVersion(): Promise<number> {
    return getVersion(this.db);
  }

  async apply(result: SyncResult): Promise<void> {
    const transaction = this.db.transaction(() => {
      for (const syncedRow of result.rows) {
        const table = this.tables.find(syncedRow.tableName);

        if (!table) {
          continue;
        }

        putRow(this.db, table, syncedRow.row);
      }

      for (const deletedRow of result.deleted) {
        const table = this.tables.find(deletedRow.tableName);

        if (!table) {
          continue;
        }

        deleteRow(this.db, table, deletedRow.rowId);
      }

      setVersion(this.db, result.version);
    });

    transaction();
  }

  async getAll<Row extends Record<string, unknown>>(
    table: SyncTable,
  ): Promise<Row[]> {
    return getAllRows<Row>(this.db, table);
  }

  async get<Row extends Record<string, unknown>>(
    table: SyncTable,
    rowId: string,
  ): Promise<Row | undefined> {
    return getRow<Row>(this.db, table, rowId);
  }

  async put<Row extends Record<string, unknown>>(
    table: SyncTable,
    row: Row,
  ): Promise<void> {
    putRow(this.db, table, row);
  }

  async delete(table: SyncTable, rowId: string): Promise<void> {
    deleteRow(this.db, table, rowId);
  }
}
