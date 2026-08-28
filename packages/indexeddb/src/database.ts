import type { SyncTable } from "@regular-software/sync-protocol";
import {
  FAILURE_STORE,
  MUTATION_ID_INDEX,
  MUTATION_STORE,
} from "./mutations";
import { ensureMetadataStore, META_STORE } from "./metadata";

export function openDatabase(
  databaseName: string,
  version?: number,
  tables: SyncTable[] = [],
): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request =
      version === undefined
        ? indexedDB.open(databaseName)
        : indexedDB.open(databaseName, version);

    request.onupgradeneeded = () => {
      const db = request.result;

      if (!db.objectStoreNames.contains(MUTATION_STORE)) {
        const store = db.createObjectStore(MUTATION_STORE, {
          keyPath: "sequence",
          autoIncrement: true,
        });

        store.createIndex(MUTATION_ID_INDEX, "id", { unique: true });
      }

      if (!db.objectStoreNames.contains(FAILURE_STORE)) {
        db.createObjectStore(FAILURE_STORE, { keyPath: "id" });
      }

      ensureMetadataStore(db);

      for (const table of tables) {
        if (!db.objectStoreNames.contains(table.name)) {
          db.createObjectStore(table.name, { keyPath: table.primaryKey });
        }
      }
    };

    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => db.close();

      if (
        !db.objectStoreNames.contains(MUTATION_STORE) ||
        !db.objectStoreNames.contains(FAILURE_STORE) ||
        !db.objectStoreNames.contains(META_STORE)
      ) {
        const nextVersion = db.version + 1;
        db.close();
        void openDatabase(databaseName, nextVersion, tables).then(
          resolve,
          reject,
        );
        return;
      }

      const transaction = db.transaction(MUTATION_STORE, "readonly");
      const store = transaction.objectStore(MUTATION_STORE);

      if (
        store.keyPath !== "sequence" ||
        !store.indexNames.contains(MUTATION_ID_INDEX)
      ) {
        db.close();
        reject(
          new Error(
            `IndexedDB database "${databaseName}" uses an incompatible Regular Sync schema. Delete it or choose a new database name.`,
          ),
        );
        return;
      }

      const failureTransaction = db.transaction(FAILURE_STORE, "readonly");
      if (failureTransaction.objectStore(FAILURE_STORE).keyPath !== "id") {
        db.close();
        reject(
          new Error(
            `IndexedDB database "${databaseName}" uses an incompatible mutation failure schema.`,
          ),
        );
        return;
      }

      const metadataTransaction = db.transaction(META_STORE, "readonly");
      if (metadataTransaction.objectStore(META_STORE).keyPath !== null) {
        db.close();
        reject(
          new Error(
            `IndexedDB database "${databaseName}" uses an incompatible client state schema.`,
          ),
        );
        return;
      }

      for (const table of tables) {
        if (!db.objectStoreNames.contains(table.name)) {
          db.close();
          reject(new Error(`IndexedDB table "${table.name}" is missing`));
          return;
        }

        const tableTransaction = db.transaction(table.name, "readonly");
        if (
          tableTransaction.objectStore(table.name).keyPath !== table.primaryKey
        ) {
          db.close();
          reject(
            new Error(
              `IndexedDB table "${table.name}" has an incompatible primary key`,
            ),
          );
          return;
        }
      }

      resolve(db);
    };

    request.onerror = () => {
      reject(request.error);
    };

    request.onblocked = () => {
      reject(
        new Error(
          `IndexedDB database "${databaseName}" upgrade is blocked by another open tab`,
        ),
      );
    };
  });
}
