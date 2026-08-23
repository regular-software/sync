export type ChangeOperation = "insert" | "update" | "delete";

export type Change = {
  version: number;
  tableName: string;
  rowId: string;
  operation: ChangeOperation;
};

export type SyncTable = {
  name: string;
  primaryKey: string;
};

export type SyncedRow = {
  tableName: string;
  row: Record<string, JsonValue>;
};

export type DeletedRow = {
  tableName: string;
  rowId: string;
};

export type SyncResult = {
  version: number;
  rows: SyncedRow[];
  deleted: DeletedRow[];
};

export type Mutation = {
  tableName: string;
  rowId: string;
  operation: ChangeOperation;
  run: () => void;
};

export type JsonPrimitive = string | number | boolean | null;

export type JsonValue =
  | JsonPrimitive
  | JsonValue[]
  | { [key: string]: JsonValue };
