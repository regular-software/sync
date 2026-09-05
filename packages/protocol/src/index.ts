export type Change = {
  sequence: number;
  version: number;
  tableName: string;
  rowId: string;
  operation: "insert" | "update" | "delete";
  previousRow?: Record<string, JsonValue>;
};

export type SyncTable = {
  name: string;
  primaryKey: string;
  columns?: string[];
};

export type SyncFilterClause = {
  column: string;
  operator: "=" | "!=" | "<" | "<=" | ">" | ">=" | "in" | "isNull";
  value?: JsonValue | JsonValue[];
};

export type SyncFilterSet = Record<string, SyncFilterClause[]>;

export type SyncRequest = {
  version: number;
  replicaId?: string;
  schemaVersion: number;
  schemaFingerprint: string;
};

export type SyncIdentity = {
  replicaId: string;
  schemaVersion: number;
  schemaFingerprint: string;
};

export type SyncResetReason =
  | "replica-changed"
  | "cursor-ahead"
  | "cursor-expired";

export type SyncedRow = {
  tableName: string;
  row: Record<string, JsonValue>;
};

export type SyncPacket = {
  version: number;
  tableName: string;
  rowId: string;
  operation: "insert" | "update" | "delete";
  row?: Record<string, JsonValue>;
};

export type SyncResult =
  | {
      kind: "snapshot";
      version: number;
      replicaId: string;
      schemaVersion: number;
      schemaFingerprint: string;
      resetReason?: SyncResetReason;
      rows: SyncedRow[];
    }
  | {
      kind: "incremental";
      version: number;
      replicaId: string;
      schemaVersion: number;
      schemaFingerprint: string;
      packets: SyncPacket[];
    };

export function createSyncSchemaFingerprint(tables: SyncTable[]): string {
  return JSON.stringify(
    [...tables]
      .map(({ name, primaryKey }) => ({ name, primaryKey }))
      .sort((left, right) => {
        const leftKey = `${left.name}\u0000${left.primaryKey}`;
        const rightKey = `${right.name}\u0000${right.primaryKey}`;
        return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
      }),
  );
}

export type JsonPrimitive = string | number | boolean | null;

export type JsonValue =
  | JsonPrimitive
  | JsonValue[]
  | { [key: string]: JsonValue };
