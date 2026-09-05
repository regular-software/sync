import { SyncEngine } from "@regular-software/sync-server";
import { getTableName } from "drizzle-orm";

import type Database from "better-sqlite3";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import type { Table } from "drizzle-orm";
import type { SyncFilterSet, SyncRequest, SyncResult } from "@regular-software/sync-protocol";

export type DrizzleSyncOptions<Schema extends Record<string, unknown>> = {
  db: BetterSQLite3Database<Schema>;
  sqlite: Database.Database;
  onVersion?: (version: number) => void;
  schemaVersion: number;
  filters?: (context: unknown) => SyncFilterSet | undefined;
};

export type DrizzleSync<Schema extends Record<string, unknown>> = {
  db: BetterSQLite3Database<Schema>;
  engine: SyncEngine;
  initialize(): void;
  registerTable(table: Table, primaryKey: string): void;
  mutate(mutation: {
    id: string;
    run: (db: BetterSQLite3Database<Schema>) => void;
    auditHook?: (db: BetterSQLite3Database<Schema>, version: number) => void;
  }): number;
  mutateBatch(mutations: Array<{
    id: string;
    run: (db: BetterSQLite3Database<Schema>) => void;
    auditHook?: (db: BetterSQLite3Database<Schema>, version: number) => void;
  }>): Array<{ id: string; version: number }>;
  getVersion(): number;
  syncSince(request: SyncRequest, context?: unknown): SyncResult;
  compactChanges(beforeVersion: number): void;
};

export function createDrizzleSync<Schema extends Record<string, unknown>>(
  options: DrizzleSyncOptions<Schema>,
): DrizzleSync<Schema> {
  const engine = new SyncEngine(options.sqlite, {
    schemaVersion: options.schemaVersion,
    filters: options.filters,
  });

  return {
    db: options.db,
    engine,
    initialize() {
      engine.initialize();
    },
    registerTable(table, primaryKey) {
      engine.registerTable({ name: getTableName(table), primaryKey });
    },
    mutate(mutation) {
      const version = engine.mutate({
        id: mutation.id,
        run: () => mutation.run(options.db),
        auditHook: mutation.auditHook ? (version) => mutation.auditHook!(options.db, version) : undefined,
      });

      options.onVersion?.(version);
      return version;
    },
    mutateBatch(mutations) {
      const result = engine.mutateBatch(mutations.map((mutation) => ({
        id: mutation.id,
        run: () => mutation.run(options.db),
        auditHook: mutation.auditHook ? (version: number) => mutation.auditHook!(options.db, version) : undefined,
      })));
      options.onVersion?.(result.at(-1)?.version ?? engine.getVersion());
      return result;
    },
    getVersion() {
      return engine.getVersion();
    },
    syncSince(request, context) {
      return engine.syncSince(request, context);
    },
    compactChanges(beforeVersion) {
      engine.compactChanges(beforeVersion);
    },
  };
}
