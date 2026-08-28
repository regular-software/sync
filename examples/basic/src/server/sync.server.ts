import { createDrizzleSync } from "@regular-software/sync-drizzle";
import { SyncEventHub } from "@regular-software/sync-hono";
import { sqlite } from "./db.server";
import { db } from "./drizzle.server";
import { invoiceLines, invoices } from "./drizzle-schema.server";
import { initializeSchema } from "./schema.server";
import { syncTables } from "../sync-tables";

initializeSchema();

const events = new SyncEventHub();
const sync = createDrizzleSync({
  db,
  sqlite,
  onVersion: (version) => events.publish(version),
  schemaVersion: 1,
});

sync.initialize();

sync.registerTable(invoices, syncTables.invoices.primaryKey);
sync.registerTable(invoiceLines, syncTables.invoiceLines.primaryKey);

export { events, sync };
