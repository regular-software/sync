import type { QueryClient, QueryKey } from "@tanstack/react-query";

export function createQueryRefresh(
  queryClient: QueryClient,
  queryKey: QueryKey,
) {
  let active = true;
  let refreshRequested = false;
  let refreshPromise: Promise<void> | undefined;

  const refresh = () => {
    if (!active) return;

    refreshRequested = true;

    if (refreshPromise) return;

    refreshPromise = (async () => {
      do {
        refreshRequested = false;

        // invalidateQueries reuses an initial fetch when there is no cached data.
        // Cancel it first so every notification is followed by a fresh read.
        await queryClient.cancelQueries({ queryKey });

        if (!active) return;

        await queryClient.invalidateQueries({ queryKey });
      } while (active && refreshRequested);
    })().finally(() => {
      refreshPromise = undefined;

      if (active && refreshRequested) refresh();
    });
  };

  return {
    refresh,
    dispose() {
      active = false;
      refreshRequested = false;
    },
  };
}
