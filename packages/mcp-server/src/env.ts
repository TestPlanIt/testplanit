import * as z from "zod/v4";

const DEFAULT_API_URL = "https://app.testplanit.com";

const EnvSchema = z.object({
  TESTPLANIT_API_TOKEN: z
    .string()
    .regex(/^tpi_/, "Token must start with tpi_"),
  TESTPLANIT_API_URL: z.string().url().default(DEFAULT_API_URL),
});

export interface EnvConfig {
  apiToken: string;
  apiUrl: string;
}

/**
 * Parse and validate the MCP server's environment.
 *
 * Throws a zod validation error when:
 *  - `TESTPLANIT_API_TOKEN` is missing or does not start with `tpi_`
 *  - `TESTPLANIT_API_URL` is set but is not a valid URL (omitting it uses the SaaS default)
 *
 * The returned `apiUrl` is normalized (trailing slash stripped).
 */
export function parseEnv(env: NodeJS.ProcessEnv): EnvConfig {
  const parsed = EnvSchema.parse(env);
  return {
    apiToken: parsed.TESTPLANIT_API_TOKEN,
    apiUrl: parsed.TESTPLANIT_API_URL.replace(/\/$/, ""),
  };
}
