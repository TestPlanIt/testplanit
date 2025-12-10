/**
 * Config Command
 *
 * Manage CLI configuration (URL and API token).
 */

import { Command } from "commander";
import * as config from "../lib/config.js";
import * as logger from "../lib/logger.js";

export function createConfigCommand(): Command {
  const cmd = new Command("config").description("Manage CLI configuration");

  // config set
  cmd
    .command("set")
    .description("Set configuration values")
    .option("-u, --url <url>", "TestPlanIt instance URL")
    .option("-t, --token <token>", "API token")
    .action((options) => {
      let updated = false;

      if (options.url) {
        // Normalize URL (remove trailing slash)
        let url = options.url.trim();
        if (url.endsWith("/")) {
          url = url.slice(0, -1);
        }

        // Validate URL format
        try {
          new URL(url);
        } catch {
          logger.error(`Invalid URL: ${options.url}`);
          process.exit(1);
        }

        config.setUrl(url);
        logger.success(`URL set to ${logger.formatUrl(url)}`);
        updated = true;
      }

      if (options.token) {
        const token = options.token.trim();

        // Validate token format
        if (!token.startsWith("tpi_")) {
          logger.warn("Token should start with 'tpi_'. Are you sure this is a valid TestPlanIt API token?");
        }

        config.setToken(token);
        logger.success(`Token set to ${logger.formatToken(token)}`);
        updated = true;
      }

      if (!updated) {
        logger.warn("No configuration values provided. Use --url or --token options.");
        cmd.help();
      }
    });

  // config show
  cmd
    .command("show")
    .description("Show current configuration")
    .action(() => {
      const storedConfig = config.getStoredConfig();
      const effectiveConfig = config.getConfig();

      console.log();
      console.log("Configuration file:", config.getConfigPath());
      console.log();

      // URL
      console.log("URL:");
      if (process.env.TESTPLANIT_URL) {
        console.log(`  Stored:    ${storedConfig.url ? logger.formatUrl(storedConfig.url) : "(not set)"}`);
        console.log(`  Env var:   ${logger.formatUrl(process.env.TESTPLANIT_URL)} (active)`);
      } else if (storedConfig.url) {
        console.log(`  ${logger.formatUrl(storedConfig.url)}`);
      } else {
        console.log("  (not set)");
      }

      console.log();

      // Token
      console.log("Token:");
      if (process.env.TESTPLANIT_TOKEN) {
        console.log(`  Stored:    ${storedConfig.token ? logger.formatToken(storedConfig.token) : "(not set)"}`);
        console.log(`  Env var:   ${logger.formatToken(process.env.TESTPLANIT_TOKEN)} (active)`);
      } else if (storedConfig.token) {
        console.log(`  ${logger.formatToken(storedConfig.token)}`);
      } else {
        console.log("  (not set)");
      }

      console.log();

      // Validation
      const validationError = config.validateConfig();
      if (validationError) {
        logger.warn(validationError);
      } else {
        logger.success("Configuration is complete");
      }
    });

  // config clear
  cmd
    .command("clear")
    .description("Clear all stored configuration")
    .action(() => {
      config.clearConfig();
      logger.success("Configuration cleared");
    });

  // config path
  cmd
    .command("path")
    .description("Show configuration file path")
    .action(() => {
      console.log(config.getConfigPath());
    });

  return cmd;
}
