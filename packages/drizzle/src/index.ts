import { SyncEngine } from "@regular-software/sync-server";
import { getTableName } from "drizzle-orm";

import type Database from "better-sqlite3";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import type { Table } from "drizzle-orm";
import type { SyncRequest, SyncResult } from "@regular-software/sync-protocol";

export type DrizzleSyncOptions<Schema extends Record<string, unknown>> = {
  db: BetterSQLite3Database<Schema>;
  sqlite: Database.Database;
  onVersion?: (version: number) => void;
  schemaVersion: number;
};

export type DrizzleSync<Schema extends Record<string, unknown>> = {
  db: BetterSQLite3Database<Schema>;
  engine: SyncEngine;
  initialize(): void;
  registerTable(table: Table, primaryKey: string): void;
  mutate(mutation: {
    id: string;
    run: (db: BetterSQLite3Database<Schema>) => void;
  }): number;
  getVersion(): number;
  syncSince(request: SyncRequest): SyncResult;
};

export function createDrizzleSync<Schema extends Record<string, unknown>>(
  options: DrizzleSyncOptions<Schema>,
): DrizzleSync<Schema> {
  const engine = new SyncEngine(options.sqlite, {
    schemaVersion: options.schemaVersion,
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
      });

      options.onVersion?.(version);
      return version;
    },
    getVersion() {
      return engine.getVersion();
    },
    syncSince(version) {
      return engine.syncSince(version);
    },
  };
}
