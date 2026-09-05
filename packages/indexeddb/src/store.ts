import {
  IncompatibleSyncSchemaError,
  PendingMutationsBlockSchemaUpgradeError,
  TableRegistry,
  type MutationStore,
  type SyncStore,
  type SyncStoreSchema,
} from "@regular-software/sync";
import {
  createSyncSchemaFingerprint,
  type SyncRequest,
  type SyncResult,
  type SyncTable,
} from "@regular-software/sync-protocol";
import { openDatabase } from "./database";
import {
  getSyncRequest,
  getSyncRequestFromTransaction,
  META_STORE,
  setSyncRequest,
} from "./metadata";
import {
  createMutationStore,
  FAILURE_STORE,
  getAllMutations,
  MUTATION_STORE,
} from "./mutations";
import {
  applyOptimisticEffects,
  applyOptimisticEffectsToRow,
  deleteRow,
  getAllRows,
  getRow,
  putRow,
} from "./rows";
import { waitForTransaction } from "./transactions";

export class IndexedDbSyncStore implements SyncStore {
  private tables = new TableRegistry();
  private dbPromise: Promise<IDBDatabase>;
  readonly mutations: MutationStore;

  constructor(private databaseName: string) {
    this.dbPromise = openDatabase(databaseName);
    this.mutations = createMutationStore(() => this.dbPromise);
  }

  async initializeSchema(schema: SyncStoreSchema): Promise<void> {
    if (!Number.isSafeInteger(schema.schemaVersion) || schema.schemaVersion <= 0) {
      throw new Error("schemaVersion must be a positive safe integer");
    }

    const fingerprint = createSyncSchemaFingerprint(schema.tables);
    let db = await this.dbPromise;
    const [current, queued] = await Promise.all([
      getSyncRequest(db),
      this.mutations.getAll(),
    ]);
    const hasStoredSchema = current.schemaVersion > 0;
    const schemaChanged =
      !hasStoredSchema || current.schemaVersion !== schema.schemaVersion;

    if (
      hasStoredSchema &&
      current.schemaVersion > schema.schemaVersion
    ) {
      throw new IncompatibleSyncSchemaError(
        "sync schemaVersion cannot move backwards",
      );
    }

    if (
      hasStoredSchema &&
      current.schemaVersion === schema.schemaVersion &&
      current.schemaFingerprint !== fingerprint
    ) {
      throw new IncompatibleSyncSchemaError(
        "Registered sync tables changed without a schemaVersion increase",
      );
    }

    if (schemaChanged && queued.length > 0) {
      throw new PendingMutationsBlockSchemaUpgradeError();
    }

    const requiresUpgrade =
      !db.objectStoreNames.contains(FAILURE_STORE) ||
      schema.tables.some((table) => !db.objectStoreNames.contains(table.name));

    if (requiresUpgrade) {
      const nextVersion = db.version + 1;
      db.close();
      this.dbPromise = openDatabase(
        this.databaseName,
        nextVersion,
        schema.tables,
      );
      db = await this.dbPromise;
    } else {
      await validateTableKeyPaths(db, schema.tables);
    }

    if (schemaChanged) {
      const storeNames = [
        META_STORE,
        MUTATION_STORE,
        ...schema.tables.map((table) => table.name),
      ];
      const transaction = db.transaction(storeNames, "readwrite");
      const completion = waitForTransaction(transaction);
      const currentMutations = await getAllMutations(transaction);

      if (currentMutations.length > 0) {
        transaction.abort();
        await completion.catch(() => {});
        throw new PendingMutationsBlockSchemaUpgradeError();
      }

      for (const table of schema.tables) {
        transaction.objectStore(table.name).clear();
      }

      setSyncRequest(transaction, {
        version: 0,
        schemaVersion: schema.schemaVersion,
        schemaFingerprint: fingerprint,
      });
      await completion;
    }

    const registry = new TableRegistry();
    for (const table of schema.tables) registry.register(table);
    this.tables = registry;
  }

  async getSyncRequest(): Promise<SyncRequest> {
    return getSyncRequest(await this.dbPromise);
  }

