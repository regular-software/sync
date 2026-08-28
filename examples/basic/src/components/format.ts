const currency = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
});

export function formatCurrency(cents: number): string {
  return currency.format(Number.isFinite(cents) ? cents / 100 : 0);
}
