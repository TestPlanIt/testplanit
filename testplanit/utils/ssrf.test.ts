import { beforeEach, describe, expect, it, vi } from "vitest";

const mockLookup = vi.hoisted(() => vi.fn());
const mockGetAllowedPrivateHosts = vi.hoisted(() =>
  vi.fn(() => new Set<string>())
);

vi.mock("node:dns/promises", () => ({
  default: { lookup: mockLookup },
  lookup: mockLookup,
}));

// Keep the real isPrivateIp (numeric BlockList classifier) so the guard is
// exercised end-to-end; only getAllowedPrivateHosts is stubbed per-test.
vi.mock("~/lib/utils/ssrf", async (importActual) => {
  const actual = await importActual<typeof import("~/lib/utils/ssrf")>();
  return {
    ...actual,
    getAllowedPrivateHosts: mockGetAllowedPrivateHosts,
  };
});

import { Agent } from "undici";
import {
  assertSsrfSafeResolved,
  createPinnedDispatcher,
  isSsrfSafe,
} from "./ssrf";

describe("isSsrfSafe", () => {
  describe("blocks localhost", () => {
    it("blocks localhost by name", () => {
      expect(isSsrfSafe("https://localhost/api")).toBe(false);
    });

    it("blocks localhost with port", () => {
      expect(isSsrfSafe("https://localhost:3000/api")).toBe(false);
    });

    it("blocks 127.0.0.1", () => {
      expect(isSsrfSafe("https://127.0.0.1/api")).toBe(false);
    });

    it("blocks 127.x.x.x range", () => {
      expect(isSsrfSafe("https://127.255.255.255")).toBe(false);
    });
  });

  describe("blocks private IP ranges", () => {
    it("blocks 10.x.x.x (RFC 1918)", () => {
      expect(isSsrfSafe("https://10.0.0.1")).toBe(false);
      expect(isSsrfSafe("https://10.255.255.255")).toBe(false);
    });

    it("blocks 172.16-31.x.x (RFC 1918)", () => {
      expect(isSsrfSafe("https://172.16.0.1")).toBe(false);
      expect(isSsrfSafe("https://172.31.255.255")).toBe(false);
    });

    it("allows 172.32.x.x (outside private range)", () => {
      expect(isSsrfSafe("https://172.32.0.1")).toBe(true);
    });

    it("blocks 192.168.x.x (RFC 1918)", () => {
      expect(isSsrfSafe("https://192.168.0.1")).toBe(false);
      expect(isSsrfSafe("https://192.168.1.100")).toBe(false);
    });
  });

  describe("blocks AWS metadata / link-local", () => {
    it("blocks 169.254.x.x", () => {
      expect(isSsrfSafe("https://169.254.169.254/latest/meta-data")).toBe(
        false
      );
    });
  });

  describe("blocks 'this' network", () => {
    it("blocks 0.x.x.x", () => {
      expect(isSsrfSafe("https://0.0.0.0")).toBe(false);
    });
  });

  describe("blocks IPv6 addresses", () => {
    it("blocks ::1 (loopback)", () => {
      expect(isSsrfSafe("https://[::1]/api")).toBe(false);
    });

    it("blocks fc00:: (unique local)", () => {
      expect(isSsrfSafe("https://[fc00::1]/api")).toBe(false);
    });

    it("blocks fd00:: (unique local)", () => {
      expect(isSsrfSafe("https://[fd12::1]/api")).toBe(false);
    });

    it("blocks fe80:: (link-local)", () => {
      expect(isSsrfSafe("https://[fe80::1]/api")).toBe(false);
    });
  });

  describe("blocks IPv4-mapped IPv6 literals (GHSA-x7jm-4fpq-5mhm)", () => {
    // new URL() canonicalizes "[::ffff:127.0.0.1]" to "[::ffff:7f00:1]"; the old
    // string-prefix guard matched neither form and wrongly deemed it public.
    it("blocks mapped loopback (::ffff:127.0.0.1)", () => {
      expect(isSsrfSafe("http://[::ffff:127.0.0.1]:9099")).toBe(false);
    });

    it("blocks mapped loopback in compressed hex form (::ffff:7f00:1)", () => {
      expect(isSsrfSafe("http://[::ffff:7f00:1]:9099")).toBe(false);
    });

    it("blocks mapped cloud metadata (::ffff:169.254.169.254)", () => {
      expect(
        isSsrfSafe("http://[::ffff:169.254.169.254]/latest/meta-data")
      ).toBe(false);
    });

    it("blocks mapped RFC1918 (::ffff:10.0.0.1)", () => {
      expect(isSsrfSafe("http://[::ffff:10.0.0.1]")).toBe(false);
    });

    it("still allows a genuine public IPv6 literal", () => {
      expect(isSsrfSafe("https://[2606:4700::1]/")).toBe(true);
    });
  });

  describe("blocks non-HTTP protocols", () => {
    it("blocks file:// protocol", () => {
      expect(isSsrfSafe("file:///etc/passwd")).toBe(false);
    });

    it("blocks ftp:// protocol", () => {
      expect(isSsrfSafe("ftp://example.com/file")).toBe(false);
    });

    it("blocks javascript: protocol", () => {
      expect(isSsrfSafe("javascript:alert(1)")).toBe(false);
    });
  });

  describe("allows safe URLs", () => {
    it("allows public HTTPS URLs", () => {
      expect(isSsrfSafe("https://api.github.com/repos")).toBe(true);
    });

    it("allows public HTTP URLs", () => {
      expect(isSsrfSafe("http://example.com")).toBe(true);
    });

    it("allows self-hosted GitLab", () => {
      expect(isSsrfSafe("https://gitlab.mycompany.com/api/v4")).toBe(true);
    });

    it("allows Azure DevOps URLs", () => {
      expect(isSsrfSafe("https://dev.azure.com/myorg")).toBe(true);
    });

    it("allows self-hosted Gitea URLs", () => {
      expect(isSsrfSafe("https://gitea.mycompany.com/api/v1")).toBe(true);
    });
  });

  describe("handles invalid input", () => {
    it("returns false for invalid URL", () => {
      expect(isSsrfSafe("not a url")).toBe(false);
    });

    it("returns false for empty string", () => {
      expect(isSsrfSafe("")).toBe(false);
    });
  });

  describe("respects ALLOWED_PRIVATE_HOSTS", () => {
    it("allows private IP when hostname is in allowlist", () => {
      mockGetAllowedPrivateHosts.mockReturnValueOnce(
        new Set(["192.168.1.100"])
      );
      expect(isSsrfSafe("http://192.168.1.100:3000/api")).toBe(true);
    });

    it("allows localhost when in allowlist", () => {
      mockGetAllowedPrivateHosts.mockReturnValueOnce(new Set(["localhost"]));
      expect(isSsrfSafe("http://localhost:3000/api")).toBe(true);
    });

    it("still blocks private IP not in allowlist", () => {
      mockGetAllowedPrivateHosts.mockReturnValueOnce(new Set(["other.host"]));
      expect(isSsrfSafe("http://192.168.1.100:3000/api")).toBe(false);
    });

    it("accepts explicit allowedHosts parameter over env", () => {
      const explicit = new Set(["10.0.0.5"]);
      expect(isSsrfSafe("https://10.0.0.5/api", explicit)).toBe(true);
    });

    it("still blocks non-HTTP protocols even if host is allowed", () => {
      mockGetAllowedPrivateHosts.mockReturnValueOnce(new Set(["localhost"]));
      expect(isSsrfSafe("ftp://localhost/file")).toBe(false);
    });
  });
});

