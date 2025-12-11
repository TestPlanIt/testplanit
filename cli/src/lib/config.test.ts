import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock the conf module before importing config
vi.mock("conf", () => {
  const store: Record<string, any> = {};
  return {
    default: vi.fn().mockImplementation(() => ({
      get: vi.fn((key: string) => store[key]),
      set: vi.fn((key: string, value: any) => {
        store[key] = value;
      }),
      clear: vi.fn(() => {
        for (const key in store) {
          delete store[key];
        }
      }),
      path: "/mock/config/path/testplanit-cli/config.json",
      store,
    })),
  };
});

import {
  getUrl,
  getToken,
  setUrl,
  setToken,
  getConfig,
  getStoredConfig,
  clearConfig,
  getConfigPath,
  validateConfig,
} from "./config.js";

describe("Config Module", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.clearAllMocks();
    // Clear env vars
    delete process.env.TESTPLANIT_URL;
    delete process.env.TESTPLANIT_TOKEN;
    // Clear the stored config
    clearConfig();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  describe("getUrl", () => {
    it("returns environment variable when set", () => {
      process.env.TESTPLANIT_URL = "https://env.example.com";
      setUrl("https://stored.example.com");

      expect(getUrl()).toBe("https://env.example.com");
    });

    it("returns stored config when env var not set", () => {
      setUrl("https://stored.example.com");

      expect(getUrl()).toBe("https://stored.example.com");
    });

    it("returns undefined when neither is set", () => {
      expect(getUrl()).toBeUndefined();
    });
  });

  describe("getToken", () => {
    it("returns environment variable when set", () => {
      process.env.TESTPLANIT_TOKEN = "tpi_env_token";
      setToken("tpi_stored_token");

      expect(getToken()).toBe("tpi_env_token");
    });

    it("returns stored config when env var not set", () => {
      setToken("tpi_stored_token");

      expect(getToken()).toBe("tpi_stored_token");
    });

    it("returns undefined when neither is set", () => {
      expect(getToken()).toBeUndefined();
    });
  });

  describe("setUrl", () => {
    it("stores URL in config", () => {
      setUrl("https://new.example.com");

      expect(getStoredConfig().url).toBe("https://new.example.com");
    });

    it("overwrites previous URL", () => {
      setUrl("https://first.example.com");
      setUrl("https://second.example.com");

      expect(getStoredConfig().url).toBe("https://second.example.com");
    });
  });

  describe("setToken", () => {
    it("stores token in config", () => {
      setToken("tpi_new_token");

      expect(getStoredConfig().token).toBe("tpi_new_token");
    });

    it("overwrites previous token", () => {
      setToken("tpi_first_token");
      setToken("tpi_second_token");

      expect(getStoredConfig().token).toBe("tpi_second_token");
    });
  });

  describe("getConfig", () => {
    it("returns combined config with env vars taking precedence", () => {
      process.env.TESTPLANIT_URL = "https://env.example.com";
      setUrl("https://stored.example.com");
      setToken("tpi_stored_token");

      const config = getConfig();

      expect(config).toEqual({
        url: "https://env.example.com",
        token: "tpi_stored_token",
      });
    });

    it("returns stored config when no env vars set", () => {
      setUrl("https://stored.example.com");
      setToken("tpi_stored_token");

      const config = getConfig();

      expect(config).toEqual({
        url: "https://stored.example.com",
        token: "tpi_stored_token",
      });
    });

    it("returns undefined values when nothing is configured", () => {
      const config = getConfig();

      expect(config).toEqual({
        url: undefined,
        token: undefined,
      });
    });
  });

  describe("getStoredConfig", () => {
    it("returns only stored config, ignoring env vars", () => {
      process.env.TESTPLANIT_URL = "https://env.example.com";
      process.env.TESTPLANIT_TOKEN = "tpi_env_token";
      setUrl("https://stored.example.com");

      const config = getStoredConfig();

      expect(config.url).toBe("https://stored.example.com");
      expect(config.token).toBeUndefined();
    });
  });

  describe("clearConfig", () => {
    it("clears all stored configuration", () => {
      setUrl("https://example.com");
      setToken("tpi_token");

      clearConfig();

      expect(getStoredConfig().url).toBeUndefined();
      expect(getStoredConfig().token).toBeUndefined();
    });
  });

  describe("getConfigPath", () => {
    it("returns the config file path", () => {
      const path = getConfigPath();

      expect(path).toBe("/mock/config/path/testplanit-cli/config.json");
    });
  });

  describe("validateConfig", () => {
    it("returns null when both URL and token are configured", () => {
      setUrl("https://example.com");
      setToken("tpi_token");

      expect(validateConfig()).toBeNull();
    });

    it("returns null when config comes from env vars", () => {
      process.env.TESTPLANIT_URL = "https://env.example.com";
      process.env.TESTPLANIT_TOKEN = "tpi_env_token";

      expect(validateConfig()).toBeNull();
    });

    it("returns error message when URL is missing", () => {
      setToken("tpi_token");

      const error = validateConfig();

      expect(error).toContain("URL is not configured");
      expect(error).toContain("testplanit config set --url");
      expect(error).toContain("TESTPLANIT_URL");
    });

    it("returns error message when token is missing", () => {
      setUrl("https://example.com");

      const error = validateConfig();

      expect(error).toContain("API token is not configured");
      expect(error).toContain("testplanit config set --token");
      expect(error).toContain("TESTPLANIT_TOKEN");
    });

    it("returns URL error first when both are missing", () => {
      const error = validateConfig();

      expect(error).toContain("URL is not configured");
    });
  });
});
