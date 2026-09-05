import "fake-indexeddb/auto";

import assert from "node:assert/strict";
import test from "node:test";
import {
  createSyncClient,
  defineTable,
  IncompatibleSyncSchemaError,
  PendingMutationsBlockSchemaUpgradeError,
  RetryableMutationError,
} from "@regular-software/sync";
import {
  createSyncSchemaFingerprint,
  type SyncRequest,
  type SyncResult,
  type SyncTable,
} from "@regular-software/sync-protocol";
import { IndexedDbSyncStore } from "./store";

type Invoice = { id: string; status: string };
type InvoiceLine = { id: string; invoiceId: string; description: string };

const invoicesDefinition = defineTable<Invoice>({ primaryKey: "id" });
const invoiceLinesDefinition = defineTable<InvoiceLine>({ primaryKey: "id" });
const invoicesTable = { name: "invoices", primaryKey: "id" } as const;
const invoiceLinesTable = { name: "invoiceLines", primaryKey: "id" } as const;

function databaseName() {
  return `regular-sync-test-${crypto.randomUUID()}`;
}

function identity(request: SyncRequest, replicaId = "replica-1") {
  return {
    replicaId,
    schemaVersion: request.schemaVersion,
    schemaFingerprint: request.schemaFingerprint,
  };
}

function snapshot(
  request: SyncRequest,
  version: number,
  rows: SyncResult["rows"] = [],
): SyncResult {
  return { kind: "snapshot", version, ...identity(request), rows };
}

async function waitFor(predicate: () => Promise<boolean>): Promise<void> {
  for (let index = 0; index < 100; index += 1) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
  assert.fail("Condition was not reached");
}

test("pending multi-table effects survive store recreation", async () => {
  const name = databaseName();
  const store = new IndexedDbSyncStore(name);
  const client = await createSyncClient({
    store,
    schemaVersion: 1,
    pull: async (request) => snapshot(request, 0),
  })
    .register("invoices", invoicesDefinition)
    .register("invoiceLines", invoiceLinesDefinition)
    .mutation("createInvoice", {
      optimistic: (
        input: { invoice: Invoice; line: InvoiceLine },
        transaction,
      ) => {
        transaction.put("invoices", input.invoice);
        transaction.put("invoiceLines", input.line);
      },
      execute: async () => {
        throw new RetryableMutationError("offline");
      },
    })
    .build();

  await client.mutations.createInvoice({
    invoice: { id: "invoice-1", status: "local" },
    line: {
      id: "line-1",
      invoiceId: "invoice-1",
      description: "local",
    },
  });

  assert.deepEqual(await client.invoices.getAll(), [
    { id: "invoice-1", status: "local" },
  ]);

  const reopened = new IndexedDbSyncStore(name);
  await reopened.initializeSchema({
    schemaVersion: 1,
    tables: [invoicesTable, invoiceLinesTable],
  });
  assert.deepEqual(await reopened.getAll<Invoice>(invoicesTable), [
    { id: "invoice-1", status: "local" },
  ]);
  client.stop();
});

test("acknowledged effects remain until the pulled version confirms them", async () => {
  const store = new IndexedDbSyncStore(databaseName());
  let serverVersion = 1;
  const client = await createSyncClient({
    store,
    schemaVersion: 1,
    retry: { initialDelayMs: 0, maximumDelayMs: 0, jitter: 0 },
    pull: async (request) =>
      request.version === 0
        ? snapshot(request, serverVersion, [
            {
              tableName: "invoices",
              row: { id: "invoice-1", status: "server" },
            },
          ])
        : {
            kind: "incremental",
            version: serverVersion,
            ...identity(request),
            packets: [
              {
                version: serverVersion,
                tableName: "invoices",
                operation: "update",
                rowId: "invoice-1",
                row: { id: "invoice-1", status: "confirmed" },
              },
            ],
          },
  })
    .register("invoices", invoicesDefinition)
    .mutation("updateInvoice", {
      optimistic: (invoice: Invoice, transaction) => {
        transaction.put("invoices", invoice);
      },
      execute: async () => ({ version: 2 }),
    })
    .build();

  await client.mutations.updateInvoice({ id: "invoice-1", status: "local" });
  await client.start();
  await waitFor(async () => {
    const [mutation] = await store.mutations.getAll();
    return mutation?.acknowledgedVersion === 2;
  });
  assert.deepEqual(await client.invoices.getAll(), [
    { id: "invoice-1", status: "local" },
  ]);

  serverVersion = 2;
  await client.pull();
  assert.deepEqual(await store.mutations.getAll(), []);
  assert.deepEqual(await client.invoices.getAll(), [
    { id: "invoice-1", status: "confirmed" },
  ]);
  client.stop();
});

