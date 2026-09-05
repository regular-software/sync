import assert from "node:assert/strict";
import test from "node:test";
import type {
  SyncRequest,
  SyncResult,
  SyncTable,
} from "@regular-software/sync-protocol";
import { SyncClient } from "./client";
import { IncompatibleSyncSchemaError, RetryableMutationError } from "./errors";
import type {
  MutationFailure,
  MutationStore,
  QueuedMutation,
  SyncStore,
} from "./store";

const identity = {
  replicaId: "replica-1",
  schemaVersion: 1,
  schemaFingerprint: "[]",
};

function snapshot(version: number): SyncResult {
  return { kind: "snapshot", version, ...identity, rows: [] };
}

function incremental(version: number): SyncResult {
  return { kind: "incremental", version, ...identity, packets: [] };
}

class MemoryMutationStore implements MutationStore {
  mutations: QueuedMutation[] = [];
  failures: MutationFailure[] = [];

  async add(mutation: QueuedMutation): Promise<void> {
    this.mutations.push(mutation);
  }

  async acknowledge(id: string, version: number): Promise<void> {
    const mutation = this.mutations.find((entry) => entry.id === id);
    if (mutation) mutation.acknowledgedVersion = version;
  }

  async remove(id: string): Promise<void> {
    this.mutations = this.mutations.filter((entry) => entry.id !== id);
  }

  async fail(id: string, failure: MutationFailure): Promise<void> {
    this.mutations = this.mutations.filter((entry) => entry.id !== id);
    this.failures.push(failure);
  }

  async getAll(): Promise<QueuedMutation[]> {
    return this.mutations;
  }

  async getFailures(): Promise<MutationFailure[]> {
    return this.failures;
  }

  async acknowledgeFailure(id: string): Promise<void> {
    this.failures = this.failures.filter((entry) => entry.id !== id);
  }
}

class MemorySyncStore implements SyncStore {
  request: SyncRequest = {
    version: 0,
    schemaVersion: 1,
    schemaFingerprint: "[]",
  };
  appliedVersions: number[] = [];
  mutations = new MemoryMutationStore();

  async initializeSchema(): Promise<void> {}

  async getSyncRequest(): Promise<SyncRequest> {
    return this.request;
  }

  async apply(result: SyncResult) {
    this.request = {
      version: result.version,
      replicaId: result.replicaId,
      schemaVersion: result.schemaVersion,
      schemaFingerprint: result.schemaFingerprint,
    };
    this.appliedVersions.push(result.version);
    this.mutations.mutations = this.mutations.mutations.filter(
      (mutation) =>
        mutation.acknowledgedVersion === undefined ||
        mutation.acknowledgedVersion > result.version,
    );
    return {
      changed: true,
      confirmedMutationIds: [],
      reset: result.kind === "snapshot" && result.resetReason !== undefined,
    };
  }

  async getAll<Row extends Record<string, unknown>>(): Promise<Row[]> {
    return [];
  }

  async get<Row extends Record<string, unknown>>(
    _table: SyncTable,
    _rowId: string,
  ): Promise<Row | undefined> {
    return undefined;
  }
}

function clientOptions(store: MemorySyncStore, pull: (request: SyncRequest) => Promise<SyncResult>) {
  return {
    store,
    pull,
    schemaVersion: 1,
    retry: { initialDelayMs: 0, maximumDelayMs: 0, jitter: 0 },
  };
}

