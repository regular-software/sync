import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { syncTables } from "../sync-tables";

export const invoices = sqliteTable(syncTables.invoices.name, {
  id: text("id").primaryKey(),
  number: text("number").notNull(),
  customer: text("customer").notNull(),
  status: text("status").notNull(),
  paymentMethod: text("paymentMethod").notNull(),
  totalCents: integer("totalCents").notNull(),
});

export const invoiceLines = sqliteTable(syncTables.invoiceLines.name, {
  id: text("id").primaryKey(),
  invoiceId: text("invoiceId").notNull(),
  position: integer("position").notNull(),
  description: text("description").notNull(),
  quantity: integer("quantity").notNull(),
  unitPriceCents: integer("unitPriceCents").notNull(),
});
