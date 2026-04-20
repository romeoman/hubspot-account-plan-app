import { describe, expect, it } from "vitest";
import { decimalToPercent, percentToDecimal } from "../percent-format";

describe("percent-format", () => {
  describe("decimalToPercent", () => {
    it("converts 0 to 0", () => {
      expect(decimalToPercent(0)).toBe(0);
    });

    it("converts 0.65 to 65", () => {
      expect(decimalToPercent(0.65)).toBe(65);
    });

    it("converts 1 to 100", () => {
      expect(decimalToPercent(1)).toBe(100);
    });

    it("rounds to 1 decimal place", () => {
      expect(decimalToPercent(0.12345)).toBe(12.3);
      expect(decimalToPercent(0.126)).toBe(12.6);
    });

    it("clamps values below 0 to 0", () => {
      expect(decimalToPercent(-0.5)).toBe(0);
    });

    it("clamps values above 1 to 100", () => {
      expect(decimalToPercent(1.5)).toBe(100);
    });

    it("throws on NaN", () => {
      expect(() => decimalToPercent(Number.NaN)).toThrow();
    });
  });

  describe("percentToDecimal", () => {
    it("converts 0 to 0", () => {
      expect(percentToDecimal(0)).toBe(0);
    });

    it("converts 65 to 0.65", () => {
      expect(percentToDecimal(65)).toBe(0.65);
    });

    it("converts 100 to 1", () => {
      expect(percentToDecimal(100)).toBe(1);
    });

    it("clamps values below 0 to 0", () => {
      expect(percentToDecimal(-10)).toBe(0);
    });

    it("clamps values above 100 to 1", () => {
      expect(percentToDecimal(150)).toBe(1);
    });

    it("throws on NaN", () => {
      expect(() => percentToDecimal(Number.NaN)).toThrow();
    });
  });

  describe("round-trip invariants", () => {
    it("round-trips 0 without drift", () => {
      expect(percentToDecimal(decimalToPercent(0))).toBe(0);
    });

    it("round-trips 0.65 without drift", () => {
      expect(percentToDecimal(decimalToPercent(0.65))).toBe(0.65);
    });

    it("round-trips 1 without drift", () => {
      expect(percentToDecimal(decimalToPercent(1))).toBe(1);
    });

    it("round-trips 0.5 without drift", () => {
      expect(percentToDecimal(decimalToPercent(0.5))).toBe(0.5);
    });
  });
});
