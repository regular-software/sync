import {
  createBrowserSync,
  createHttpMutation,
  createHttpPull,
} from "@regular-software/sync-browser";
import { defineTable } from "@regular-software/sync";

import type {
  CreateInvoiceInput,
  Invoice,
  InvoiceLine,
} from "../invoices";
import { syncTables } from "../sync-tables";

const invoices = defineTable<Invoice>(syncTables.invoices);

const invoiceLines = defineTable<InvoiceLine>(syncTables.invoiceLines);

export const getSync = createBrowserSync({
  database: "regular-sync-invoices",
  schemaVersion: 1,
  pull: createHttpPull(),
})
  .register(syncTables.invoices.name, invoices)
  .register(syncTables.invoiceLines.name, invoiceLines)
  .mutation("createInvoice", {
    optimistic: (input: CreateInvoiceInput, transaction) => {
      transaction.put(syncTables.invoices.name, input.invoice);

      for (const line of input.lines) {
        transaction.put(syncTables.invoiceLines.name, line);
      }
    },

    execute: createHttpMutation<CreateInvoiceInput>({
      url: "/api/mutations/create-invoice",
    }),
  })
  .build();
