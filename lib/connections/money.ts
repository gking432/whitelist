/** Monetary read models retain provider minor units. No currency conversion is performed. */
export function knownCurrency(value: unknown): string | null {
  if (typeof value !== "string" || !/^[a-z]{3}$/i.test(value)) return null;
  const code = value.toUpperCase();
  return Intl.supportedValuesOf("currency").includes(code) ? code : null;
}
export function minorAmount(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) ? value : null;
}
/** Stripe charge/invoice amounts have two-decimal compatibility units for ISK and UGX. */
export function formatMinorMoney(amountMinor: number | null, currency: string | null): string | null {
  const code = knownCurrency(currency), amount = minorAmount(amountMinor);
  if (!code || amount === null) return null;
  if (["ISK", "UGX"].includes(code) && amount % 100 !== 0) return null;
  const format = new Intl.NumberFormat("en-US", { style: "currency", currency: code });
  const decimals = ["ISK", "UGX"].includes(code) ? 2 : format.resolvedOptions().maximumFractionDigits;
  if (decimals === undefined) return null;
  const value = BigInt(amount), negative = value < BigInt(0), absolute = negative ? -value : value;
  const scale = BigInt(10) ** BigInt(decimals), whole = absolute / scale;
  const fraction = (absolute % scale).toString().padStart(decimals, "0");
  // Preserve every safe integer minor unit, including values whose quotient
  // cannot retain cents in a binary floating-point Number.
  const signedWhole = negative && whole === BigInt(0) ? -0 : negative ? -whole : whole;
  return format.formatToParts(signedWhole).map((part) => part.type === "fraction" ? fraction : part.value).join("");
}
