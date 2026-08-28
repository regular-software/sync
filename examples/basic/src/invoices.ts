export type InvoiceStatus = "draft" | "sent" | "paid";

export type PaymentMethod =
  | "bank_transfer"
  | "credit_card"
  | "paypal";

export type Invoice = {
  id: string;
  number: string;
  customer: string;
  status: InvoiceStatus;
  paymentMethod: PaymentMethod;
  totalCents: number;
};

export type InvoiceLine = {
  id: string;
  invoiceId: string;
  position: number;
  description: string;
  quantity: number;
  unitPriceCents: number;
};

export type CreateInvoiceInput = {
  invoice: Invoice;
  lines: InvoiceLine[];
};

export function calculateInvoiceTotal(lines: InvoiceLine[]): number {
  return lines.reduce(
    (total, line) => total + line.quantity * line.unitPriceCents,
    0,
  );
}
