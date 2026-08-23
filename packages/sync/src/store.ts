import type { SyncResult, SyncTable } from "@regular-sync/shared";

export type QueuedMutation<
  Row extends Record<string, unknown> = Record<string, unknown>,
> = {
  id: string;
  tableName: string;
  row: Row;
  createdAt: number;
};

export interface MutationStore {
  add<Row extends Record<string, unknown>>(
    mutation: QueuedMutation<Row>,
  ): Promise<void>;

  remove(id: string): Promise<void>;

  getAll(): Promise<QueuedMutation[]>;
}

export interface SyncStore {
  registerTable(table: SyncTable): Promise<void>;
  getVersion(): Promise<number>;
  apply(result: SyncResult): Promise<void>;

  getAll<Row extends Record<string, unknown>>(table: SyncTable): Promise<Row[]>;

  get<Row extends Record<string, unknown>>(
    table: SyncTable,
    rowId: string,
  ): Promise<Row | undefined>;

  put<Row extends Record<string, unknown>>(
    table: SyncTable,
    row: Row,
  ): Promise<void>;

  delete(table: SyncTable, rowId: string): Promise<void>;

  mutations: MutationStore;
}
