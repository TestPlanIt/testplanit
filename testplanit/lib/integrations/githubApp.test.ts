import { generateKeyPairSync } from "node:crypto";
import jwt from "jsonwebtoken";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createGitHubAppJwt,
  githubApiRoot,
  mintGitHubInstallationToken,
  normalizePrivateKey,
} from "./githubApp";

const { privateKey, publicKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  privateKeyEncoding: { type: "pkcs1", format: "pem" },
  publicKeyEncoding: { type: "spki", format: "pem" },
});

const mockFetch = vi.fn();

describe("GitHub App authentication", () => {
  beforeEach(() => {
    mockFetch.mockReset();
    vi.stubGlobal("fetch", mockFetch);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe("normalizePrivateKey", () => {
    it("restores the line breaks of a key pasted on one line", () => {
      const oneLine = privateKey.trim().replace(/\n/g, "\\n");
      expect(normalizePrivateKey(oneLine)).toBe(privateKey.trim());
    });

    it("leaves a key pasted whole as it is, without the blank lines around it", () => {
      expect(normalizePrivateKey(`\n${privateKey}\n`)).toBe(privateKey.trim());
    });
  });

  describe("createGitHubAppJwt", () => {
    it("signs a backdated nine-minute RS256 token issued by the App", () => {
      const now = Date.UTC(2026, 10, 27, 12, 0, 0);
      const token = createGitHubAppJwt(" 123456 ", privateKey, now);

      const claims = jwt.verify(token, publicKey, {
        algorithms: ["RS256"],
        clockTimestamp: now / 1000,
      }) as jwt.JwtPayload;

      expect(claims.iss).toBe("123456");
      expect(claims.iat).toBe(now / 1000 - 60);
      expect(claims.exp).toBe(now / 1000 + 9 * 60);
    });
  });

  describe("githubApiRoot", () => {
    it("is github.com's API unless a server's root is given", () => {
      expect(githubApiRoot()).toBe("https://api.github.com");
      expect(githubApiRoot("https://ghes.example.com/api/v3/")).toBe(
        "https://ghes.example.com/api/v3"
      );
    });
  });

  describe("mintGitHubInstallationToken", () => {
    const app = { appId: "123456", installationId: "987", privateKey };

    it("exchanges the App's token for an installation token", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          token: "ghs_installation",
          expires_at: "2026-11-27T13:00:00Z",
        }),
      });

      const result = await mintGitHubInstallationToken({
        ...app,
        baseUrl: "https://ghes.example.com/api/v3",
      });

      expect(result).toEqual({
        token: "ghs_installation",
        expiresAt: new Date("2026-11-27T13:00:00Z"),
      });
      const [url, init] = mockFetch.mock.calls[0];
      expect(url).toBe(
        "https://ghes.example.com/api/v3/app/installations/987/access_tokens"
      );
      expect(init.method).toBe("POST");
      const bearer = String(init.headers.Authorization).replace("Bearer ", "");
      expect(
        (jwt.verify(bearer, publicKey, { algorithms: ["RS256"] }) as any).iss
      ).toBe("123456");
    });

    it("says which parts of the configuration are missing, without calling GitHub", async () => {
      await expect(
        mintGitHubInstallationToken({ appId: "1", privateKey: "  " })
      ).rejects.toThrow(
        "GitHub App configuration is incomplete (missing installationId, privateKey)"
      );
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("reports an unreadable key without quoting it", async () => {
      await expect(
        mintGitHubInstallationToken({ ...app, privateKey: "not a key" })
      ).rejects.toThrow(
        "The GitHub App private key could not be read; paste the whole .pem file"
      );
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("passes on GitHub's reason when it refuses", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        statusText: "Not Found",
        json: async () => ({ message: "Integration not found" }),
      });

      await expect(mintGitHubInstallationToken(app)).rejects.toThrow(
        "HTTP 404: Integration not found"
      );
    });

    it("refuses an answer without a token", async () => {
      mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({}) });

      await expect(mintGitHubInstallationToken(app)).rejects.toThrow(
        "GitHub returned no installation token"
      );
    });
  });
});
