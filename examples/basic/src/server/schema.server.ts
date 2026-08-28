import { sqlite } from "./db.server";

export function initializeSchema() {
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS invoices (
      id TEXT PRIMARY KEY,
      number TEXT NOT NULL,
      customer TEXT NOT NULL,
      status TEXT NOT NULL,
      paymentMethod TEXT NOT NULL,
      totalCents INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS invoiceLines (
      id TEXT PRIMARY KEY,
      invoiceId TEXT NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
      position INTEGER NOT NULL,
      description TEXT NOT NULL,
      quantity INTEGER NOT NULL,
      unitPriceCents INTEGER NOT NULL
    );
  `);

  const invoiceLineColumns = sqlite
    .prepare("PRAGMA table_info(invoiceLines)")
    .all() as { name: string }[];

  if (!invoiceLineColumns.some((column) => column.name === "position")) {
    sqlite.exec(
      "ALTER TABLE invoiceLines ADD COLUMN position INTEGER NOT NULL DEFAULT 0",
    );
  }
}
