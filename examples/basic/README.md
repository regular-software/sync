# Regular Sync invoice example

A self-hosted Hono API and client-only React app demonstrating a durable, optimistic domain mutation across `invoices` and `invoiceLines`.

Hono serves SQLite sync, mutations, SSE wakeups, and the production SPA from one process. The UI uses TanStack Query through the Regular Sync React integration, TanStack Table for the expandable invoice list, and Keyline Icons in the table headers.

From the repository root:

```bash
pnpm --filter basic dev
```

SQLite data is stored in `examples/basic/basic.db`. Browser state is stored in the `regular-sync-invoices` IndexedDB database.

The client and server both declare sync schema version `1`. Any future change that adds or renames a synchronized table, changes a primary key, or backfills a synchronized column must increase that version on both sides. A schema upgrade is deliberately blocked while durable mutations are pending.

Mutation calls resolve after their optimistic effects are durably queued in IndexedDB. Retryable transport failures remain queued; permanent server rejections roll back their effects and are retained in the mutation failure inbox.

## Test an offline refresh

The offline app shell is enabled only in production builds. Service workers require HTTPS, except on `localhost`.

```bash
pnpm --filter basic preview
```

Open the preview once while online and wait for the sync status to show **Up to date**. In browser developer tools, confirm that `/sw.js` is activated, switch the network to offline, then refresh. The cached app starts and Regular Sync reads invoices and pending mutations from IndexedDB.
