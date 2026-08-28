import {
  Building,
  FileText,
  Receipt,
  SquareCheck,
} from "@keyline-icons/react/fill";
import {
  createColumnHelper,
  rowExpandingFeature,
  tableFeatures,
  useTable,
} from "@tanstack/react-table";
import { Fragment, useMemo, type ReactNode } from "react";

import type {
  Invoice,
  InvoiceLine,
  InvoiceStatus,
} from "../invoices";
import { formatCurrency } from "./format";

const statusLabels: Record<InvoiceStatus, string> = {
  draft: "Draft",
  sent: "Sent",
  paid: "Paid",
};

const invoiceTableFeatures = tableFeatures({ rowExpandingFeature });
const columnHelper = createColumnHelper<
  typeof invoiceTableFeatures,
  Invoice
>();

function Header({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <span className="column-heading">
      {icon}
      {children}
    </span>
  );
}

const columns = columnHelper.columns([
  columnHelper.accessor("number", {
    header: () => (
      <Header icon={<FileText aria-hidden="true" />}>
        Invoice
      </Header>
    ),
    cell: ({ getValue }) => <strong>{getValue()}</strong>,
  }),
  columnHelper.accessor("customer", {
    header: () => (
      <Header icon={<Building aria-hidden="true" />}>
        Customer
      </Header>
    ),
  }),
  columnHelper.accessor("status", {
    header: () => (
      <Header icon={<SquareCheck aria-hidden="true" />}>
        Status
      </Header>
    ),
    cell: ({ getValue }) => statusLabels[getValue()],
  }),
  columnHelper.accessor("totalCents", {
    header: () => (
      <Header icon={<Receipt aria-hidden="true" />}>
        Amount
      </Header>
    ),
    cell: ({ getValue }) => formatCurrency(getValue()),
  }),
]);

function InvoiceLines({ lines }: { lines: InvoiceLine[] }) {
  return (
    <div className="invoice-lines">
      <div className="invoice-lines-heading">
        <span>Description</span>
        <span>Quantity</span>
        <span>Unit price</span>
        <span>Amount</span>
      </div>

      {lines.map((line) => (
        <div className="invoice-line" key={line.id}>
          <span>{line.description}</span>
          <span>{line.quantity}</span>
          <span>{formatCurrency(line.unitPriceCents)}</span>
          <strong>
            {formatCurrency(line.quantity * line.unitPriceCents)}
          </strong>
        </div>
      ))}
    </div>
  );
}

export function InvoiceTable({
  invoices,
  invoiceLines,
}: {
  invoices: Invoice[];
  invoiceLines: InvoiceLine[];
}) {
  const linesByInvoice = useMemo(() => {
    const grouped = new Map<string, InvoiceLine[]>();

    for (const line of invoiceLines) {
      const lines = grouped.get(line.invoiceId) ?? [];
      lines.push(line);
      grouped.set(line.invoiceId, lines);
    }

    for (const lines of grouped.values()) {
      lines.sort((left, right) => left.position - right.position);
    }

    return grouped;
  }, [invoiceLines]);

  const table = useTable({
    columns,
    data: invoices,
    features: invoiceTableFeatures,
    getRowCanExpand: () => true,
    getRowId: (invoice) => invoice.id,
  });

  const totalCents = invoices.reduce(
    (total, invoice) => total + invoice.totalCents,
    0,
  );

  return (
    <div className="table-scroll">
      <table className="invoice-table">
        <thead>
          {table.getHeaderGroups().map((headerGroup) => (
            <tr key={headerGroup.id}>
              {headerGroup.headers.map((header) => (
                <th key={header.id}>
                  {header.isPlaceholder ? null : (
                    <table.FlexRender header={header} />
                  )}
                </th>
              ))}
            </tr>
          ))}
        </thead>

        <tbody>
          {table.getRowModel().rows.map((row) => (
            <Fragment key={row.id}>
              <tr
                className="invoice-row"
                tabIndex={0}
                aria-expanded={row.getIsExpanded()}
                onClick={() => row.toggleExpanded()}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    row.toggleExpanded();
                  }
                }}
              >
                {row.getAllCells().map((cell) => (
                  <td key={cell.id}>
                    <table.FlexRender cell={cell} />
                  </td>
                ))}
              </tr>

              {row.getIsExpanded() ? (
                <tr className="expanded-row">
                  <td colSpan={columns.length}>
                    <InvoiceLines
                      lines={linesByInvoice.get(row.original.id) ?? []}
                    />
                  </td>
                </tr>
              ) : null}
            </Fragment>
          ))}

          {invoices.length === 0 ? (
            <tr>
              <td className="empty-table" colSpan={columns.length}>
                No invoices yet. Create one to test a multi-table mutation.
              </td>
            </tr>
          ) : null}
        </tbody>

        <tfoot>
          <tr>
            <td colSpan={3}>Total</td>
            <td>{formatCurrency(totalCents)}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
