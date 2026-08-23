import {
  createSyncClient,
  RetryableMutationError,
  type MutationContext,
  type SyncClientBuilder,
  type SyncTable,
  type TableDefinition,
  type Pull,
} from "@regular-software/sync";

import { IndexedDbSyncStore } from "@regular-software/sync-indexeddb";

type BrowserSyncOptions = {
  database: string;
  pull: Pull;
  events?: string;
};

type RegisteredTable = {
  name: string;
  definition: TableDefinition<any>;
};

export class BrowserSyncBuilder<Tables extends object = {}> {
  private tables: RegisteredTable[] = [];

  constructor(private options: BrowserSyncOptions) {}

  register<Name extends string, Row extends Record<string, unknown>>(
    name: Name,
    definition: TableDefinition<Row>,
  ): BrowserSyncBuilder<
    Tables & {
      [Key in Name]: SyncTable<Row>;
    }
  > {
    this.tables.push({
      name,
      definition,
    });

    return this as BrowserSyncBuilder<
      Tables & {
        [Key in Name]: SyncTable<Row>;
      }
    >;
  }

  build() {
    let syncPromise: ReturnType<SyncClientBuilder<Tables>["build"]> | undefined;

    const getSync = () => {
      syncPromise ??= this.create();

      return syncPromise;
    };

    return getSync;
  }

  private create() {
    const store = new IndexedDbSyncStore(this.options.database);

    let builder = createSyncClient({
      store,
      pull: this.options.pull,

      subscribe: (onChange) => {
        const events = new EventSource(
          this.options.events ?? "/api/sync-events",
        );

        events.onopen = () => {
          onChange();
        };

        events.onmessage = () => {
          onChange();
        };

        const handleOnline = () => {
          onChange();
        };

        window.addEventListener("online", handleOnline);

        return () => {
          events.close();

          window.removeEventListener("online", handleOnline);
        };
      },
    });

    for (const table of this.tables) {
      const originalMutation = table.definition.mutations?.mutate;

      const definition = {
        ...table.definition,

        mutations: originalMutation
          ? {
              ...table.definition.mutations,

              mutate: async (
                row: Record<string, unknown>,
                context: MutationContext,
              ) => {
                try {
                  await originalMutation(row, context);
                } catch (error) {
                  if (!navigator.onLine) {
                    throw new RetryableMutationError(
                      "Mutation failed while offline",
                      {
                        cause: error,
                      },
                    );
                  }

                  throw error;
                }
              },
            }
          : undefined,
      };

      builder = builder.register(table.name, definition) as typeof builder;
    }

    return builder.build() as ReturnType<SyncClientBuilder<Tables>["build"]>;
  }
}

export function createBrowserSync(options: BrowserSyncOptions) {
  return new BrowserSyncBuilder(options);
}