async function waitFor(predicate: () => boolean): Promise<void> {
  for (let index = 0; index < 100; index += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
  assert.fail("Condition was not reached");
}

test("pulls execute serially and read the latest cursor", async () => {
  const store = new MemorySyncStore();
  const requestedVersions: number[] = [];
  let resolveFirst: ((result: SyncResult) => void) | undefined;
  const firstResult = new Promise<SyncResult>((resolve) => {
    resolveFirst = resolve;
  });
  const client = new SyncClient(
    clientOptions(store, async (request) => {
      requestedVersions.push(request.version);
      return requestedVersions.length === 1 ? firstResult : incremental(2);
    }),
  );

  const first = client.pull();
  const second = client.pull();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(requestedVersions, [0]);
  resolveFirst?.(snapshot(1));
  await Promise.all([first, second]);
  assert.deepEqual(requestedVersions, [0, 1]);
  assert.deepEqual(store.appliedVersions, [1, 2]);
});

test("pull rejects regressive non-reset responses", async () => {
  const store = new MemorySyncStore();
  store.request = { version: 2, ...identity };
  const client = new SyncClient(
    clientOptions(store, async () => incremental(1)),
  );
  await assert.rejects(client.pull(), /version 1 for version 2/);
  assert.deepEqual(store.appliedVersions, []);
});

test("pull accepts an explicit regressive reset snapshot", async () => {
  const store = new MemorySyncStore();
  store.request = { version: 99, ...identity };
  const client = new SyncClient(
    clientOptions(store, async () => ({
      ...snapshot(1),
      resetReason: "cursor-ahead",
    })),
  );

  const result = await client.pull();
  assert.equal(result.version, 1);
  assert.equal(store.request.version, 1);
});

test("mutations resolve after durable enqueue and retry without another event", async () => {
  const store = new MemorySyncStore();
  let attempts = 0;
  let releaseFirstAttempt: (() => void) | undefined;
  const firstAttempt = new Promise<void>((resolve) => {
    releaseFirstAttempt = resolve;
  });
  const client = new SyncClient(
    clientOptions(store, async () => snapshot(1)),
  );
  client.registerMutationHandler("save", async () => {
    attempts += 1;
    if (attempts === 1) {
      await firstAttempt;
      throw new RetryableMutationError("temporary");
    }
    return { version: 1 };
  });
  await client.initialize();

  await client.mutate("save", { value: 1 }, []);
  assert.equal(store.mutations.mutations.length, 1);
  releaseFirstAttempt?.();
  await waitFor(() => attempts === 2 && store.mutations.mutations.length === 0);
  client.stop();
});

test("permanent rejection is durable and does not strand the next mutation", async () => {
  const store = new MemorySyncStore();
  const calls: number[] = [];
  const client = new SyncClient(
    clientOptions(store, async () => snapshot(1)),
  );
  client.registerMutationHandler("save", async (input: { value: number }) => {
    calls.push(input.value);
    if (input.value === 1) throw new Error("denied");
    return { version: 1 };
  });
  await client.initialize();
  await client.mutate("save", { value: 1 }, []);
  await client.mutate("save", { value: 2 }, []);
  await client.start();
  await waitFor(() => store.mutations.mutations.length === 0);

  assert.deepEqual(calls, [1, 2]);
  assert.equal(store.mutations.failures.length, 1);
  assert.equal(client.getStatus().failedMutations, 1);
  client.stop();
});

test("unknown durable mutation handlers fail initialization without data loss", async () => {
  const store = new MemorySyncStore();
  await store.mutations.add({
    id: "mutation-1",
    name: "removed",
    input: {},
    effects: [],
    createdAt: 1,
  });
  const client = new SyncClient(
    clientOptions(store, async () => snapshot(0)),
  );

  await assert.rejects(client.initialize(), IncompatibleSyncSchemaError);
  assert.equal(store.mutations.mutations.length, 1);
});

test("background pulls retry without a server event", async () => {
  const store = new MemorySyncStore();
  let attempts = 0;
  const client = new SyncClient(
    clientOptions(store, async () => {
      attempts += 1;
      if (attempts === 1) throw new TypeError("network failed");
      return snapshot(0);
    }),
  );
  await client.initialize();
  await client.start();
  await waitFor(() => attempts === 2);
  assert.equal(client.getStatus().connectivity, "online");
  client.stop();
});

test("coming online triggers an immediate attempt after offline retry pause", async () => {
  const store = new MemorySyncStore();
  let connectivity: "online" | "offline" = "offline";
  let connectivityListener:
    | ((value: "online" | "offline") => void)
    | undefined;
  let attempts = 0;
  const client = new SyncClient({
    ...clientOptions(store, async () => {
      attempts += 1;
      if (connectivity === "offline") throw new TypeError("offline");
      return snapshot(0);
    }),
    connectivity: {
      getCurrent: () => connectivity,
      subscribe: (listener) => {
        connectivityListener = listener;
        return () => {};
      },
    },
  });
  await client.initialize();
  await client.start();
  await waitFor(() => attempts === 1);
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(attempts, 1);

  connectivity = "online";
  connectivityListener?.("online");
  await waitFor(() => attempts === 2);
  client.stop();
});