test("permanent rejection rolls back effects and persists a failure inbox", async () => {
  const name = databaseName();
  const store = new IndexedDbSyncStore(name);
  const client = await createSyncClient({
    store,
    schemaVersion: 1,
    pull: async (request) =>
      snapshot(request, 1, [
        {
          tableName: "invoices",
          row: { id: "invoice-1", status: "confirmed" },
        },
      ]),
  })
    .register("invoices", invoicesDefinition)
    .mutation("updateInvoice", {
      optimistic: (invoice: Invoice, transaction) => {
        transaction.put("invoices", invoice);
      },
      execute: async () => {
        throw Object.assign(new Error("denied"), { status: 400 });
      },
    })
    .build();

  await client.pull();
  await client.mutations.updateInvoice({ id: "invoice-1", status: "local" });
  await client.start();
  await waitFor(async () => (await client.getMutationFailures()).length === 1);

  assert.deepEqual(await client.invoices.getAll(), [
    { id: "invoice-1", status: "confirmed" },
  ]);
  const [failure] = await client.getMutationFailures();
  assert.equal(failure?.error.status, 400);

  const reopened = new IndexedDbSyncStore(name);
  await reopened.initializeSchema({ schemaVersion: 1, tables: [invoicesTable] });
  assert.equal((await reopened.mutations.getFailures()).length, 1);
  await client.acknowledgeMutationFailure(failure!.id);
  assert.deepEqual(await client.getMutationFailures(), []);
  client.stop();
});

test("pending delete effects remain visible across pulls", async () => {
  const store = new IndexedDbSyncStore(databaseName());
  const client = await createSyncClient({
    store,
    schemaVersion: 1,
    pull: async (request) =>
      snapshot(request, 1, [
        {
          tableName: "invoices",
          row: { id: "invoice-1", status: "confirmed" },
        },
      ]),
  })
    .register("invoices", invoicesDefinition)
    .mutation("deleteInvoice", {
      optimistic: (id: string, transaction) => transaction.delete("invoices", id),
      execute: async () => {
        throw new RetryableMutationError("offline");
      },
    })
    .build();

  await client.pull();
  await client.mutations.deleteInvoice("invoice-1");
  await client.pull();
  assert.deepEqual(await client.invoices.getAll(), []);
  client.stop();
});

test("reset snapshots replace rows and make acknowledgements retryable", async () => {
  const store = new IndexedDbSyncStore(databaseName());
  await store.initializeSchema({ schemaVersion: 1, tables: [invoicesTable] });
  const request = await store.getSyncRequest();
  await store.apply(
    snapshot(request, 5, [
      { tableName: "invoices", row: { id: "invoice-1", status: "old" } },
    ]),
  );
  await store.mutations.add({
    id: "mutation-1",
    name: "updateInvoice",
    input: {},
    effects: [
      {
        operation: "put",
        tableName: "invoices",
        row: { id: "invoice-1", status: "local" },
      },
    ],
    createdAt: 1,
  });
  await store.mutations.acknowledge("mutation-1", 6);

  const current = await store.getSyncRequest();
  await store.apply({
    kind: "snapshot",
    version: 2,
    replicaId: "replica-2",
    schemaVersion: current.schemaVersion,
    schemaFingerprint: current.schemaFingerprint,
    resetReason: "replica-changed",
    rows: [
      { tableName: "invoices", row: { id: "invoice-1", status: "restored" } },
    ],
  });

  const [pending] = await store.mutations.getAll();
  assert.equal(pending?.acknowledgedVersion, undefined);
  assert.equal((await store.getSyncRequest()).replicaId, "replica-2");
  assert.deepEqual(await store.getAll<Invoice>(invoicesTable), [
    { id: "invoice-1", status: "local" },
  ]);
});

test("schema upgrades reset empty replicas and block when mutations are pending", async () => {
  const store = new IndexedDbSyncStore(databaseName());
  await store.initializeSchema({ schemaVersion: 1, tables: [invoicesTable] });
  const request = await store.getSyncRequest();
  await store.apply(
    snapshot(request, 1, [
      { tableName: "invoices", row: { id: "invoice-1", status: "old" } },
    ]),
  );

  await store.initializeSchema({
    schemaVersion: 2,
    tables: [invoicesTable, invoiceLinesTable],
  });
  assert.equal((await store.getSyncRequest()).version, 0);
  assert.deepEqual(await store.getAll<Invoice>(invoicesTable), []);

  await store.mutations.add({
    id: "mutation-1",
    name: "save",
    input: {},
    effects: [],
    createdAt: 1,
  });
  await assert.rejects(
    store.initializeSchema({
      schemaVersion: 3,
      tables: [invoicesTable, invoiceLinesTable],
    }),
    PendingMutationsBlockSchemaUpgradeError,
  );
  assert.equal((await store.getSyncRequest()).schemaVersion, 2);
});

test("table fingerprint changes require a schema version increase", async () => {
  const store = new IndexedDbSyncStore(databaseName());
  await store.initializeSchema({ schemaVersion: 1, tables: [invoicesTable] });
  await assert.rejects(
    store.initializeSchema({ schemaVersion: 1, tables: [invoiceLinesTable] }),
    IncompatibleSyncSchemaError,
  );
});

test("schema fingerprints are registration-order independent", () => {
  const left: SyncTable[] = [invoicesTable, invoiceLinesTable];
  const right: SyncTable[] = [invoiceLinesTable, invoicesTable];
  assert.equal(
    createSyncSchemaFingerprint(left),
    createSyncSchemaFingerprint(right),
  );
});

test("existing IndexedDB tables with incompatible primary keys fail clearly", async () => {
  const name = databaseName();
  const database = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(name, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore("invoices", { keyPath: "wrongId" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  database.close();

  const store = new IndexedDbSyncStore(name);
  await assert.rejects(
    store.initializeSchema({ schemaVersion: 1, tables: [invoicesTable] }),
    /primary key/,
  );
});
