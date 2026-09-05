import Database from "better-sqlite3";
import { getChangesSince } from "./change-log";
import type {
  JsonValue,
  SyncFilterClause,
  SyncFilterSet,
  SyncPacket,
  SyncRequest,
  SyncResetReason,
  SyncResult,
  SyncTable,
} from "@regular-software/sync-protocol";
import { createSyncSchemaFingerprint } from "@regular-software/sync-protocol";

export type Mutation = {
  id: string;
  run: () => void;
  auditHook?: (version: number) => void;
};

export type BatchMutationResult = { id: string; version: number };

function identifier(value: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(value)) {
    throw new Error(`Invalid SQLite identifier: ${value}`);
  }
  return `"${value}"`;
}

export class SyncEngine {
  private tables = new Map<string, SyncTable>();

  constructor(
    private db: Database.Database,
    private options: {
      schemaVersion: number;
      filters?: (context: unknown) => SyncFilterSet | undefined;
    },
  ) {
    if (!Number.isSafeInteger(options.schemaVersion) || options.schemaVersion <= 0) {
      throw new Error("schemaVersion must be a positive safe integer");
    }
  }

  initialize() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS rs_changes (
        sequence INTEGER PRIMARY KEY AUTOINCREMENT,
        version INTEGER NOT NULL,
        table_name TEXT NOT NULL,
        row_id TEXT NOT NULL,
        operation TEXT NOT NULL,
        previous_row TEXT
      );
      CREATE TABLE IF NOT EXISTS rs_applied_mutations (
        id TEXT PRIMARY KEY,
        version INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS rs_sync_state (
        singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
        replica_id TEXT NOT NULL,
        current_version INTEGER NOT NULL DEFAULT 0,
        oldest_retained_version INTEGER NOT NULL DEFAULT 1
      );
      CREATE TABLE IF NOT EXISTS rs_sync_context (
        singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
        version INTEGER NOT NULL
      );
    `);
    const columns = this.db.prepare("PRAGMA table_info(rs_sync_state)").all() as { name: string }[];
    if (!columns.some((column) => column.name === "current_version")) this.db.exec("ALTER TABLE rs_sync_state ADD COLUMN current_version INTEGER NOT NULL DEFAULT 0");
    if (!columns.some((column) => column.name === "oldest_retained_version")) this.db.exec("ALTER TABLE rs_sync_state ADD COLUMN oldest_retained_version INTEGER NOT NULL DEFAULT 1");
    this.db.prepare(`INSERT OR IGNORE INTO rs_sync_state (singleton, replica_id, current_version, oldest_retained_version) VALUES (1, ?, 0, 1)`).run(crypto.randomUUID());
  }

  registerTable(table: SyncTable) {
    const tableName = identifier(table.name);
    const primaryKey = identifier(table.primaryKey);
    const columns = table.columns ?? (this.db.prepare(`PRAGMA table_info(${tableName})`).all() as { name: string }[]).map((row) => row.name);
    if (!columns.includes(table.primaryKey)) throw new Error(`Unknown primary key: ${table.primaryKey}`);
    const oldJson = `json_object(${columns.flatMap((column) => [`'${column}'`, `OLD.${identifier(column)}`]).join(",")})`;
    const triggerPrefix = `rs_${table.name}`;
    this.db.exec(`
      CREATE TRIGGER IF NOT EXISTS ${identifier(`${triggerPrefix}_insert`)} AFTER INSERT ON ${tableName} BEGIN
        UPDATE rs_sync_state SET current_version = current_version + 1 WHERE singleton = 1 AND NOT EXISTS (SELECT 1 FROM rs_sync_context WHERE singleton = 1);
        INSERT INTO rs_changes (version, table_name, row_id, operation, previous_row) SELECT COALESCE((SELECT version FROM rs_sync_context WHERE singleton = 1), current_version), '${table.name}', CAST(NEW.${primaryKey} AS TEXT), 'insert', NULL FROM rs_sync_state WHERE singleton = 1;
      END;
      CREATE TRIGGER IF NOT EXISTS ${identifier(`${triggerPrefix}_update`)} AFTER UPDATE ON ${tableName} BEGIN
        UPDATE rs_sync_state SET current_version = current_version + 1 WHERE singleton = 1 AND NOT EXISTS (SELECT 1 FROM rs_sync_context WHERE singleton = 1);
        INSERT INTO rs_changes (version, table_name, row_id, operation, previous_row) SELECT COALESCE((SELECT version FROM rs_sync_context WHERE singleton = 1), current_version), '${table.name}', CAST(NEW.${primaryKey} AS TEXT), 'update', ${oldJson} FROM rs_sync_state WHERE singleton = 1;
      END;
      CREATE TRIGGER IF NOT EXISTS ${identifier(`${triggerPrefix}_delete`)} AFTER DELETE ON ${tableName} BEGIN
        UPDATE rs_sync_state SET current_version = current_version + 1 WHERE singleton = 1 AND NOT EXISTS (SELECT 1 FROM rs_sync_context WHERE singleton = 1);
        INSERT INTO rs_changes (version, table_name, row_id, operation, previous_row) SELECT COALESCE((SELECT version FROM rs_sync_context WHERE singleton = 1), current_version), '${table.name}', CAST(OLD.${primaryKey} AS TEXT), 'delete', ${oldJson} FROM rs_sync_state WHERE singleton = 1;
      END;
    `);
    this.tables.set(table.name, { ...table, columns });
  }

  getVersion(): number {
    return (this.db.prepare("SELECT current_version AS version FROM rs_sync_state WHERE singleton = 1").get() as { version: number }).version;
  }

  mutate(mutation: Mutation): number {
    return this.mutateBatch([mutation])[0]!.version;
  }

  mutateBatch(mutations: Mutation[]): BatchMutationResult[] {
    return this.db.transaction(() => {
      const results: BatchMutationResult[] = [];
      for (const mutation of mutations) {
        const existing = this.db.prepare("SELECT version FROM rs_applied_mutations WHERE id = ?").get(mutation.id) as { version: number } | undefined;
        if (existing) {
          results.push({ id: mutation.id, version: existing.version });
          continue;
        }
        const version = this.getVersion() + 1;
        this.db.prepare("UPDATE rs_sync_state SET current_version = ? WHERE singleton = 1").run(version);
        this.db.prepare("INSERT OR REPLACE INTO rs_sync_context (singleton, version) VALUES (1, ?)").run(version);
        mutation.run();
        mutation.auditHook?.(version);
        this.db.prepare("DELETE FROM rs_sync_context WHERE singleton = 1").run();
        this.db.prepare("INSERT INTO rs_applied_mutations (id, version) VALUES (?, ?)").run(mutation.id, version);
        results.push({ id: mutation.id, version });
      }
      return results;
    })();
  }

  compactChanges(beforeVersion: number): void {
    if (!Number.isSafeInteger(beforeVersion) || beforeVersion < 1) throw new Error("beforeVersion must be a positive safe integer");
    this.db.transaction(() => {
      this.db.prepare("DELETE FROM rs_changes WHERE version < ?").run(beforeVersion);
      const row = this.db.prepare("SELECT MIN(version) AS version FROM rs_changes").get() as { version: number | null };
      this.db.prepare("UPDATE rs_sync_state SET oldest_retained_version = ? WHERE singleton = 1").run(row.version ?? this.getVersion() + 1);
    })();
  }

  syncSince(request: SyncRequest, context?: unknown): SyncResult {
    if (!Number.isSafeInteger(request.version) || request.version < 0 || !Number.isSafeInteger(request.schemaVersion) || request.schemaVersion <= 0 || typeof request.schemaFingerprint !== "string") throw new Error("Invalid synchronization request");
    return this.db.transaction(() => {
      const identity = this.getIdentity();
      if (request.schemaVersion !== identity.schemaVersion || request.schemaFingerprint !== identity.schemaFingerprint) throw new SyncSchemaMismatchError(identity);
      if (request.replicaId !== undefined && request.replicaId !== identity.replicaId) return this.readSnapshot(identity, "replica-changed", context);
      if (request.version > this.getVersion()) return this.readSnapshot(identity, "cursor-ahead", context);
      const oldest = (this.db.prepare("SELECT oldest_retained_version AS version FROM rs_sync_state WHERE singleton = 1").get() as { version: number }).version;
      if (request.version < oldest - 1) return this.readSnapshot(identity, "cursor-expired", context);
      if (request.version === 0) return this.readSnapshot(identity, undefined, context);
      return this.readIncremental(request.version, identity, context);
    })();
  }

  private getIdentity() {
    const row = this.db.prepare("SELECT replica_id AS replicaId FROM rs_sync_state WHERE singleton = 1").get() as { replicaId: string };
    return { replicaId: row.replicaId, schemaVersion: this.options.schemaVersion, schemaFingerprint: createSyncSchemaFingerprint([...this.tables.values()]) };
  }

  private getFilters(context: unknown): SyncFilterSet | undefined {
    const filters = this.options.filters?.(context);
    if (!filters) return;
    for (const [tableName, clauses] of Object.entries(filters)) {
      const table = this.tables.get(tableName);
      if (!table) throw new Error(`Unknown filtered table: ${tableName}`);
      for (const clause of clauses) {
        if (!table.columns?.includes(clause.column)) throw new Error(`Unknown filtered column: ${tableName}.${clause.column}`);
        if (clause.operator === "in" && (!Array.isArray(clause.value) || clause.value.length === 0)) throw new Error("in filter requires values");
        if (clause.operator === "isNull" && clause.value !== undefined) throw new Error("isNull filter does not accept a value");
      }
    }
    return filters;
  }

  private readSnapshot(identity: ReturnType<SyncEngine["getIdentity"]>, resetReason: SyncResetReason | undefined, context: unknown): SyncResult {
    const filters = this.getFilters(context);
    const rows = [] as { tableName: string; row: Record<string, JsonValue> }[];
    for (const table of this.tables.values()) {
      const filter = this.filterSql(filters?.[table.name]);
      const all = this.db.prepare(`SELECT * FROM ${identifier(table.name)}${filter.sql ? ` WHERE ${filter.sql}` : ""}`).all(...filter.values) as Record<string, JsonValue>[];
      for (const row of all) rows.push({ tableName: table.name, row });
    }
    return { kind: "snapshot", version: this.getVersion(), ...identity, ...(resetReason ? { resetReason } : {}), rows };
  }

  private readIncremental(version: number, identity: ReturnType<SyncEngine["getIdentity"]>, context: unknown): SyncResult {
    const filters = this.getFilters(context);
    const changes = getChangesSince(this.db, version);
    const grouped = new Map<string, (typeof changes)[number]>();
    for (const change of changes) if (this.tables.has(change.tableName)) grouped.set(`${change.tableName}\0${change.rowId}`, change);
    const tableOrder = new Map([...this.tables.keys()].map((name, index) => [name, index]));
    const final = [...grouped.values()].sort((a, b) => a.version - b.version || tableOrder.get(a.tableName)! - tableOrder.get(b.tableName)! || a.rowId.localeCompare(b.rowId) || a.operation.localeCompare(b.operation));
    const packets: SyncPacket[] = [];
    for (const change of final) {
      const table = this.tables.get(change.tableName)!;
      const clauses = filters?.[change.tableName];
      const previousVisible = clauses ? this.matches(change.previousRow, clauses) : true;
      const row = change.operation === "delete" ? undefined : this.db.prepare(`SELECT * FROM ${identifier(table.name)} WHERE ${identifier(table.primaryKey)} = ?`).get(change.rowId) as Record<string, JsonValue> | undefined;
      const currentVisible = clauses ? Boolean(row) && this.isVisibleInDb(table, change.rowId, clauses) : Boolean(row);
      if (!row) {
        if (previousVisible) packets.push({ version: change.version, tableName: change.tableName, rowId: change.rowId, operation: "delete" });
      } else if (currentVisible) {
        packets.push({ version: change.version, tableName: change.tableName, rowId: change.rowId, operation: change.operation, row });
      } else if (!currentVisible && previousVisible) {
        packets.push({ version: change.version, tableName: change.tableName, rowId: change.rowId, operation: "delete" });
      }
    }
    return { kind: "incremental", version: changes.at(-1)?.version ?? version, ...identity, packets };
  }

  private matches(row: Record<string, JsonValue> | undefined, clauses: SyncFilterClause[] | undefined): boolean {
    if (!clauses) return Boolean(row);
    if (!row) return false;
    return clauses.every((clause) => {
      const actual = row[clause.column] as any;
      const expected = clause.value as any;
      switch (clause.operator) {
        case "=": return actual === clause.value;
        case "!=": return actual !== clause.value;
        case "<": return actual < expected;
        case "<=": return actual <= expected;
        case ">": return actual > expected;
        case ">=": return actual >= expected;
        case "in": return (expected as JsonValue[]).includes(actual);
        case "isNull": return actual === null || actual === undefined;
      }
    });
  }

  private filterSql(clauses: SyncFilterClause[] | undefined): { sql: string; values: JsonValue[] } {
    if (!clauses?.length) return { sql: "", values: [] };
    const values: JsonValue[] = [];
    const parts = clauses.map((clause) => {
      const column = identifier(clause.column);
      if (clause.operator === "isNull") return `${column} IS NULL`;
      if (clause.operator === "in") {
        const list = clause.value as JsonValue[];
        values.push(...list);
        return `${column} IN (${list.map(() => "?").join(",")})`;
      }
      values.push(clause.value as JsonValue);
      return `${column} ${clause.operator} ?`;
    });
    return { sql: parts.join(" AND "), values };
  }

  private isVisibleInDb(table: SyncTable, rowId: string, clauses: SyncFilterClause[]): boolean {
    const filter = this.filterSql(clauses);
    const row = this.db.prepare(`SELECT 1 AS visible FROM ${identifier(table.name)} WHERE ${identifier(table.primaryKey)} = ?${filter.sql ? ` AND ${filter.sql}` : ""}`).get(rowId, ...filter.values) as { visible: number } | undefined;
    return row?.visible === 1;
  }
}

export class SyncSchemaMismatchError extends Error {
  readonly status = 409;
  constructor(readonly expected: { replicaId: string; schemaVersion: number; schemaFingerprint: string }) {
    super("Client and server synchronization schemas do not match");
    this.name = "SyncSchemaMismatchError";
  }
}
