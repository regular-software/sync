import { createServerFn } from "@tanstack/react-start";
import { SyncEngine } from "@regular-sync/server";
import type { SyncResult } from "@regular-sync/shared";
import { db } from "./db.server";
import { initializeSchema } from "./schema.server";

initializeSchema();

const sync = new SyncEngine(db);

sync.initialize();

sync.registerTable({
  name: "todos",
  primaryKey: "id",
});

export const pullSync = createServerFn({ method: "GET" })
  .validator((version: number) => version)
  .handler(async ({ data: version }): Promise<SyncResult> => {
    return sync.syncSince(version);
  });

export { sync };
