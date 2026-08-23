import { SyncEngine } from "@regular-sync/server";
import { db } from "./db.server";
import { initializeSchema } from "./schema.server";

initializeSchema();

const sync = new SyncEngine(db);

sync.initialize();

sync.registerTable({
  name: "todos",
  primaryKey: "id",
});

export { sync };
