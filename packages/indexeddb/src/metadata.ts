import type { SyncRequest } from "@regular-software/sync-protocol";

const META_STORE = "rs_client_state";
const VERSION_KEY = "version";
const REPLICA_KEY = "replicaId";
const SCHEMA_VERSION_KEY = "schemaVersion";
const SCHEMA_FINGERPRINT_KEY = "schemaFingerprint";

export function ensureMetadataStore(db: IDBDatabase) {
  if (!db.objectStoreNames.contains(META_STORE)) {
    db.createObjectStore(META_STORE);
  }
}

export function getSyncRequest(db: IDBDatabase): Promise<SyncRequest> {
  return getSyncRequestFromTransaction(db.transaction(META_STORE, "readonly"));
}

export async function getSyncRequestFromTransaction(
  transaction: IDBTransaction,
): Promise<SyncRequest> {
  const store = transaction.objectStore(META_STORE);
  const [version, replicaId, schemaVersion, schemaFingerprint] = await Promise.all([
    requestValue<number>(store.get(VERSION_KEY)),
    requestValue<string>(store.get(REPLICA_KEY)),
    requestValue<number>(store.get(SCHEMA_VERSION_KEY)),
    requestValue<string>(store.get(SCHEMA_FINGERPRINT_KEY)),
  ]);

  return {
    version: version ?? 0,
    ...(replicaId ? { replicaId } : {}),
    schemaVersion: schemaVersion ?? 0,
    schemaFingerprint: schemaFingerprint ?? "",
  };
}

export function setSyncRequest(
  transaction: IDBTransaction,
  state: SyncRequest,
) {
  const store = transaction.objectStore(META_STORE);
  store.put(state.version, VERSION_KEY);
  store.put(state.schemaVersion, SCHEMA_VERSION_KEY);
  store.put(state.schemaFingerprint, SCHEMA_FINGERPRINT_KEY);

  if (state.replicaId) store.put(state.replicaId, REPLICA_KEY);
  else store.delete(REPLICA_KEY);
}

function requestValue<Value>(request: IDBRequest): Promise<Value | undefined> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result as Value | undefined);
    request.onerror = () => reject(request.error);
  });
}

export { META_STORE };
