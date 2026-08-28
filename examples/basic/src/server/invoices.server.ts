import {
  calculateInvoiceTotal,
  type CreateInvoiceInput,
} from "../invoices";
import { invoiceLines, invoices } from "./drizzle-schema.server";
import { sync } from "./sync.server";

export function createInvoiceOnServer(
  mutationId: string,
  input: CreateInvoiceInput,
) {
  const totalCents = calculateInvoiceTotal(input.lines);

  const version = sync.mutate({
    id: mutationId,

    run: (db) => {
      db.insert(invoices)
        .values({
          id: input.invoice.id,
          number: input.invoice.number,
          customer: input.invoice.customer,
          status: input.invoice.status,
          paymentMethod: input.invoice.paymentMethod,
          totalCents,
        })
        .run();

      for (const line of input.lines) {
        db.insert(invoiceLines)
          .values({
            id: line.id,
            invoiceId: input.invoice.id,
            position: line.position,
            description: line.description,
            quantity: line.quantity,
            unitPriceCents: line.unitPriceCents,
          })
          .run();
      }
    },
  });

  return { version };
}
