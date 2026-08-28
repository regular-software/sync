import { useState } from "react";
import { Plus } from "@keyline-icons/react";

import { InvoiceForm } from "./components/invoice-form";
import { InvoiceTable } from "./components/invoice-table";
import { Logo } from "./logo";
import { useSyncMutation, useSyncQuery, useSyncStatus } from "./sync/react";

export function App() {
  const [isCreating, setIsCreating] = useState(false);
  const invoices = useSyncQuery("invoices");
  const invoiceLines = useSyncQuery("invoiceLines");
  const createInvoice = useSyncMutation("createInvoice");
  const loadingLocalData = invoices.isPending || invoiceLines.isPending;
  const localDataError = invoices.error ?? invoiceLines.error;

  return (
    <main className="page-shell">
      <header className="page-header">
        <div>
          <div className="page-meta">
            <div className="brand-logo">
              <Logo />
            </div>
            <span className="page-meta-divider" aria-hidden="true" />
            <SyncIndicator />
          </div>
          <h1>Invoices</h1>
        </div>

        {isCreating ? null : (
          <button
            type="button"
            className="primary-button add-invoice-button"
            onClick={() => setIsCreating(true)}
          >
            <Plus aria-hidden="true" size={16} />
            Add Invoice
          </button>
        )}
      </header>

      {isCreating ? (
        <InvoiceForm
          isSubmitting={createInvoice.isPending}
          onCancel={() => setIsCreating(false)}
          onSubmit={async (input) => {
            await createInvoice.mutateAsync(input);
            setIsCreating(false);
          }}
        />
      ) : null}

      {localDataError ? (
        <p className="local-data-message" role="alert">
          Could not open local data.
        </p>
      ) : loadingLocalData ? (
        <p className="local-data-message">Loading local data…</p>
      ) : (
        <InvoiceTable
          invoices={invoices.data ?? []}
          invoiceLines={invoiceLines.data ?? []}
        />
      )}
    </main>
  );
}

function SyncIndicator() {
  const status = useSyncStatus();

  if (status.connectivity === "offline") {
    const queued = status.pendingMutations;
    const label = queued
      ? `Offline · ${queued} ${queued === 1 ? "change" : "changes"} queued`
      : "Offline";

    return <StatusLabel state="offline">{label}</StatusLabel>;
  }

  if (status.lifecycle !== "running" || status.activity !== "idle") {
    const label =
      status.connectivity === "unreachable" ? "Retrying…" : "Syncing…";

    return <StatusLabel state="syncing">{label}</StatusLabel>;
  }

  if (status.connectivity === "unreachable") {
    return <StatusLabel state="error">Server unavailable</StatusLabel>;
  }

  if (status.error) {
    return <StatusLabel state="error">Sync failed</StatusLabel>;
  }

  return <StatusLabel state="current">Up to date</StatusLabel>;
}

function StatusLabel({
  children,
  state,
}: {
  children: string;
  state: "current" | "error" | "offline" | "syncing";
}) {
  return (
    <p className="sync-status" data-state={state} role="status" aria-live="polite">
      <span className="sync-status-dot" aria-hidden="true" />
      {children}
    </p>
  );
}
