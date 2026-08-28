import { useState, type FormEvent } from "react";

import {
  calculateInvoiceTotal,
  type CreateInvoiceInput,
  type InvoiceLine,
  type InvoiceStatus,
  type PaymentMethod,
} from "../invoices";
import { formatCurrency } from "./format";

type LineDraft = {
  key: string;
  description: string;
  quantity: string;
  unitPrice: string;
};

type InvoiceFormProps = {
  isSubmitting: boolean;
  onCancel(): void;
  onSubmit(input: CreateInvoiceInput): Promise<void>;
};

const initialLine: LineDraft = {
  key: "initial",
  description: "",
  quantity: "1",
  unitPrice: "",
};

function lineToCents(line: LineDraft): number {
  return Math.round(Number(line.unitPrice) * 100);
}

export function InvoiceForm({
  isSubmitting,
  onCancel,
  onSubmit,
}: InvoiceFormProps) {
  const [number, setNumber] = useState("");
  const [customer, setCustomer] = useState("");
  const [status, setStatus] = useState<InvoiceStatus>("draft");
  const [paymentMethod, setPaymentMethod] =
    useState<PaymentMethod>("bank_transfer");
  const [lines, setLines] = useState<LineDraft[]>([initialLine]);
  const [error, setError] = useState<string>();

  function updateLine(key: string, update: Partial<LineDraft>) {
    setLines((current) =>
      current.map((line) =>
        line.key === key ? { ...line, ...update } : line,
      ),
    );
  }

  function reset() {
    setNumber("");
    setCustomer("");
    setStatus("draft");
    setPaymentMethod("bank_transfer");
    setLines([{ ...initialLine, key: crypto.randomUUID() }]);
    setError(undefined);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(undefined);

    const invoiceId = crypto.randomUUID();
    const invoiceLines: InvoiceLine[] = lines.map((line, position) => ({
      id: crypto.randomUUID(),
      invoiceId,
      position,
      description: line.description.trim(),
      quantity: Number(line.quantity),
      unitPriceCents: lineToCents(line),
    }));

    const input: CreateInvoiceInput = {
      invoice: {
        id: invoiceId,
        number: number.trim(),
        customer: customer.trim(),
        status,
        paymentMethod,
        totalCents: calculateInvoiceTotal(invoiceLines),
      },
      lines: invoiceLines,
    };

    try {
      await onSubmit(input);
      reset();
    } catch (submitError) {
      setError(
        submitError instanceof Error
          ? submitError.message
          : "The invoice could not be created.",
      );
    }
  }

  return (
    <form onSubmit={handleSubmit}>
      <div className="form-grid">
        <label>
          <span>Invoice number</span>
          <input
            required
            value={number}
            onChange={(event) => setNumber(event.target.value)}
            placeholder="INV-001"
          />
        </label>

        <label>
          <span>Customer</span>
          <input
            required
            value={customer}
            onChange={(event) => setCustomer(event.target.value)}
            placeholder="Acme Inc."
          />
        </label>

        <label>
          <span>Status</span>
          <select
            value={status}
            onChange={(event) =>
              setStatus(event.target.value as InvoiceStatus)
            }
          >
            <option value="draft">Draft</option>
            <option value="sent">Sent</option>
            <option value="paid">Paid</option>
          </select>
        </label>

        <label>
          <span>Payment method</span>
          <select
            value={paymentMethod}
            onChange={(event) =>
              setPaymentMethod(event.target.value as PaymentMethod)
            }
          >
            <option value="bank_transfer">Bank transfer</option>
            <option value="credit_card">Credit card</option>
            <option value="paypal">PayPal</option>
          </select>
        </label>
      </div>

      <div className="line-editor">
        <div className="line-editor-heading">
          <h2>Line items</h2>
          <button
            type="button"
            className="text-button"
            onClick={() =>
              setLines((current) => [
                ...current,
                {
                  ...initialLine,
                  key: crypto.randomUUID(),
                },
              ])
            }
          >
            Add line
          </button>
        </div>

        <div className="line-editor-labels" aria-hidden="true">
          <span>Description</span>
          <span>Quantity</span>
          <span>Unit price</span>
          <span>Amount</span>
          <span />
        </div>

        {lines.map((line, index) => (
          <div className="line-editor-row" key={line.key}>
            <label>
              <span className="mobile-label">Description</span>
              <input
                required
                value={line.description}
                onChange={(event) =>
                  updateLine(line.key, {
                    description: event.target.value,
                  })
                }
                placeholder="Design services"
              />
            </label>

            <label>
              <span className="mobile-label">Quantity</span>
              <input
                required
                min="1"
                step="1"
                type="number"
                value={line.quantity}
                onChange={(event) =>
                  updateLine(line.key, { quantity: event.target.value })
                }
              />
            </label>

            <label>
              <span className="mobile-label">Unit price</span>
              <input
                required
                min="0"
                step="0.01"
                type="number"
                value={line.unitPrice}
                onChange={(event) =>
                  updateLine(line.key, { unitPrice: event.target.value })
                }
                placeholder="0.00"
              />
            </label>

            <output>{formatCurrency(Number(line.quantity) * lineToCents(line))}</output>

            <button
              type="button"
              className="remove-line"
              disabled={lines.length === 1}
              onClick={() =>
                setLines((current) =>
                  current.filter((currentLine) => currentLine.key !== line.key),
                )
              }
              aria-label={`Remove line ${index + 1}`}
            >
              Remove
            </button>
          </div>
        ))}
      </div>

      <div className="form-footer">
        <div className="form-actions">
          <button type="button" className="secondary-button" onClick={onCancel}>
            Cancel
          </button>
          <button type="submit" className="primary-button" disabled={isSubmitting}>
            {isSubmitting ? "Creating…" : "Create invoice"}
          </button>
        </div>
      </div>

      {error ? <p className="form-error">{error}</p> : null}
    </form>
  );
}
