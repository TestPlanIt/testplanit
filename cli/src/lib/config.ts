/**
 * Configuration Management
 *
 * Uses the `conf` package for cross-platform configuration storage.
 * Environment variables take precedence over stored config.
 */

import Conf from "conf";
import type { CLIConfig } from "../types.js";

const config = new Conf<CLIConfig>({
  projectName: "testplanit-cli",
  schema: {
    url: {
      type: "string",
    },
    token: {
      type: "string",
    },
  },
});

/**
 * Get the TestPlanIt URL
 * Priority: TESTPLANIT_URL env var > stored config
 */
export function getUrl(): string | undefined {
  return process.env.TESTPLANIT_URL || config.get("url");
}

/**
 * Get the API token
 * Priority: TESTPLANIT_TOKEN env var > stored config
 */
export function getToken(): string | undefined {
  return process.env.TESTPLANIT_TOKEN || config.get("token");
}

/**
 * Set the TestPlanIt URL in stored config
 */
export function setUrl(url: string): void {
  config.set("url", url);
}

/**
 * Set the API token in stored config
 */
export function setToken(token: string): void {
  config.set("token", token);
}

/**
 * Get all configuration (with environment variable overrides applied)
 */
export function getConfig(): CLIConfig {
  return {
    url: getUrl(),
    token: getToken(),
  };
}

/**
 * Get stored configuration (without environment variable overrides)
 */
export function getStoredConfig(): CLIConfig {
  return {
    url: config.get("url"),
    token: config.get("token"),
  };
}

/**
 * Clear all stored configuration
 */
export function clearConfig(): void {
  config.clear();
}

/**
 * Get the path to the config file
 */
export function getConfigPath(): string {
  return config.path;
}

/**
 * Validate that required configuration is present
 * Returns an error message if configuration is missing, or null if valid
 */
export function validateConfig(): string | null {
  const url = getUrl();
  const token = getToken();

  if (!url) {
    return "TestPlanIt URL is not configured. Run `testplanit config set --url <url>` or set TESTPLANIT_URL environment variable.";
  }

  if (!token) {
    return "API token is not configured. Run `testplanit config set --token <token>` or set TESTPLANIT_TOKEN environment variable.";
  }

  return null;
}
