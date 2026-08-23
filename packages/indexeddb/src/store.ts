import type { MutationStore, SyncStore } from "@regular-software/sync";
import { TableRegistry } from "@regular-software/sync";
import type { SyncResult, SyncTable } from "@regular-software/sync-protocol";
import { openDatabase } from "./database";
import { getVersion, META_STORE, setVersion } from "./metadata";
import { createMutationStore } from "./mutations";
import { deleteRow, getAllRows, getRow, putRow } from "./rows";
import { waitForTransaction } from "./transactions";

export class IndexedDbSyncStore implements SyncStore {
  private tables = new TableRegistry();
  private dbPromise: Promise<IDBDatabase>;
  readonly mutations: MutationStore;

  constructor(private databaseName: string) {
    this.dbPromise = openDatabase(databaseName);

    this.mutations = createMutationStore(() => this.dbPromise);
  }

  async registerTable(table: SyncTable) {
    this.tables.register(table);

    let db = await this.dbPromise;

    if (db.objectStoreNames.contains(table.name)) {
      return;
    }

    const nextVersion = db.version + 1;

    db.close();

    this.dbPromise = openDatabase(this.databaseName, nextVersion, table);

    await this.dbPromise;
  }

  async getVersion(): Promise<number> {
    const db = await this.dbPromise;

    return getVersion(db);
  }

  async apply(result: SyncResult): Promise<void> {
    const db = await this.dbPromise;

    const tableNames = new Set<string>();

    for (const row of result.rows) {
      if (this.tables.find(row.tableName)) {
        tableNames.add(row.tableName);
      }
    }

    for (const row of result.deleted) {
      if (this.tables.find(row.tableName)) {
        tableNames.add(row.tableName);
      }
    }

    const transaction = db.transaction(
      [META_STORE, ...tableNames],
      "readwrite",
    );

    for (const syncedRow of result.rows) {
      const table = this.tables.find(syncedRow.tableName);

      if (!table) {
        continue;
      }

      putRow(transaction, table, syncedRow.row);
    }

    for (const deletedRow of result.deleted) {
      const table = this.tables.find(deletedRow.tableName);

      if (!table) {
        continue;
      }

      deleteRow(transaction, table, deletedRow.rowId);
    }

    setVersion(transaction, result.version);

    await waitForTransaction(transaction);
  }

  async getAll<Row extends Record<string, unknown>>(
    table: SyncTable,
  ): Promise<Row[]> {
    const db = await this.dbPromise;

    const transaction = db.transaction(table.name, "readonly");

    return getAllRows<Row>(transaction, table);
  }

  async get<Row extends Record<string, unknown>>(
    table: SyncTable,
    rowId: string,
  ): Promise<Row | undefined> {
    const db = await this.dbPromise;

    const transaction = db.transaction(table.name, "readonly");

    return getRow<Row>(transaction, table, rowId);
  }

  async put<Row extends Record<string, unknown>>(
    table: SyncTable,
    row: Row,
  ): Promise<void> {
    const db = await this.dbPromise;

    const transaction = db.transaction(table.name, "readwrite");

    putRow(transaction, table, row);

    await waitForTransaction(transaction);
  }

  async delete(table: SyncTable, rowId: string): Promise<void> {
    const db = await this.dbPromise;

    const transaction = db.transaction(table.name, "readwrite");

    deleteRow(transaction, table, rowId);

    await waitForTransaction(transaction);
  }
}
