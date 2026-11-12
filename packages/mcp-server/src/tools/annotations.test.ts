import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer } from "../server.js";

type ListedTool = Awaited<ReturnType<Client["listTools"]>>["tools"][number];

describe("tool annotations", () => {
  let client: Client;
  let closeServer: () => Promise<void>;
  let tools: ListedTool[];

  const tool = (name: string) => {
    const found = tools.find((t) => t.name === name);
    if (!found) throw new Error(`tool ${name} is not registered`);
    return found;
  };

  beforeAll(async () => {
    const server = createServer({
      env: { apiUrl: "https://example.invalid", apiToken: "tpi_fake" },
      user: {
        id: "u_1",
        name: "Alice",
        email: "a@example.com",
        scopes: ["mode:read"],
        readOnly: true,
        isAgent: false,
      },
    });
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();
    client = new Client({ name: "test-client", version: "0.0.0" });
    await Promise.all([
      server.connect(serverTransport),
      client.connect(clientTransport),
    ]);
    closeServer = () => server.close();
    tools = (await client.listTools()).tools;
  });

  afterAll(async () => {
    await client.close();
    await closeServer();
  });

  it("gives every tool a read-only hint and an open-world hint", () => {
    const missing = tools
      .filter(
        (t) =>
          typeof t.annotations?.readOnlyHint !== "boolean" ||
          typeof t.annotations?.openWorldHint !== "boolean",
      )
      .map((t) => t.name);

    expect(missing).toEqual([]);
  });

  it("marks every list, get and count tool as read-only", () => {
    const readNames = tools
      .map((t) => t.name)
      .filter((name) => /_(list|get|count)$|_list_|^whoami$/.test(name));

    expect(readNames.length).toBeGreaterThan(20);
    for (const name of readNames) {
      expect(tool(name).annotations?.readOnlyHint, name).toBe(true);
    }
  });

  it("never marks a tool that writes as read-only", () => {
    const writeNames = tools
      .map((t) => t.name)
      .filter((name) =>
        /_(create|create_many|update|delete|link|unlink|add|remove|decide|execute|resolve|generate_script)$/.test(
          name,
        ),
      );

    expect(writeNames.length).toBeGreaterThan(15);
    for (const name of writeNames) {
      expect(tool(name).annotations?.readOnlyHint, name).toBe(false);
    }
  });

  it("gives every writing tool an explicit destructive hint", () => {
    const unstated = tools
      .filter(
        (t) =>
          t.annotations?.readOnlyHint === false &&
          typeof t.annotations.destructiveHint !== "boolean",
      )
      .map((t) => t.name);

    expect(unstated).toEqual([]);
  });

  it("marks deletes, removals, unlinks, updates and review decisions as destructive", () => {
    for (const name of [
      "testplanit_cases_delete",
      "testplanit_folders_delete",
      "testplanit_runs_cases_remove",
      "testplanit_issues_unlink",
      "testplanit_cases_update",
      "testplanit_reviews_decide",
    ]) {
      expect(tool(name).annotations?.destructiveHint, name).toBe(true);
    }
  });

  it("marks tools that only add records as not destructive", () => {
    for (const name of [
      "testplanit_cases_create",
      "testplanit_cases_create_many",
      "testplanit_test_run_results_create",
      "testplanit_issues_link",
    ]) {
      expect(tool(name).annotations?.destructiveHint, name).toBe(false);
    }
  });

  it("marks soft-deletes as idempotent", () => {
    expect(tool("testplanit_cases_delete").annotations?.idempotentHint).toBe(
      true,
    );
    expect(tool("testplanit_folders_delete").annotations?.idempotentHint).toBe(
      true,
    );
  });

  it("marks only the tools that reach an external system as open-world", () => {
    const openWorld = tools
      .filter((t) => t.annotations?.openWorldHint === true)
      .map((t) => t.name)
      .sort();

    expect(openWorld).toEqual([
      "testplanit_cases_generate_script",
      "testplanit_issues_link",
      "testplanit_issues_resolve",
      "testplanit_runs_execute",
    ]);
  });
});
