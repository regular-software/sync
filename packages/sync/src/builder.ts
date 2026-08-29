import type { SyncTable as SyncTableDefinition } from "@regular-software/sync-protocol";
import { SyncClient } from "./client";
import type { SyncClientOptions } from "./client";
import { SyncTable } from "./table";
import type { TableDefinition } from "./define-table";
import {
  collectOptimisticEffects,
  type MutationDefinition,
} from "./mutation";
import type { SyncStatus } from "./status";

type BuiltMutations<Mutations> = {
  [Name in keyof Mutations]: (input: Mutations[Name]) => Promise<void>;
};

export type BuiltSyncClient<Tables, Mutations> = Tables & {
  mutations: BuiltMutations<Mutations>;
  pull(): Promise<void>;
  start(): Promise<void>;
  stop(): void;
  subscribe(listener: () => void): () => void;
  getStatus(): SyncStatus;
  subscribeStatus(listener: () => void): () => void;
  getMutationFailures(): ReturnType<SyncClient["getMutationFailures"]>;
  acknowledgeMutationFailure(id: string): Promise<void>;
  subscribeMutationFailures(listener: () => void): () => void;
};

export class SyncClientBuilder<
  Tables extends object = {},
  Mutations extends object = {},
> {
  private tables: Record<
    string,
    {
      syncDefinition: SyncTableDefinition;
    }
  > = {};
  private mutationDefinitions: Record<
    string,
    MutationDefinition<any, any>
  > = {};

  constructor(private options: SyncClientOptions) {}

  register<Name extends string, Row extends Record<string, unknown>>(
    name: Name,
    definition: TableDefinition<Row>,
  ): SyncClientBuilder<
    Tables & {
      [Key in Name]: SyncTable<Row>;
    },
    Mutations
  > {
    this.tables[name] = {
      syncDefinition: {
        name,
        primaryKey: definition.primaryKey,
      },
    };

    return this as SyncClientBuilder<
      Tables & {
        [Key in Name]: SyncTable<Row>;
      },
      Mutations
    >;
  }

  mutation<Name extends string, Input>(
    name: Name,
    definition: MutationDefinition<Tables, Input>,
  ): SyncClientBuilder<Tables, Mutations & { [Key in Name]: Input }> {
    this.mutationDefinitions[name] = definition;

    return this as SyncClientBuilder<
      Tables,
      Mutations & { [Key in Name]: Input }
    >;
  }

  async build(): Promise<BuiltSyncClient<Tables, Mutations>> {
    const result: Record<string, unknown> = {};

    const client = new SyncClient(this.options);

    await this.options.store.initializeSchema({
      schemaVersion: this.options.schemaVersion,
      tables: Object.values(this.tables).map((table) => table.syncDefinition),
    });

    for (const table of Object.values(this.tables)) {
      const definition = table.syncDefinition;

      result[definition.name] = new SyncTable(
        definition,
        this.options.store,
        (listener) => client.subscribe(listener),
        () => client.start(),
      );
    }

    const mutations: Record<string, (input: unknown) => Promise<void>> = {};

    for (const [name, definition] of Object.entries(
      this.mutationDefinitions,
    )) {
      client.registerMutationHandler(name, definition.execute);

      mutations[name] = (input) => {
        const context = { mutationId: crypto.randomUUID() };
        const effects = collectOptimisticEffects(definition, input, context);

        return client.mutate(name, input, effects, context);
      };
    }

    await client.initialize();

    result.mutations = mutations;

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

    result.getStatus = () => client.getStatus();

    result.subscribeStatus = (listener: () => void) => {
      return client.subscribeStatus(listener);
    };

    result.getMutationFailures = () => client.getMutationFailures();

    result.acknowledgeMutationFailure = (id: string) =>
      client.acknowledgeMutationFailure(id);

    result.subscribeMutationFailures = (listener: () => void) =>
      client.subscribeMutationFailures(listener);

    return result as BuiltSyncClient<Tables, Mutations>;
  }
}
