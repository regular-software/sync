import type Database from "better-sqlite3";

export function initializeMetadata(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS rs_client_state (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      version INTEGER NOT NULL
    );

    INSERT OR IGNORE INTO rs_client_state (id, version)
    VALUES (1, 0);
  `);
}

export function getVersion(db: Database.Database): number {
  const row = db
    .prepare(
      `
      SELECT version
      FROM rs_client_state
      WHERE id = 1
    `,
    )
    .get() as { version: number };

  return row.version;
}

export function setVersion(db: Database.Database, version: number): void {
  db.prepare(
    `
      UPDATE rs_client_state
      SET version = ?
      WHERE id = 1
    `,
  ).run(version);
}
