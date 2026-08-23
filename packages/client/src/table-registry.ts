import type { SyncTable } from "@regular-sync/shared";

export class TableRegistry {
  private tables = new Map<string, SyncTable>();

  register(table: SyncTable) {
    this.tables.set(table.name, table);
  }

  get(name: string): SyncTable {
    const table = this.tables.get(name);

    if (!table) {
      throw new Error(`Table "${name}" is not registered`);
    }

    return table;
  }

  find(name: string): SyncTable | undefined {
    return this.tables.get(name);
  }
}
