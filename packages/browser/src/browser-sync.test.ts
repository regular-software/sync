import assert from "node:assert/strict";
import test from "node:test";
import {
  IncompatibleSyncSchemaError,
  RetryableMutationError,
  RetryableSyncError,
} from "@regular-software/sync";
import { createHttpMutation, createHttpPull } from "./browser-sync";

const request = {
  version: 3,
  replicaId: "replica-1",
  schemaVersion: 2,
  schemaFingerprint: "fingerprint",
};

test("HTTP pull sends a structured cursor and validates the result", async () => {
  let requestedUrl = "";
  let requestedInit: RequestInit | undefined;
  const pull = createHttpPull({
    url: "https://example.test/api/sync",
    credentials: "include",
    headers: { Authorization: "Bearer token", "X-Client": "regular-sync" },
    fetch: async (input, init) => {
      requestedUrl = String(input);
      requestedInit = init;
      return Response.json({
        kind: "incremental",
        version: 3,
        replicaId: "replica-1",
        schemaVersion: 2,
        schemaFingerprint: "fingerprint",
        rows: [],
        deleted: [],
      });
    },
  });

  await pull(request);
  const url = new URL(requestedUrl);
  assert.equal(url.searchParams.get("version"), "3");
  assert.equal(url.searchParams.get("replicaId"), "replica-1");
  assert.equal(url.searchParams.get("schemaVersion"), "2");
  assert.equal(url.searchParams.get("schemaFingerprint"), "fingerprint");
  assert.equal(requestedInit?.credentials, "include");
  assert.equal(
    new Headers(requestedInit?.headers).get("authorization"),
    "Bearer token",
  );
  assert.equal(
    new Headers(requestedInit?.headers).get("x-client"),
    "regular-sync",
  );
});

test("HTTP pull distinguishes retryable and fatal responses", async () => {
  const unavailable = createHttpPull({
    url: "https://example.test/api/sync",
    fetch: async () => new Response(null, { status: 503 }),
  });
  await assert.rejects(unavailable(request), RetryableSyncError);

  const mismatch = createHttpPull({
    url: "https://example.test/api/sync",
    fetch: async () => new Response(null, { status: 409 }),
  });
  await assert.rejects(mismatch(request), IncompatibleSyncSchemaError);
});

test("HTTP mutation preserves ambiguous failures and rejects domain errors", async () => {
  const unavailable = createHttpMutation<{ value: number }>({
    url: "https://example.test/api/mutations/save",
    fetch: async () => new Response(null, { status: 503 }),
  });
  await assert.rejects(
    unavailable({ value: 1 }, { mutationId: "mutation-1" }),
    RetryableMutationError,
  );

  const malformed = createHttpMutation<{ value: number }>({
    url: "https://example.test/api/mutations/save",
    fetch: async () => Response.json({ nope: true }),
  });
  await assert.rejects(
    malformed({ value: 1 }, { mutationId: "mutation-1" }),
    RetryableMutationError,
  );

  const denied = createHttpMutation<{ value: number }>({
    url: "https://example.test/api/mutations/save",
    fetch: async () => new Response(null, { status: 400 }),
  });
  await assert.rejects(
    denied({ value: 1 }, { mutationId: "mutation-1" }),
    (error: Error & { status?: number }) => error.status === 400,
  );
});

test("HTTP mutation applies configured credentials and headers before custom fetch", async () => {
  let requestedInit: RequestInit | undefined;
  const mutation = createHttpMutation<{ value: number }>({
    url: "https://example.test/api/mutations/save",
    credentials: "include",
    headers: {
      Authorization: "Bearer token",
      "Content-Type": "application/custom+json",
    },
    fetch: async (_input, init) => {
      requestedInit = init;
      return Response.json({ version: 4 });
    },
  });

  const result = await mutation({ value: 1 }, { mutationId: "mutation-1" });

  assert.deepEqual(result, { version: 4 });
  assert.equal(requestedInit?.credentials, "include");
  assert.equal(
    new Headers(requestedInit?.headers).get("authorization"),
    "Bearer token",
  );
  assert.equal(
    new Headers(requestedInit?.headers).get("content-type"),
    "application/custom+json",
  );
});
