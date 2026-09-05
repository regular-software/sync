import {
  createSyncClient,
  IncompatibleSyncSchemaError,
  RetryableMutationError,
  RetryableSyncError,
  type MutationContext,
  type MutationPush,
  type MutationDefinition,
  type BuiltSyncClient,
  type SyncClientBuilder,
  type SyncTable,
  type TableDefinition,
  type Pull,
  type RetryOptions,
  type Subscribe,
} from "@regular-software/sync";

import { IndexedDbSyncStore } from "@regular-software/sync-indexeddb";

export type BrowserSyncOptions = {
  database: string;
  pull: Pull;
  push?: MutationPush;
  events?: string;
  eventsWithCredentials?: boolean;
  subscribe?: Subscribe;
  schemaVersion: number;
  retry?: RetryOptions;
};

type RegisteredTable = {
  name: string;
  definition: TableDefinition<any>;
};

type RegisteredMutation = {
  name: string;
  definition: MutationDefinition<any, any>;
};

export class BrowserSyncBuilder<
  Tables extends object = {},
  Mutations extends object = {},
> {
  private tables: RegisteredTable[] = [];
  private mutations: RegisteredMutation[] = [];

  constructor(private options: BrowserSyncOptions) {}

  register<Name extends string, Row extends Record<string, unknown>>(
    name: Name,
    definition: TableDefinition<Row>,
  ): BrowserSyncBuilder<
    Tables & {
      [Key in Name]: SyncTable<Row>;
    },
    Mutations
  > {
    this.tables.push({
      name,
      definition,
    });

    return this as BrowserSyncBuilder<
      Tables & {
        [Key in Name]: SyncTable<Row>;
      },
      Mutations
    >;
  }

  mutation<Name extends string, Input>(
    name: Name,
    definition: MutationDefinition<Tables, Input>,
  ): BrowserSyncBuilder<Tables, Mutations & { [Key in Name]: Input }> {
    this.mutations.push({ name, definition });

    return this as BrowserSyncBuilder<
      Tables,
      Mutations & { [Key in Name]: Input }
    >;
  }

  build(): () => Promise<BuiltSyncClient<Tables, Mutations>> {
    let syncPromise:
      | ReturnType<SyncClientBuilder<Tables, Mutations>["build"]>
      | undefined;

    const getSync = () => {
      syncPromise ??= this.create();

      return syncPromise;
    };

    return getSync;
  }

  private create() {
    const store = new IndexedDbSyncStore(this.options.database);

    let builder: SyncClientBuilder<any, any> = createSyncClient({
      store,
      pull: this.options.pull,
      push: this.options.push,
      schemaVersion: this.options.schemaVersion,
      retry: this.options.retry,

      connectivity: {
        getCurrent: () => (navigator.onLine ? "online" : "offline"),
        subscribe: (listener) => {
          const handleOnline = () => listener("online");
          const handleOffline = () => listener("offline");

          window.addEventListener("online", handleOnline);
          window.addEventListener("offline", handleOffline);

          return () => {
            window.removeEventListener("online", handleOnline);
            window.removeEventListener("offline", handleOffline);
          };
        },
      },

      subscribe: this.options.subscribe ?? ((onChange) => {
        const events = new EventSource(
          this.options.events ?? "/api/sync-events",
          { withCredentials: this.options.eventsWithCredentials ?? false },
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
      }),
    });

    for (const table of this.tables) {
      builder = builder.register(table.name, table.definition);
    }

    for (const mutation of this.mutations) {
      const definition = mutation.definition;

      builder = builder.mutation(mutation.name, {
        ...definition,
        execute: async (input: unknown, context: MutationContext) => {
          try {
            return await definition.execute(input, context);
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
      });
    }

    return builder.build() as ReturnType<
      SyncClientBuilder<Tables, Mutations>["build"]
    >;
  }
}

export function createBrowserSync(options: BrowserSyncOptions) {
  return new BrowserSyncBuilder(options);
}

export type HttpSyncOptions = {
  url?: string;
  fetch?: typeof globalThis.fetch;
  credentials?: RequestCredentials;
  headers?: HeadersInit;
};

export function createHttpPull(options: HttpSyncOptions = {}): Pull {
  const fetchImplementation = options.fetch ?? globalThis.fetch;

  return async (request) => {
    const url = new URL(options.url ?? "/api/sync", globalThis.location?.href);
    url.searchParams.set("version", String(request.version));
    if (request.replicaId) url.searchParams.set("replicaId", request.replicaId);
    url.searchParams.set("schemaVersion", String(request.schemaVersion));
    url.searchParams.set("schemaFingerprint", request.schemaFingerprint);

    let response: Response;

    try {
      response = await fetchImplementation(url, {
        credentials: options.credentials,
        headers: options.headers,
      });
    } catch (error) {
      throw new RetryableSyncError("Sync request could not reach the server", {
        cause: error,
      });
    }

    if (response.status === 409) {
      throw new IncompatibleSyncSchemaError(
        "Client and server synchronization schemas do not match",
      );
    }

    if (!response.ok) {
      const error = createHttpError(response, "Sync request failed");
      if (isRetryableStatus(response.status)) {
        throw new RetryableSyncError(error.message, { cause: error });
      }
      throw new IncompatibleSyncSchemaError(error.message);
    }

    let value: unknown;
    try {
      value = await response.json();
    } catch (error) {
      throw new RetryableSyncError("Sync response could not be read", {
        cause: error,
      });
    }

    if (!isSyncResult(value)) {
      throw new IncompatibleSyncSchemaError("Sync response is malformed");
    }

    return value;
  };
}

export function createHttpMutation<Input>(options: {
  url: string;
  fetch?: typeof globalThis.fetch;
  credentials?: RequestCredentials;
  headers?: HeadersInit;
}): MutationDefinition<object, Input>["execute"] {
  const fetchImplementation = options.fetch ?? globalThis.fetch;

  return async (input, { mutationId }) => {
    let response: Response;

    try {
      response = await fetchImplementation(options.url, {
        method: "POST",
        credentials: options.credentials,
        headers: mergeHeaders(
          { "Content-Type": "application/json" },
          options.headers,
        ),
        body: JSON.stringify({ mutationId, input }),
      });
    } catch (error) {
      throw new RetryableMutationError(
        "Mutation request could not reach the server",
        { cause: error },
      );
    }

    if (!response.ok) {
      const error = createHttpError(response, "Mutation request failed");
      if (isRetryableStatus(response.status)) {
        throw new RetryableMutationError(error.message, { cause: error });
      }
      throw error;
    }

    let value: unknown;
    try {
      value = await response.json();
    } catch (error) {
      throw new RetryableMutationError("Mutation response could not be read", {
        cause: error,
      });
    }

    if (
      !isRecord(value) ||
      !Number.isSafeInteger(value.version) ||
      value.version < 0
    ) {
      throw new RetryableMutationError(
        "Mutation response did not contain a valid version",
      );
    }

    return { version: value.version as number };
  };
}

export function createHttpMutationBatch(options: {
  url: string;
  fetch?: typeof globalThis.fetch;
  credentials?: RequestCredentials;
  headers?: HeadersInit;
}): MutationPush {
  const fetchImplementation = options.fetch ?? globalThis.fetch;
  return async (mutations) => {
    let response: Response;
    try {
      response = await fetchImplementation(options.url, {
        method: "POST",
        credentials: options.credentials,
        headers: mergeHeaders({ "Content-Type": "application/json" }, options.headers),
        body: JSON.stringify({ mutations }),
      });
    } catch (error) {
      throw new RetryableMutationError("Mutation batch request could not reach the server", { cause: error });
    }
    if (!response.ok) {
      const error = createHttpError(response, "Mutation batch request failed");
      if (isRetryableStatus(response.status)) throw new RetryableMutationError(error.message, { cause: error });
      throw error;
    }
    const value = await response.json() as unknown;
    if (!isRecord(value) || !Array.isArray(value.mutations) || !value.mutations.every((item: unknown) => isRecord(item) && typeof item.id === "string" && Number.isSafeInteger(item.version) && item.version >= 0)) {
      throw new RetryableMutationError("Mutation batch response is malformed");
    }
    return value.mutations as Array<{ id: string; version: number }>;
  };
}

function mergeHeaders(defaults: HeadersInit, configured?: HeadersInit) {
  const headers = new Headers(defaults);

  if (configured) {
    new Headers(configured).forEach((value, name) => {
      headers.set(name, value);
    });
  }

  return headers;
}

function createHttpError(response: Response, message: string) {
  const error = new Error(`${message} with status ${response.status}`) as Error & {
    status: number;
  };
  error.status = response.status;
  return error;
}

function isRetryableStatus(status: number) {
  return (
    status === 401 ||
    status === 403 ||
    status === 408 ||
    status === 425 ||
    status === 429 ||
    status >= 500
  );
}

function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === "object" && value !== null;
}

function isSyncResult(value: unknown): value is Awaited<ReturnType<Pull>> {
  if (
    !isRecord(value) ||
    (value.kind !== "snapshot" && value.kind !== "incremental") ||
    !Number.isSafeInteger(value.version) ||
    value.version < 0 ||
    typeof value.replicaId !== "string" ||
    !Number.isSafeInteger(value.schemaVersion) ||
    value.schemaVersion <= 0 ||
    typeof value.schemaFingerprint !== "string" ||
    (value.kind === "snapshot" ? !Array.isArray(value.rows) : !Array.isArray(value.packets))
  ) {
    return false;
  }

  if (value.kind === "snapshot") {
    if (!value.rows.every(
      (entry: unknown) =>
        isRecord(entry) &&
        typeof entry.tableName === "string" &&
        isRecord(entry.row),
    )) return false;
    return (
      value.resetReason === undefined ||
      value.resetReason === "replica-changed" ||
      value.resetReason === "cursor-ahead" ||
      value.resetReason === "cursor-expired"
    );
  }

  return value.packets.every(
    (entry: unknown) =>
      isRecord(entry) &&
      Number.isSafeInteger(entry.version) &&
      typeof entry.tableName === "string" &&
      typeof entry.rowId === "string" &&
      (entry.operation === "delete" ||
        ((entry.operation === "insert" || entry.operation === "update") &&
          isRecord(entry.row))),
  );
}
