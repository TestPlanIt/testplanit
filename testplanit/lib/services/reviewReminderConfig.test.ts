import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  getReviewReminderThresholdDays,
  REVIEW_REMINDER_THRESHOLD_DAYS_DEFAULT,
  REVIEW_REMINDER_THRESHOLD_DAYS_KEY,
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
      expect(REVIEW_REMINDER_THRESHOLD_DAYS_KEY).toBe(
        "review_reminder_threshold_days"
      );
    });

    it("exports the default threshold (1 day)", () => {
      expect(REVIEW_REMINDER_THRESHOLD_DAYS_DEFAULT).toBe(1);
    });
  });

  describe("getReviewReminderThresholdDays", () => {
    it("returns the default when the AppConfig row is absent", async () => {
      const { tx, findUnique } = makeTx(null);

      const result = await getReviewReminderThresholdDays(tx);

      expect(result).toBe(1);
      expect(findUnique).toHaveBeenCalledWith({
        where: { key: REVIEW_REMINDER_THRESHOLD_DAYS_KEY },
        select: { value: true },
      });
    });

    it("returns the configured positive numeric override", async () => {
      const { tx } = makeTx({ value: 3 });

      const result = await getReviewReminderThresholdDays(tx);

      expect(result).toBe(3);
    });

    it("returns 0 when value is exactly zero (reminders disabled)", async () => {
      const { tx } = makeTx({ value: 0 });

      const result = await getReviewReminderThresholdDays(tx);

      expect(result).toBe(0);
    });

    it("falls back to default when value is negative", async () => {
      const { tx } = makeTx({ value: -5 });

      const result = await getReviewReminderThresholdDays(tx);

      expect(result).toBe(1);
    });

    it("falls back to default when value is a string", async () => {
      const { tx } = makeTx({ value: "3" });

      const result = await getReviewReminderThresholdDays(tx);

      expect(result).toBe(1);
    });

    it("falls back to default when value is NaN", async () => {
      const { tx } = makeTx({ value: Number.NaN });

      const result = await getReviewReminderThresholdDays(tx);

      expect(result).toBe(1);
    });

    it("accepts the structured { days: <number> } shape", async () => {
      const { tx } = makeTx({ value: { days: 7 } });

      const result = await getReviewReminderThresholdDays(tx);

      expect(result).toBe(7);
    });

    it("accepts { days: 0 } as a disable signal", async () => {
      const { tx } = makeTx({ value: { days: 0 } });

      const result = await getReviewReminderThresholdDays(tx);

      expect(result).toBe(0);
    });
  });
});
