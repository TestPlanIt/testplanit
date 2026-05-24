import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  getReviewReminderThresholdHours,
  REVIEW_REMINDER_THRESHOLD_HOURS_DEFAULT,
  REVIEW_REMINDER_THRESHOLD_HOURS_KEY,
} from "./reviewReminderConfig";

type FindUniqueReturn = { value: unknown } | null;

const makeTx = (row: FindUniqueReturn) => {
  const findUnique = vi.fn().mockResolvedValue(row);
  return {
    tx: {
      appConfig: {
        findUnique,
      },
    } as any,
    findUnique,
  };
};

describe("reviewReminderConfig", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("constants", () => {
    it("exports the AppConfig key constant", () => {
      expect(REVIEW_REMINDER_THRESHOLD_HOURS_KEY).toBe(
        "review_reminder_threshold_hours"
      );
    });

    it("exports the default threshold (24h)", () => {
      expect(REVIEW_REMINDER_THRESHOLD_HOURS_DEFAULT).toBe(24);
    });
  });

  describe("getReviewReminderThresholdHours", () => {
    it("returns the default when the AppConfig row is absent", async () => {
      const { tx, findUnique } = makeTx(null);

      const result = await getReviewReminderThresholdHours(tx);

      expect(result).toBe(24);
      expect(findUnique).toHaveBeenCalledWith({
        where: { key: REVIEW_REMINDER_THRESHOLD_HOURS_KEY },
        select: { value: true },
      });
    });

    it("returns the configured positive numeric override", async () => {
      const { tx } = makeTx({ value: 48 });

      const result = await getReviewReminderThresholdHours(tx);

      expect(result).toBe(48);
    });

    it("falls back to default when value is zero", async () => {
      const { tx } = makeTx({ value: 0 });

      const result = await getReviewReminderThresholdHours(tx);

      expect(result).toBe(24);
    });

    it("falls back to default when value is negative", async () => {
      const { tx } = makeTx({ value: -5 });

      const result = await getReviewReminderThresholdHours(tx);

      expect(result).toBe(24);
    });

    it("falls back to default when value is a string", async () => {
      const { tx } = makeTx({ value: "48" });

      const result = await getReviewReminderThresholdHours(tx);

      expect(result).toBe(24);
    });

    it("falls back to default when value is NaN", async () => {
      const { tx } = makeTx({ value: Number.NaN });

      const result = await getReviewReminderThresholdHours(tx);

      expect(result).toBe(24);
    });

    it("accepts the structured { hours: <number> } shape", async () => {
      const { tx } = makeTx({ value: { hours: 12 } });

      const result = await getReviewReminderThresholdHours(tx);

      expect(result).toBe(12);
    });
  });
});
