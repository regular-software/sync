import Database from "better-sqlite3";

export const sqlite = new Database("basic.db");

sqlite.pragma("foreign_keys = ON");
