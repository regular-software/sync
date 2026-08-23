import type { SyncResult, SyncTable } from "@regular-software/sync-protocol";
import { RetryableMutationError } from "./errors";
import type { SyncStore } from "./store";
import type { MutationContext } from "./define-table";

export type Pull = (version: number) => Promise<SyncResult>;

export type Subscribe = (onChange: () => void) => () => void;

export type SyncClientOptions = {
  pull: Pull;
  store: SyncStore;
  subscribe?: Subscribe;
};

type MutationHandler = (
  row: Record<string, unknown>,
  context: MutationContext,
) => Promise<void>;

export class SyncClient {
  private listeners = new Set<() => void>();
  private mutationHandlers = new Map<string, MutationHandler>();
  private syncPromise?: Promise<void>;
  private syncRequested = false;
  private unsubscribeFromServer?: () => void;

  constructor(private options: SyncClientOptions) {}

  registerMutationHandler<Row extends Record<string, unknown>>(
    tableName: string,
    handler: (row: Row, context: MutationContext) => Promise<void>,
  ) {
    this.mutationHandlers.set(tableName, handler as MutationHandler);
  }

  async pull() {
    const version = await this.options.store.getVersion();

    const result = await this.options.pull(version);

    await this.options.store.apply(result);

    if (result.version !== version) {
      this.notify();
    }

    return result;
  }

  async start() {
    if (this.options.subscribe && !this.unsubscribeFromServer) {
      this.unsubscribeFromServer = this.options.subscribe(() => {
        void this.sync().catch(() => {
          // A later SSE or online event will retry synchronization.
        });
      });
    }

    await this.sync();
  }

  private sync(): Promise<void> {
    this.syncRequested = true;

    if (!this.syncPromise) {
      this.syncPromise = this.runSyncLoop();
    }

    return this.syncPromise;
  }

  private async runSyncLoop(): Promise<void> {
    try {
      do {
        this.syncRequested = false;

        await this.flushMutations();
        await this.pull();
      } while (this.syncRequested);
    } finally {
      this.syncPromise = undefined;
    }
  }

  stop() {
    this.unsubscribeFromServer?.();
    this.unsubscribeFromServer = undefined;
  }

  subscribe(listener: () => void) {
    this.listeners.add(listener);

    return () => {
      this.listeners.delete(listener);
    };
  }

  notify() {
    for (const listener of this.listeners) {
      listener();
    }
  }

  async mutate<Row extends Record<string, unknown>>(
    table: SyncTable,
    row: Row,
  ): Promise<void> {
    const handler = this.mutationHandlers.get(table.name);

    if (!handler) {
      throw new Error(`No mutation configured for table "${table.name}"`);
    }

    const rowId = row[table.primaryKey];

    if (typeof rowId !== "string") {
      throw new Error(`Primary key "${table.primaryKey}" must be a string`);
    }

    const mutationId = crypto.randomUUID();
    const previous = await this.options.store.get<Row>(table, rowId);

    await this.options.store.put(table, row);
    this.notify();

    try {
      await handler(row, { mutationId });
    } catch (error) {
      if (
        error instanceof RetryableMutationError &&
        this.options.store.mutations
      ) {
        await this.options.store.mutations.add({
          id: mutationId,
          tableName: table.name,
          row,
          createdAt: Date.now(),
        });

        return;
      }

      if (previous) {
        await this.options.store.put(table, previous);
      } else {
        await this.options.store.delete(table, rowId);
      }

      this.notify();

      throw error;
    }
  }

  async flushMutations(): Promise<void> {
    const mutationStore = this.options.store.mutations;

    if (!mutationStore) {
      return;
    }

    const queued = await mutationStore.getAll();

    for (const mutation of queued) {
      const handler = this.mutationHandlers.get(mutation.tableName);

      if (!handler) {
        continue;
      }

      try {
        await handler(mutation.row, {
          mutationId: mutation.id,
        });

        await mutationStore.remove(mutation.id);
      } catch (error) {
        if (error instanceof RetryableMutationError) {
          return;
        }
        throw error;
      }
    }
  }
}
