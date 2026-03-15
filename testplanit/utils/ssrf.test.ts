import { describe, expect, it } from "vitest";
import { isSsrfSafe } from "./ssrf";

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
      expect(isSsrfSafe("https://169.254.169.254/latest/meta-data")).toBe(false);
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
  });

  describe("handles invalid input", () => {
    it("returns false for invalid URL", () => {
      expect(isSsrfSafe("not a url")).toBe(false);
    });

    it("returns false for empty string", () => {
      expect(isSsrfSafe("")).toBe(false);
    });
  });
});
