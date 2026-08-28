import type { SyncTable } from "@regular-software/sync-protocol";

export const syncTables = {
  invoices: {
    name: "invoices",
    primaryKey: "id",
  },
  invoiceLines: {
    name: "invoiceLines",
    primaryKey: "id",
  },
} as const satisfies Record<string, SyncTable>;
