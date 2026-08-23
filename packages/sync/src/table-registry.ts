import type { SyncTable } from "@regular-sync/shared";

export class TableRegistry {
  private tables = new Map<string, SyncTable>();

  register(table: SyncTable) {
    this.tables.set(table.name, table);
  }

  find(name: string): SyncTable | undefined {
    return this.tables.get(name);
  }
}
