# @regular-software/sync-browser

Browser HTTP sync client and IndexedDB integration.

Use `createHttpMutationBatch` with `BrowserSyncOptions.push` for atomic server batches. SSE remains
only a wake-up channel; HTTP pulls snapshots or incremental packets.

This is a 0.x package; APIs may change between minor versions.
