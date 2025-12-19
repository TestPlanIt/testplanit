import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock the database
const mockFindFirst = vi.fn();

vi.mock("~/server/db", () => ({
  db: {
    registrationSettings: {
      findFirst: () => mockFindFirst(),
    },
    allowedEmailDomain: {
      findFirst: (args: any) => mockFindFirst(args),
    },
  },
}));

import { isEmailDomainAllowed } from "./auth";

describe("auth actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("isEmailDomainAllowed", () => {
    describe("when domain restrictions are disabled", () => {
      it("should return true when no registration settings exist", async () => {
        mockFindFirst.mockResolvedValueOnce(null);

        const result = await isEmailDomainAllowed("user@example.com");

        expect(result).toBe(true);
      });

      it("should return true when restrictEmailDomains is false", async () => {
        mockFindFirst.mockResolvedValueOnce({
          restrictEmailDomains: false,
        });

        const result = await isEmailDomainAllowed("user@anydomain.com");

        expect(result).toBe(true);
      });
    });

    describe("when domain restrictions are enabled", () => {
      beforeEach(() => {
        mockFindFirst.mockResolvedValueOnce({
          restrictEmailDomains: true,
        });
      });

      it("should return true when domain is in allowed list", async () => {
        mockFindFirst.mockResolvedValueOnce({
          domain: "allowed.com",
          enabled: true,
        });

        const result = await isEmailDomainAllowed("user@allowed.com");

        expect(result).toBe(true);
      });

      it("should return false when domain is not in allowed list", async () => {
        mockFindFirst.mockResolvedValueOnce(null);

        const result = await isEmailDomainAllowed("user@notallowed.com");

        expect(result).toBe(false);
      });

      it("should return false when domain exists but is disabled", async () => {
        mockFindFirst.mockResolvedValueOnce(null); // Domain disabled won't be found

        const result = await isEmailDomainAllowed("user@disabled.com");

        expect(result).toBe(false);
      });
    });

    describe("email parsing", () => {
      beforeEach(() => {
        mockFindFirst.mockResolvedValueOnce({
          restrictEmailDomains: true,
        });
      });

      it("should extract domain from email correctly", async () => {
        mockFindFirst.mockResolvedValueOnce({
          domain: "example.com",
          enabled: true,
        });

        await isEmailDomainAllowed("user@example.com");

        expect(mockFindFirst).toHaveBeenCalledWith({
          where: {
            domain: "example.com",
            enabled: true,
          },
        });
      });

      it("should handle uppercase email domains", async () => {
        mockFindFirst.mockResolvedValueOnce({
          domain: "example.com",
          enabled: true,
        });

        await isEmailDomainAllowed("user@EXAMPLE.COM");

        expect(mockFindFirst).toHaveBeenCalledWith({
          where: {
            domain: "example.com",
            enabled: true,
          },
        });
      });

      it("should return false for invalid email without @", async () => {
        const result = await isEmailDomainAllowed("invalid-email");

        expect(result).toBe(false);
      });

      it("should return false for email with empty domain", async () => {
        const result = await isEmailDomainAllowed("user@");

        expect(result).toBe(false);
      });
    });

    describe("edge cases", () => {
      it("should handle subdomains", async () => {
        mockFindFirst.mockResolvedValueOnce({
          restrictEmailDomains: true,
        });
        mockFindFirst.mockResolvedValueOnce({
          domain: "sub.example.com",
          enabled: true,
        });

        const result = await isEmailDomainAllowed("user@sub.example.com");

        expect(result).toBe(true);
      });

      it("should handle complex email addresses", async () => {
        mockFindFirst.mockResolvedValueOnce({
          restrictEmailDomains: true,
        });
        mockFindFirst.mockResolvedValueOnce({
          domain: "example.com",
          enabled: true,
        });

        const result = await isEmailDomainAllowed("user+tag@example.com");

        expect(result).toBe(true);
      });
    });
  });
});
