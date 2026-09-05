# @regular-software/sync-server

SQLite sync engine for regular software server applications.

`SyncEngine` assigns one version per logical mutation, including batches. Incremental pulls return
collapsed packets; snapshots return rows. `auditHook` runs after mutation changes and before the
SQLite transaction commits. Throwing from the hook rolls back the mutation or batch.

Call `compactChanges(beforeVersion)` to delete changes where `version < beforeVersion`. The boundary
version remains retained. A cursor expires only when required changes before the cursor are gone.

This package uses the native `better-sqlite3` dependency. It is a 0.x package;
APIs may change between minor versions.
