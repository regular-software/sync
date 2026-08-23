import type { MutationStore, QueuedMutation } from "@regular-software/sync";

import { waitForTransaction } from "./transactions";

export const MUTATION_STORE = "rs_mutation_queue";

export function createMutationStore(
  getDb: () => Promise<IDBDatabase>,
): MutationStore {
  return {
    async add(mutation) {
      const db = await getDb();

      const transaction = db.transaction(MUTATION_STORE, "readwrite");

      transaction.objectStore(MUTATION_STORE).put(mutation);

      await waitForTransaction(transaction);
    },

    async remove(id) {
      const db = await getDb();

      const transaction = db.transaction(MUTATION_STORE, "readwrite");

      transaction.objectStore(MUTATION_STORE).delete(id);

      await waitForTransaction(transaction);
    },

    async getAll() {
      const db = await getDb();

      return new Promise<QueuedMutation[]>((resolve, reject) => {
        const transaction = db.transaction(MUTATION_STORE, "readonly");

        const request = transaction.objectStore(MUTATION_STORE).getAll();

        request.onsuccess = () => {
          resolve(request.result.sort((a, b) => a.createdAt - b.createdAt));
        };

        request.onerror = () => {
          reject(request.error);
        };
      });
    },
  };
}