  async apply(
    result: SyncResult,
  ): Promise<{
    changed: boolean;
    confirmedMutationIds: string[];
    reset: boolean;
  }> {
    const db = await this.dbPromise;
    const tableNames = new Set<string>(
      result.kind === "snapshot"
        ? [...this.tables.values()].map((table) => table.name)
        : [],
    );

    if (result.kind === "snapshot") {
      for (const row of result.rows) {
        if (this.tables.find(row.tableName)) tableNames.add(row.tableName);
      }
    }

    if (result.kind === "incremental") {
      for (const packet of result.packets) {
        if (this.tables.find(packet.tableName)) tableNames.add(packet.tableName);
      }
    }

    const transaction = db.transaction(
      [META_STORE, MUTATION_STORE, ...tableNames],
      "readwrite",
    );
    const completion = waitForTransaction(transaction);
    const [current, mutations] = await Promise.all([
      getSyncRequestFromTransaction(transaction),
      getAllMutations(transaction),
    ]);

    if (
      result.schemaVersion !== current.schemaVersion ||
      result.schemaFingerprint !== current.schemaFingerprint
    ) {
      transaction.abort();
      await completion.catch(() => {});
      throw new IncompatibleSyncSchemaError(
        "Cannot apply a result for a different synchronization schema",
      );
    }

    const reset = result.kind === "snapshot" && result.resetReason !== undefined;
    const stale =
      !reset &&
      current.replicaId === result.replicaId &&
      result.version < current.version;
    const coveredVersion = stale ? current.version : result.version;
    const confirmedMutations = reset
      ? []
      : mutations.filter(
          (mutation) =>
            mutation.acknowledgedVersion !== undefined &&
            mutation.acknowledgedVersion <= coveredVersion,
        );

    if (!stale) {
      if (result.kind === "snapshot") {
        for (const table of this.tables.values()) {
          transaction.objectStore(table.name).clear();
        }
      }

      if (result.kind === "snapshot") {
        for (const syncedRow of result.rows) {
          const table = this.tables.find(syncedRow.tableName);
          if (table) putRow(transaction, table, syncedRow.row);
        }
      } else {
        for (const packet of result.packets) {
          const table = this.tables.find(packet.tableName);
          if (!table) continue;
          if (packet.operation === "delete") deleteRow(transaction, table, packet.rowId);
          else if (packet.row) putRow(transaction, table, packet.row);
        }
      }

      setSyncRequest(transaction, {
        version: result.version,
        replicaId: result.replicaId,
        schemaVersion: result.schemaVersion,
        schemaFingerprint: result.schemaFingerprint,
      });
    }

    const mutationStore = transaction.objectStore(MUTATION_STORE);

    if (reset) {
      for (const mutation of mutations) {
        if (mutation.acknowledgedVersion !== undefined) {
          const { acknowledgedVersion: _acknowledgedVersion, ...pending } =
            mutation;
          mutationStore.put(pending);
        }
      }
    } else {
      for (const mutation of confirmedMutations) {
        if (mutation.sequence !== undefined) {
          mutationStore.delete(mutation.sequence);
        }
      }
    }

    await completion;

    return {
      changed:
        reset ||
        confirmedMutations.length > 0 ||
        (!stale &&
          (result.kind === "snapshot" ||
            result.version !== current.version ||
            result.packets.length > 0)),
      confirmedMutationIds: confirmedMutations.map((mutation) => mutation.id),
      reset,
    };
  }

  async getAll<Row extends Record<string, unknown>>(
    table: SyncTable,
  ): Promise<Row[]> {
    const db = await this.dbPromise;
    const transaction = db.transaction(
      [table.name, MUTATION_STORE],
      "readonly",
    );
    const [rows, mutations] = await Promise.all([
      getAllRows<Row>(transaction, table),
      getAllMutations(transaction),
    ]);
    return applyOptimisticEffects(table, rows, mutations);
  }

  async get<Row extends Record<string, unknown>>(
    table: SyncTable,
    rowId: string,
  ): Promise<Row | undefined> {
    const db = await this.dbPromise;
    const transaction = db.transaction(
      [table.name, MUTATION_STORE],
      "readonly",
    );
    const [row, mutations] = await Promise.all([
      getRow<Row>(transaction, table, rowId),
      getAllMutations(transaction),
    ]);
    return applyOptimisticEffectsToRow(table, rowId, row, mutations);
  }
}

async function validateTableKeyPaths(
  db: IDBDatabase,
  tables: SyncTable[],
): Promise<void> {
  for (const table of tables) {
    const transaction = db.transaction(table.name, "readonly");
    const keyPath = transaction.objectStore(table.name).keyPath;

    if (keyPath !== table.primaryKey) {
      throw new IncompatibleSyncSchemaError(
        `IndexedDB table "${table.name}" has primary key "${String(keyPath)}" instead of "${table.primaryKey}"`,
      );
    }
  }
}
