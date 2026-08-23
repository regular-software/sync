import type { SyncTable as SyncTableDefinition } from "@regular-sync/shared";
import type { SyncStore } from "./store";

export class SyncTable<Row extends Record<string, unknown>> {
  constructor(
    readonly definition: SyncTableDefinition,
    private store: SyncStore,
    private mutateRow: (row: Row) => Promise<void>,
    private subscribeToSync: (listener: () => void) => () => void,
    private startSync: () => Promise<void>,
  ) {}

  async getAll(): Promise<Row[]> {
    return this.store.getAll<Row>(this.definition);
  }

  async mutate(row: Row): Promise<void> {
    return this.mutateRow(row);
  }

  subscribe(listener: () => void) {
    return this.subscribeToSync(listener);
  }

  start() {
    return this.startSync();
  }
}
