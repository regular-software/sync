import type Database from "better-sqlite3";

import type { SyncTable } from "@regular-sync/shared";

export function getRow<Row extends Record<string, unknown>>(
  db: Database.Database,
  table: SyncTable,
  rowId: string,
): Row | undefined {
  return db
    .prepare(
      `
      SELECT *
      FROM ${table.name}
      WHERE ${table.primaryKey} = ?
    `,
    )
    .get(rowId) as Row | undefined;
}

export function getAllRows<Row extends Record<string, unknown>>(
  db: Database.Database,
  table: SyncTable,
): Row[] {
  return db
    .prepare(
      `
      SELECT *
      FROM ${table.name}
    `,
    )
    .all() as Row[];
}

export function putRow(
  db: Database.Database,
  table: SyncTable,
  row: Record<string, unknown>,
): void {
  const columns = Object.keys(row);

  const placeholders = columns.map(() => "?").join(", ");

  const updates = columns
    .filter((column) => column !== table.primaryKey)
    .map((column) => `${column} = excluded.${column}`)
    .join(", ");

  db.prepare(
    `
    INSERT INTO ${table.name}
      (${columns.join(", ")})
    VALUES
      (${placeholders})
    ON CONFLICT(${table.primaryKey})
    DO UPDATE SET
      ${updates}
  `,
  ).run(...Object.values(row));
}

export function deleteRow(
  db: Database.Database,
  table: SyncTable,
  rowId: string,
): void {
  db.prepare(
    `
    DELETE FROM ${table.name}
    WHERE ${table.primaryKey} = ?
  `,
  ).run(rowId);
}
