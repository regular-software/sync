import type { SyncTable } from "@regular-sync/shared";
import { MUTATION_STORE } from "./mutations";
import { ensureMetadataStore } from "./metadata";

export function openDatabase(
  databaseName: string,
  version?: number,
  table?: SyncTable,
): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request =
      version === undefined
        ? indexedDB.open(databaseName)
        : indexedDB.open(databaseName, version);

    request.onupgradeneeded = () => {
      const db = request.result;

      if (!db.objectStoreNames.contains(MUTATION_STORE)) {
        db.createObjectStore(MUTATION_STORE, {
          keyPath: "id",
        });
      }

      ensureMetadataStore(db);

      if (table && !db.objectStoreNames.contains(table.name)) {
        db.createObjectStore(table.name, {
          keyPath: table.primaryKey,
        });
      }
    };

    request.onsuccess = () => {
      resolve(request.result);
    };

    request.onerror = () => {
      reject(request.error);
    };
  });
}
