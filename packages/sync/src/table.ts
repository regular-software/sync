import type { SyncTable as SyncTableDefinition } from "@regular-software/sync-protocol";
import type { SyncStore } from "./store";

export class SyncTable<Row extends Record<string, unknown>> {
  constructor(
    readonly definition: SyncTableDefinition,
    private store: SyncStore,
    private subscribeToSync: (listener: () => void) => () => void,
    private startSync: () => Promise<void>,
  ) {}

  async getAll(): Promise<Row[]> {
    return this.store.getAll<Row>(this.definition);
  }

  subscribe(listener: () => void) {
    return this.subscribeToSync(listener);
  }

  start() {
    return this.startSync();
  }
}
