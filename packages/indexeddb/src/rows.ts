import type { SyncTable } from "@regular-sync/shared";

export function getRow<Row extends Record<string, unknown>>(
  transaction: IDBTransaction,
  table: SyncTable,
  rowId: string,
): Promise<Row | undefined> {
  return new Promise((resolve, reject) => {
    const request = transaction.objectStore(table.name).get(rowId);

    request.onsuccess = () => {
      resolve(request.result as Row | undefined);
    };

    request.onerror = () => {
      reject(request.error);
    };
  });
}

export function getAllRows<Row extends Record<string, unknown>>(
  transaction: IDBTransaction,
  table: SyncTable,
): Promise<Row[]> {
  return new Promise((resolve, reject) => {
    const request = transaction.objectStore(table.name).getAll();

    request.onsuccess = () => {
      resolve(request.result as Row[]);
    };

    request.onerror = () => {
      reject(request.error);
    };
  });
}

export function putRow(
  transaction: IDBTransaction,
  table: SyncTable,
  row: Record<string, unknown>,
): void {
  transaction.objectStore(table.name).put(row);
}

export function deleteRow(
  transaction: IDBTransaction,
  table: SyncTable,
  rowId: string,
): void {
  transaction.objectStore(table.name).delete(rowId);
}
