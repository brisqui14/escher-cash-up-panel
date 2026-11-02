import { describe, expect, it } from "vitest";
import {
  currencySymbol,
  describeVariance,
  formatCountForInput,
  formatMoney,
  formatUtcTimestamp,
  parseCount,
} from "./money";

describe("parseCount", () => {
  it.each([
    ["173", 17300],
    ["173.5", 17350],
    ["173.50", 17350],
    ["173.", 17300],
    [" 12.30 ", 1230],
    ["0", 0],
    ["0.29", 29],
    ["1.15", 115],
    ["90071992547409.91", 9_007_199_254_740_991],
  ])("reads %j as %i minor units without floating point error", (text, minor) => {
    expect(parseCount(text)).toEqual({ ok: true, minor });
  });

  it.each([
    ["", "Enter the counted amount."],
    ["   ", "Enter the counted amount."],
    ["-1", "The count can't be negative."],
    ["12.345", "Use at most two decimal places."],
    ["1e2", "Enter an amount using digits and a decimal point, like 173.00."],
    ["1,000.00", "Enter an amount using digits and a decimal point, like 173.00."],
    ["abc", "Enter an amount using digits and a decimal point, like 173.00."],
    ["90071992547409.92", "That amount is too large."],
  ])("rejects %j", (text, error) => {
    expect(parseCount(text)).toEqual({ ok: false, error });
  });
});

describe("formatting", () => {
  it("round-trips a saved count into editable text", () => {
    expect(formatCountForInput(17300)).toBe("173.00");
    expect(formatCountForInput(5)).toBe("0.05");
    expect(parseCount(formatCountForInput(9_007_199_254_740_991))).toEqual({
      ok: true,
      minor: 9_007_199_254_740_991,
    });
  });

  it("presents minor units as normal money", () => {
    expect(formatMoney(17500, "EUR")).toBe("€175.00");
    expect(formatMoney(-750, "EUR", { signed: true })).toBe("-€7.50");
    expect(formatMoney(5500, "EUR", { signed: true })).toBe("+€55.00");
    expect(currencySymbol("EUR")).toBe("€");
  });

  it("shows the server's finalization time in UTC, including .NET's seven-digit fractions", () => {
    expect(formatUtcTimestamp("2026-10-29T18:38:44.1449757+00:00")).toBe(
      "29 Oct 2026, 18:38:44 UTC",
    );
    expect(formatUtcTimestamp("not a date")).toBe("not a date");
  });

  it("names the variance rather than relying on its sign", () => {
    expect(describeVariance(-200, "EUR")).toBe("Shortage of €2.00");
    expect(describeVariance(200, "EUR")).toBe("Surplus of €2.00");
    expect(describeVariance(0, "EUR")).toBe("None");
  });
});
