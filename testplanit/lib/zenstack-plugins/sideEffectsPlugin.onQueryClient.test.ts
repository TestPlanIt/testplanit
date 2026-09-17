import { ZenStackClient } from "@zenstackhq/orm";
import { PostgresDialect } from "@zenstackhq/orm/dialects/postgres";
import { Pool } from "pg";
import { afterAll, describe, expect, it } from "vitest";
import { schema } from "~/zenstack/schema";
import { sideEffectsPlugin } from "./sideEffectsPlugin";

/**
 * The `client` an onQuery hook receives is ZenStack's un-proxied instance,
 * which has no model accessors. The credentials hook used to call
 * `client.codeRepository.findUnique` on it, so every upsert or update that
 * carried plaintext credentials failed with
 * "Cannot read properties of undefined (reading 'findUnique')" before any
 * SQL ran — which is exactly how the admin modal creates a repository.
 *
 * No database is needed: the hook runs before the write reaches the driver,
 * so the pool below points at a closed port and only the error shape matters.
 */
describe("sideEffectsPlugin onQuery client", () => {
  const pool = new Pool({
    host: "127.0.0.1",
    port: 1,
    user: "nobody",
    database: "nowhere",
    connectionTimeoutMillis: 500,
    max: 1,
  });
  const client = new ZenStackClient(schema, {
    dialect: new PostgresDialect({ pool }),
  }).$use(sideEffectsPlugin);

  afterAll(async () => {
    await pool.end();
  });

  it("reads the stored credentials through a model accessor on upsert", async () => {
    const attempt = client.codeRepository.upsert({
      where: { name: "onquery-client-probe" },
      create: {
        name: "onquery-client-probe",
        provider: "GITHUB",
        credentials: { token: "plain" },
      },
      update: { credentials: { token: "plain" } },
    });
    // The read reaches the (unreachable) database instead of exploding on
    // the hook's client.
    await expect(attempt).rejects.not.toThrow(/findUnique/);
    await expect(attempt).rejects.not.toThrow(TypeError);
  });

  it("does the same for an update that retypes a secret", async () => {
    const attempt = client.codeRepository.update({
      where: { id: 1 },
      data: { credentials: { token: "plain" } },
    });
    await expect(attempt).rejects.not.toThrow(/findUnique/);
    await expect(attempt).rejects.not.toThrow(TypeError);
  });
});
