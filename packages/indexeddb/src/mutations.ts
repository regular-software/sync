import type {
  MutationFailure,
  MutationStore,
  QueuedMutation,
} from "@regular-software/sync";
import { waitForTransaction } from "./transactions";

export const MUTATION_STORE = "rs_mutation_queue";
export const MUTATION_ID_INDEX = "id";
export const FAILURE_STORE = "rs_mutation_failures";

export function getAllMutations(
  transaction: IDBTransaction,
): Promise<QueuedMutation[]> {
  return new Promise((resolve, reject) => {
    const request = transaction.objectStore(MUTATION_STORE).getAll();

    request.onsuccess = () => {
      resolve(request.result);
    };

    request.onerror = () => {
      reject(request.error);
    };
  });
}

function getMutation(
  transaction: IDBTransaction,
  id: string,
): Promise<QueuedMutation | undefined> {
  return new Promise((resolve, reject) => {
    const request = transaction
      .objectStore(MUTATION_STORE)
      .index(MUTATION_ID_INDEX)
      .get(id);

    request.onsuccess = () => {
      resolve(request.result);
    };

    request.onerror = () => {
      reject(request.error);
    };
  });
}

function getMutationKey(
  transaction: IDBTransaction,
  id: string,
): Promise<IDBValidKey | undefined> {
  return new Promise((resolve, reject) => {
    const request = transaction
      .objectStore(MUTATION_STORE)
      .index(MUTATION_ID_INDEX)
      .getKey(id);

    request.onsuccess = () => {
      resolve(request.result);
    };

    request.onerror = () => {
      reject(request.error);
    };
  });
}

export function createMutationStore(
  getDb: () => Promise<IDBDatabase>,
): MutationStore {
  return {
    async add(mutation) {
      const db = await getDb();
      const transaction = db.transaction(MUTATION_STORE, "readwrite");

      transaction.objectStore(MUTATION_STORE).add(mutation);

      await waitForTransaction(transaction);
    },

    async acknowledge(id, version) {
      const db = await getDb();
      const transaction = db.transaction(MUTATION_STORE, "readwrite");
      const completion = waitForTransaction(transaction);
      const mutation = await getMutation(transaction, id);

      if (mutation) {
        transaction.objectStore(MUTATION_STORE).put({
          ...mutation,
          acknowledgedVersion: version,
        });
      }

      await completion;
    },

    async remove(id) {
      const db = await getDb();
      const transaction = db.transaction(MUTATION_STORE, "readwrite");
      const completion = waitForTransaction(transaction);
      const key = await getMutationKey(transaction, id);

      if (key !== undefined) {
        transaction.objectStore(MUTATION_STORE).delete(key);
      }

      await completion;
    },

    async fail(id, failure) {
      const db = await getDb();
      const transaction = db.transaction(
        [MUTATION_STORE, FAILURE_STORE],
        "readwrite",
      );
      const completion = waitForTransaction(transaction);
      const key = await getMutationKey(transaction, id);

      if (key !== undefined) {
        transaction.objectStore(MUTATION_STORE).delete(key);
        transaction.objectStore(FAILURE_STORE).put(failure);
      }

      await completion;
    },

    async getAll() {
      const db = await getDb();
      const transaction = db.transaction(MUTATION_STORE, "readonly");

      return getAllMutations(transaction);
    },

    async getFailures() {
      const db = await getDb();
      const transaction = db.transaction(FAILURE_STORE, "readonly");

      return new Promise<MutationFailure[]>((resolve, reject) => {
        const request = transaction.objectStore(FAILURE_STORE).getAll();
        request.onsuccess = () =>
          resolve(
            request.result.sort(
              (left, right) => left.failedAt - right.failedAt,
            ),
          );
        request.onerror = () => reject(request.error);
      });
    },

    async acknowledgeFailure(id) {
      const db = await getDb();
      const transaction = db.transaction(FAILURE_STORE, "readwrite");
      transaction.objectStore(FAILURE_STORE).delete(id);
      await waitForTransaction(transaction);
    },
  };
}
