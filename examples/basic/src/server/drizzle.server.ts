import { drizzle } from "drizzle-orm/better-sqlite3";

import { sqlite } from "./db.server";
import * as schema from "./drizzle-schema.server";

export const db = drizzle({ client: sqlite, schema });