describe("assertSsrfSafeResolved", () => {
  beforeEach(() => {
    mockLookup.mockReset();
  });

  describe("blocks DNS rebinding attacks", () => {
    it("throws when hostname resolves to loopback", async () => {
      mockLookup.mockResolvedValueOnce({
        address: "127.0.0.1",
        family: 4,
      } as any);

      await expect(
        assertSsrfSafeResolved("https://evil.example.com/api")
      ).rejects.toThrow("hostname resolves to a private or internal address");
    });

    it("throws when hostname resolves to private 10.x.x.x", async () => {
      mockLookup.mockResolvedValueOnce({
        address: "10.0.0.1",
        family: 4,
      } as any);

      await expect(
        assertSsrfSafeResolved("https://evil.example.com/api")
      ).rejects.toThrow("hostname resolves to a private or internal address");
    });

    it("throws when hostname resolves to 192.168.x.x", async () => {
      mockLookup.mockResolvedValueOnce({
        address: "192.168.1.1",
        family: 4,
      } as any);

      await expect(
        assertSsrfSafeResolved("https://evil.example.com/api")
      ).rejects.toThrow("hostname resolves to a private or internal address");
    });

    it("throws when hostname resolves to AWS metadata IP", async () => {
      mockLookup.mockResolvedValueOnce({
        address: "169.254.169.254",
        family: 4,
      } as any);

      await expect(
        assertSsrfSafeResolved("https://evil.example.com/api")
      ).rejects.toThrow("hostname resolves to a private or internal address");
    });
  });

  describe("allows safe resolved addresses", () => {
    it("passes when hostname resolves to a public IP", async () => {
      mockLookup.mockResolvedValueOnce({
        address: "140.82.121.4",
        family: 4,
      } as any);

      await expect(
        assertSsrfSafeResolved("https://github.com/api")
      ).resolves.not.toThrow();
    });
  });

  describe("returns the IP to pin the connection to", () => {
    it("returns the resolved address for a hostname (for pinning)", async () => {
      mockLookup.mockResolvedValueOnce({ address: "140.82.121.4", family: 4 });

      await expect(
        assertSsrfSafeResolved("https://github.com/api")
      ).resolves.toBe("140.82.121.4");
    });

    it("returns null for a raw IPv4 literal (nothing to pin)", async () => {
      await expect(
        assertSsrfSafeResolved("https://140.82.121.4/api")
      ).resolves.toBeNull();
      expect(mockLookup).not.toHaveBeenCalled();
    });

    it("returns null for a public IPv6 literal", async () => {
      await expect(
        assertSsrfSafeResolved("https://[2606:4700::1]/api")
      ).resolves.toBeNull();
      expect(mockLookup).not.toHaveBeenCalled();
    });

    it("returns null for an allowlisted host (operator opt-in)", async () => {
      mockGetAllowedPrivateHosts.mockReturnValueOnce(new Set(["gitea.local"]));

      await expect(
        assertSsrfSafeResolved("http://gitea.local:3000/api")
      ).resolves.toBeNull();
      expect(mockLookup).not.toHaveBeenCalled();
    });
  });

  describe("skips DNS lookup for raw IPs", () => {
    it("skips lookup for IPv4 addresses", async () => {
      await assertSsrfSafeResolved("https://140.82.121.4/api");

      expect(mockLookup).not.toHaveBeenCalled();
    });

    it("skips lookup for IPv6 addresses", async () => {
      await assertSsrfSafeResolved("https://[2606:4700::1]/api");

      expect(mockLookup).not.toHaveBeenCalled();
    });
  });

  describe("blocks IPv4-mapped IPv6 literals without DNS (GHSA-x7jm-4fpq-5mhm)", () => {
    // Previously any host containing ":" short-circuited to return, so mapped
    // literals bypassed this re-check entirely. They must now be validated
    // numerically — no DNS lookup, but a hard block.
    it("throws for mapped loopback and does not call lookup", async () => {
      await expect(
        assertSsrfSafeResolved("http://[::ffff:127.0.0.1]:9099")
      ).rejects.toThrow("private or internal address");
      expect(mockLookup).not.toHaveBeenCalled();
    });

    it("throws for mapped cloud metadata", async () => {
      await expect(
        assertSsrfSafeResolved("http://[::ffff:169.254.169.254]/")
      ).rejects.toThrow("private or internal address");
      expect(mockLookup).not.toHaveBeenCalled();
    });

    it("allows a public IPv6 literal without DNS", async () => {
      await expect(
        assertSsrfSafeResolved("https://[2606:4700::1]/api")
      ).resolves.not.toThrow();
      expect(mockLookup).not.toHaveBeenCalled();
    });
  });

  describe("handles DNS failures", () => {
    it("throws on DNS resolution failure", async () => {
      mockLookup.mockRejectedValueOnce(new Error("ENOTFOUND"));

      await expect(
        assertSsrfSafeResolved("https://nonexistent.example.com/api")
      ).rejects.toThrow("DNS resolution failed");
    });
  });

  describe("respects ALLOWED_PRIVATE_HOSTS", () => {
    it("skips DNS check when hostname is in allowlist", async () => {
      mockGetAllowedPrivateHosts.mockReturnValueOnce(new Set(["gitea.local"]));

      await expect(
        assertSsrfSafeResolved("http://gitea.local:3000/api")
      ).resolves.not.toThrow();

      expect(mockLookup).not.toHaveBeenCalled();
    });

    it("still blocks hostname not in allowlist that resolves to private IP", async () => {
      mockGetAllowedPrivateHosts.mockReturnValueOnce(new Set(["other.host"]));
      mockLookup.mockResolvedValueOnce({ address: "192.168.1.100", family: 4 });

      await expect(
        assertSsrfSafeResolved("https://gitea.local/api")
      ).rejects.toThrow("hostname resolves to a private or internal address");
    });

    it("accepts explicit allowedHosts parameter", async () => {
      const explicit = new Set(["internal.gitea.corp"]);

      await expect(
        assertSsrfSafeResolved("https://internal.gitea.corp/api", explicit)
      ).resolves.not.toThrow();

      expect(mockLookup).not.toHaveBeenCalled();
    });
  });
});

describe("createPinnedDispatcher", () => {
  it("returns an undici dispatcher that closes cleanly", async () => {
    const dispatcher = createPinnedDispatcher("140.82.121.4");
    expect(dispatcher).toBeInstanceOf(Agent);
    // Fire-and-forget close must resolve (callers do not await it).
    await expect(dispatcher.close()).resolves.not.toThrow();
  });

  it("accepts IPv6 addresses without throwing", async () => {
    const dispatcher = createPinnedDispatcher("2606:4700::1");
    expect(dispatcher).toBeInstanceOf(Agent);
    await dispatcher.close();
  });
});
