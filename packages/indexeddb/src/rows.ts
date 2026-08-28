import type { SyncTable } from "@regular-software/sync-protocol";
import type { QueuedMutation } from "@regular-software/sync";

function getEffectRowId(
  table: SyncTable,
  row: Record<string, unknown>,
): string {
  const rowId = row[table.primaryKey];

  if (typeof rowId !== "string") {
    throw new Error(`Primary key "${table.primaryKey}" must be a string`);
  }

  return rowId;
}

export function applyOptimisticEffects<Row extends Record<string, unknown>>(
  table: SyncTable,
  rows: Row[],
  mutations: QueuedMutation[],
): Row[] {
  const visibleRows = new Map<string, Row>();

  for (const row of rows) {
    visibleRows.set(getEffectRowId(table, row), row);
  }

  for (const mutation of mutations) {
    for (const effect of mutation.effects) {
      if (effect.tableName !== table.name) {
        continue;
      }

      if (effect.operation === "put") {
        visibleRows.set(getEffectRowId(table, effect.row), effect.row as Row);
      } else {
        visibleRows.delete(effect.rowId);
      }
    }
  }

  return [...visibleRows.values()];
}

export function applyOptimisticEffectsToRow<
  Row extends Record<string, unknown>,
>(
  table: SyncTable,
  rowId: string,
  row: Row | undefined,
  mutations: QueuedMutation[],
): Row | undefined {
  let visibleRow = row;

  for (const mutation of mutations) {
    for (const effect of mutation.effects) {
      if (effect.tableName !== table.name) {
        continue;
      }

      if (effect.operation === "put") {
        if (getEffectRowId(table, effect.row) === rowId) {
          visibleRow = effect.row as Row;
        }
      } else if (effect.rowId === rowId) {
        visibleRow = undefined;
      }
    }
  }

  return visibleRow;
}

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
