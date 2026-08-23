const META_STORE = "rs_client_state";
const VERSION_KEY = "version";

export function ensureMetadataStore(db: IDBDatabase) {
  if (!db.objectStoreNames.contains(META_STORE)) {
    db.createObjectStore(META_STORE);
  }
}

export function getVersion(db: IDBDatabase): Promise<number> {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(META_STORE, "readonly");

    const request = transaction.objectStore(META_STORE).get(VERSION_KEY);

    request.onsuccess = () => {
      resolve(request.result ?? 0);
    };

    request.onerror = () => {
      reject(request.error);
    };
  });
}

export function setVersion(transaction: IDBTransaction, version: number) {
  transaction.objectStore(META_STORE).put(version, VERSION_KEY);
}

export { META_STORE };
