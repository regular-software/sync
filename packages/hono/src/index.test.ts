import assert from "node:assert/strict";
import test from "node:test";
import { createSyncHono, SyncEventHub } from "./index";

test("serves sync pulls and validates the cursor", async () => {
  const transport = createSyncHono({
    engine: {
      syncSince: (request) => ({
        kind: "incremental",
        version: request.version + 1,
        replicaId: "replica-1",
        schemaVersion: request.schemaVersion,
        schemaFingerprint: request.schemaFingerprint,
        packets: [],
      }),
    },
    pollIntervalMs: 0,
  });

  const response = await transport.app.request(
    "/sync?version=4&schemaVersion=1&schemaFingerprint=%5B%5D",
  );
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    kind: "incremental",
    version: 5,
    replicaId: "replica-1",
    schemaVersion: 1,
    schemaFingerprint: "[]",
    packets: [],
  });

  const invalid = await transport.app.request(
    "/sync?version=-1&schemaVersion=1&schemaFingerprint=%5B%5D",
  );
  assert.equal(invalid.status, 400);
  transport.stop();
});

test("resolves trusted context and awaits async sync results", async () => {
  let receivedContext: { userId: string } | undefined;
  const transport = createSyncHono({
    getContext: async () => ({ userId: "user-1" }),
    engine: {
      syncSince: async (request, context) => {
        receivedContext = context;
        return {
          kind: "incremental",
          version: request.version + 1,
          replicaId: "replica-1",
          schemaVersion: request.schemaVersion,
          schemaFingerprint: request.schemaFingerprint,
          packets: [],
        };
      },
    },
    pollIntervalMs: 0,
  });

  const response = await transport.app.request(
    "/sync?version=4&schemaVersion=1&schemaFingerprint=%5B%5D",
  );

  assert.equal(response.status, 200);
  assert.deepEqual(receivedContext, { userId: "user-1" });
  assert.equal((await response.json()).version, 5);
  transport.stop();
});

test("does not resolve context for invalid requests", async () => {
  let resolved = false;
  const transport = createSyncHono({
    getContext: () => {
      resolved = true;
      return { userId: "user-1" };
    },
    engine: { syncSince: () => { throw new Error("should not run"); } },
    pollIntervalMs: 0,
  });

  const response = await transport.app.request(
    "/sync?version=-1&schemaVersion=1&schemaFingerprint=%5B%5D",
  );

  assert.equal(response.status, 400);
  assert.equal(resolved, false);
  transport.stop();
});

test("publishes each newer version once", () => {
  const events = new SyncEventHub();
  const received: number[] = [];
  const unsubscribe = events.subscribe((version) => received.push(version));

  events.publish(2);
  events.publish(1);
  events.publish(2);
  events.publish(3);

  unsubscribe();
  events.publish(4);
  assert.deepEqual(received, [2, 3]);
});

test("returns a distinct schema mismatch response", async () => {
  const error = Object.assign(new Error("schema mismatch"), {
    name: "SyncSchemaMismatchError",
    expected: { schemaVersion: 2, schemaFingerprint: "server" },
  });
  const transport = createSyncHono({
    engine: {
      syncSince: () => {
        throw error;
      },
    },
    pollIntervalMs: 0,
  });

  const response = await transport.app.request(
    "/sync?version=0&schemaVersion=1&schemaFingerprint=client",
  );
  assert.equal(response.status, 409);
  assert.deepEqual(await response.json(), {
    error: "schema mismatch",
    expected: { schemaVersion: 2, schemaFingerprint: "server" },
  });
  transport.stop();
});
