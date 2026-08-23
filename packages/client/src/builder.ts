import type { SyncTable as SyncTableDefinition } from "@regular-sync/shared";
import { SyncClient } from "./client";
import type { SyncClientOptions } from "./client";
import { SyncTable } from "./table";
import type { TableDefinition } from "./define-table";

export type BuiltSyncClient<Tables> = Tables & {
  pull(): Promise<void>;
  start(): Promise<void>;
  stop(): void;
  subscribe(listener: () => void): () => void;
};

export class SyncClientBuilder<Tables extends object = {}> {
  private tables: Record<
    string,
    {
      syncDefinition: SyncTableDefinition;
      definition: TableDefinition<any>;
    }
  > = {};

  constructor(private options: SyncClientOptions) {}

  register<Name extends string, Row extends Record<string, unknown>>(
    name: Name,
    definition: TableDefinition<Row>,
  ): SyncClientBuilder<
    Tables & {
      [Key in Name]: SyncTable<Row>;
    }
  > {
    this.tables[name] = {
      syncDefinition: {
        name,
        primaryKey: definition.primaryKey,
      },
      definition,
    };

    return this as SyncClientBuilder<
      Tables & {
        [Key in Name]: SyncTable<Row>;
      }
    >;
  }

  async build(): Promise<BuiltSyncClient<Tables>> {
    const result: Record<string, unknown> = {};

    const client = new SyncClient(this.options);

    for (const table of Object.values(this.tables)) {
      const definition = table.syncDefinition;

      await this.options.store.registerTable(definition);

      if (table.definition.mutations?.mutate) {
        client.registerMutationHandler(
          definition.name,
          table.definition.mutations.mutate,
        );
      }

      result[definition.name] = new SyncTable(
        definition,
        this.options.store,
        (row) => client.mutate(definition, row),
        (listener) => client.subscribe(listener),
        () => client.start(),
      );
    }

    result.pull = async () => {
      await client.pull();
    };

    result.start = async () => {
      await client.start();
    };

    result.stop = () => {
      client.stop();
    };

    result.subscribe = (listener: () => void) => {
      return client.subscribe(listener);
    };

    return result as BuiltSyncClient<Tables>;
  }
}
