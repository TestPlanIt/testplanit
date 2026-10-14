import { beforeAll, describe, expect, it, vi } from "vitest";
import { decrypt, encrypt } from "@/utils/encryption";
import {
  encryptLegacyOutboundUrls,
  type OutboundUrlRewriter,
} from "./ensureOutboundWebhookUrlsEncrypted";

const SLACK = "https://hooks.slack.com/services/T000/B000/abcdef";

describe("encryptLegacyOutboundUrls", () => {
  beforeAll(() => {
    process.env.ENCRYPTION_KEY = "test-encryption-key-for-testing-purposes";
  });

  it("encrypts URLs stored in the clear and leaves encrypted ones alone", async () => {
    const sealed = await encrypt("https://example.com/hook");
    const findMany = vi.fn().mockResolvedValue([
      { id: "a", url: SLACK },
      { id: "b", url: sealed },
    ]);
    const update = vi.fn().mockResolvedValue({});
    const db: OutboundUrlRewriter = { webhookConfig: { findMany, update } };

    expect(await encryptLegacyOutboundUrls(db)).toEqual({
      rewritten: 1,
      total: 2,
    });
    expect(findMany).toHaveBeenCalledWith({
      where: { direction: "OUTBOUND", url: { not: null } },
      select: { id: true, url: true },
    });
    expect(update).toHaveBeenCalledTimes(1);
    const written = update.mock.calls[0][0];
    expect(written.where).toEqual({ id: "a" });
    expect(written.data.url).not.toContain("hooks.slack.com");
    expect(await decrypt(written.data.url)).toBe(SLACK);
  });
});
