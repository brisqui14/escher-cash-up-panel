const LOCALE = "en-IE";
const MINOR_PER_MAJOR = 100n;
const MAX_COUNT_MINOR = 9_007_199_254_740_991n;
const AMOUNT_PATTERN = /^(\d+)(?:\.(\d{0,2}))?$/;

export type ParseCountResult =
  | { ok: true; minor: number }
  | { ok: false; error: string };

// Parses the operator's typed count into integer minor units without floating point,
// so "0.29" is 29 rather than 28.999...
export function parseCount(text: string): ParseCountResult {
  const value = text.trim();
  if (value === "") {
    return { ok: false, error: "Enter the counted amount." };
  }
  if (value.startsWith("-")) {
    return { ok: false, error: "The count can't be negative." };
  }
  const match = AMOUNT_PATTERN.exec(value);
  if (!match) {
    return /^\d+\.\d{3,}$/.test(value)
      ? { ok: false, error: "Use at most two decimal places." }
      : { ok: false, error: "Enter an amount using digits and a decimal point, like 173.00." };
  }
  const minor =
    BigInt(match[1]) * MINOR_PER_MAJOR + BigInt((match[2] ?? "").padEnd(2, "0"));
  if (minor > MAX_COUNT_MINOR) {
    return { ok: false, error: "That amount is too large." };
  }
  return { ok: true, minor: Number(minor) };
}

// The editable text for a saved count, e.g. 17300 -> "173.00".
export function formatCountForInput(minor: number): string {
  const value = BigInt(minor);
  return `${value / MINOR_PER_MAJOR}.${(value % MINOR_PER_MAJOR).toString().padStart(2, "0")}`;
}

export function formatMoney(
  minor: number,
  currency: string,
  options: { signed?: boolean } = {},
): string {
  return new Intl.NumberFormat(LOCALE, {
    style: "currency",
    currency,
    signDisplay: options.signed ? "exceptZero" : "auto",
  }).format(minor / Number(MINOR_PER_MAJOR));
}

export function currencySymbol(currency: string): string {
  return (
    new Intl.NumberFormat(LOCALE, { style: "currency", currency })
      .formatToParts(0)
      .find((part) => part.type === "currency")?.value ?? currency
  );
}

export type VarianceOutcome = "match" | "shortage" | "surplus";

export function classifyVariance(varianceMinor: number): VarianceOutcome {
  if (varianceMinor === 0) {
    return "match";
  }
  return varianceMinor < 0 ? "shortage" : "surplus";
}

export function describeVariance(varianceMinor: number, currency: string): string {
  const outcome = classifyVariance(varianceMinor);
  if (outcome === "match") {
    return "None";
  }
  const amount = formatMoney(Math.abs(varianceMinor), currency);
  return outcome === "shortage" ? `Shortage of ${amount}` : `Surplus of ${amount}`;
}

// The API sends .NET's seven fractional digits; JavaScript only guarantees parsing three.
export function formatUtcTimestamp(iso: string): string {
  const date = new Date(iso.replace(/(\.\d{3})\d+/, "$1"));
  if (Number.isNaN(date.getTime())) {
    return iso;
  }
  const formatted = new Intl.DateTimeFormat(LOCALE, {
    dateStyle: "medium",
    timeStyle: "medium",
    timeZone: "UTC",
  }).format(date);
  return `${formatted} UTC`;
}
