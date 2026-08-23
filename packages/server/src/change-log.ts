import type { Change } from "@regular-sync/shared";
import type Database from "better-sqlite3";

export function getChangesSince(
  db: Database.Database,
  version: number,
): Change[] {
  const rows = db
    .prepare(
      `
    SELECT
      version,
      table_name,
      row_id,
      operation
    FROM rs_changes
    WHERE version > ?
    ORDER BY version ASC
  `,
    )
    .all(version);

  return rows.map((row: any) => ({
    version: row.version,
    tableName: row.table_name,
    rowId: row.row_id,
    operation: row.operation,
  }));
}
