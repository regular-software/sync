import assert from "node:assert/strict";
import test from "node:test";
import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { createQueryRefresh } from "./query-refresh";

async function waitFor(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }

  throw new Error("Condition was not met");
}

test("a notification during the initial fetch starts a fresh read", async () => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const queryKey = ["regular-sync", "activity"] as const;
  const pendingReads: Array<() => void> = [];
  let storedActivity = "before";
  let reads = 0;

  const observer = new QueryObserver(queryClient, {
    queryKey,
    queryFn: async () => {
      const activity = storedActivity;
      reads += 1;
      await new Promise<void>((resolve) => pendingReads.push(resolve));
      return activity;
    },
  });
  const unsubscribe = observer.subscribe(() => {});
  const queryRefresh = createQueryRefresh(queryClient, queryKey);

  await waitFor(() => reads === 1);

  storedActivity = "after";
  queryRefresh.refresh();

  await waitFor(() => reads === 2);
  pendingReads[1]?.();
  await waitFor(() => observer.getCurrentResult().data === "after");

  pendingReads[0]?.();
  assert.equal(reads, 2);
  assert.equal(observer.getCurrentResult().data, "after");

  queryRefresh.dispose();
  unsubscribe();
  queryClient.clear();
});

test("a notification during a refresh triggers a trailing read", async () => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const queryKey = ["regular-sync", "activity"] as const;
  const pendingReads: Array<() => void> = [];
  let storedActivity = "initial";
  let reads = 0;

  const observer = new QueryObserver(queryClient, {
    queryKey,
    queryFn: async () => {
      const activity = storedActivity;
      reads += 1;
      await new Promise<void>((resolve) => pendingReads.push(resolve));
      return activity;
    },
  });
  const unsubscribe = observer.subscribe(() => {});
  const queryRefresh = createQueryRefresh(queryClient, queryKey);

  await waitFor(() => reads === 1);
  pendingReads[0]?.();
  await waitFor(() => observer.getCurrentResult().data === "initial");

  storedActivity = "intermediate";
  queryRefresh.refresh();
  await waitFor(() => reads === 2);

  storedActivity = "latest";
  queryRefresh.refresh();
  pendingReads[1]?.();

  await waitFor(() => reads === 3);
  pendingReads[2]?.();
  await waitFor(() => observer.getCurrentResult().data === "latest");

  assert.equal(reads, 3);
  assert.equal(observer.getCurrentResult().data, "latest");

  queryRefresh.dispose();
  unsubscribe();
  queryClient.clear();
});
