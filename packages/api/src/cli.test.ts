import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const clientMocks = vi.hoisted(() => ({
  createTestRun: vi.fn(async () => ({ id: 984, name: "Web Regression - DEV #984" })),
  completeTestRun: vi.fn(async () => ({ id: 984, name: "Web Regression - DEV #984" })),
  getTestRun: vi.fn(async () => ({ id: 984, name: "Web Regression - DEV #984", projectId: 9 })),
  findConfigurationByName: vi.fn(async () => ({ id: 7, name: "Chrome / macOS" })),
  findMilestoneByName: vi.fn(async () => ({ id: 8, name: "Release 2.0" })),
  resolveTagIds: vi.fn(async () => [11, 12]),
  constructed: [] as { baseUrl: string; apiToken: string }[],
}));

vi.mock("./client.js", async () => {
  const actual = await vi.importActual<typeof import("./client.js")>("./client.js");
  return {
    TestPlanItError: actual.TestPlanItError,
    TestPlanItClient: class MockClient {
      constructor(config: { baseUrl: string; apiToken: string }) {
        clientMocks.constructed.push(config);
      }
      createTestRun = clientMocks.createTestRun;
      completeTestRun = clientMocks.completeTestRun;
      getTestRun = clientMocks.getTestRun;
      findConfigurationByName = clientMocks.findConfigurationByName;
      findMilestoneByName = clientMocks.findMilestoneByName;
      resolveTagIds = clientMocks.resolveTagIds;
    },
  };
});

import { run, parseArgs, parseId } from "./cli.js";

const ENV_KEYS = [
  "TESTPLANIT_URL",
  "TESTPLANIT_API_URL",
  "TESTPLANIT_API_TOKEN",
  "TESTPLANIT_PROJECT_ID",
];

describe("testplanit CLI", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clientMocks.constructed.length = 0;
    for (const key of ENV_KEYS) delete process.env[key];
    process.env.TESTPLANIT_URL = "https://testplanit.example.com";
    process.env.TESTPLANIT_API_TOKEN = "tpi_test_token";
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    for (const key of ENV_KEYS) delete process.env[key];
  });

  describe("parseArgs", () => {
    it("parses --flag value pairs", () => {
      const { flags, positional } = parseArgs(["create-run", "--project", "9"]);
      expect(positional).toEqual(["create-run"]);
      expect(flags.get("project")).toEqual(["9"]);
    });

    it("parses --flag=value pairs", () => {
      const { flags } = parseArgs(["create-run", "--name=Nightly #4"]);
      expect(flags.get("name")).toEqual(["Nightly #4"]);
    });

    it("accumulates repeated flags", () => {
      const { flags } = parseArgs(["create-run", "--tag", "smoke", "--tag", "regression"]);
      expect(flags.get("tag")).toEqual(["smoke", "regression"]);
    });

    it("treats a valueless flag as present", () => {
      const { flags } = parseArgs(["--help"]);
      expect(flags.has("help")).toBe(true);
    });
  });

  describe("parseId", () => {
    it("accepts positive integers", () => {
      expect(parseId("42", "Test run ID")).toBe(42);
    });

    it("rejects non-numeric values", () => {
      expect(() => parseId("abc", "Test run ID")).toThrow("Test run ID must be a positive integer");
    });

    it("rejects zero", () => {
      expect(() => parseId("0", "Test run ID")).toThrow("Test run ID must be a positive integer");
    });
  });

  describe("create-run", () => {
    it("prints only the new run ID to stdout", async () => {
      const output = await run([
        "create-run",
        "--project",
        "9",
        "--name",
        "Web Regression - DEV #984",
      ]);

      expect(output).toBe("984");
      expect(clientMocks.createTestRun).toHaveBeenCalledWith(
        expect.objectContaining({ projectId: 9, name: "Web Regression - DEV #984" }),
      );
    });

    it("passes the run type through", async () => {
      await run(["create-run", "--project", "9", "--name", "R", "--type", "mocha"]);

      expect(clientMocks.createTestRun).toHaveBeenCalledWith(
        expect.objectContaining({ testRunType: "MOCHA" }),
      );
    });

    it("rejects an unknown run type", async () => {
      await expect(
        run(["create-run", "--project", "9", "--name", "R", "--type", "KARMA"]),
      ).rejects.toThrow('Unknown run type "KARMA"');
    });

    it("resolves configuration, milestone and tags by name", async () => {
      await run([
        "create-run",
        "--project",
        "9",
        "--name",
        "R",
        "--config",
        "Chrome / macOS",
        "--milestone",
        "Release 2.0",
        "--tag",
        "regression",
      ]);

      expect(clientMocks.findConfigurationByName).toHaveBeenCalledWith(9, "Chrome / macOS");
      expect(clientMocks.findMilestoneByName).toHaveBeenCalledWith(9, "Release 2.0");
      expect(clientMocks.resolveTagIds).toHaveBeenCalledWith(9, ["regression"]);
      expect(clientMocks.createTestRun).toHaveBeenCalledWith(
        expect.objectContaining({ configId: 7, milestoneId: 8, tagIds: [11, 12] }),
      );
    });

    it("accepts configuration and milestone as numeric IDs without a lookup", async () => {
      await run([
        "create-run",
        "--project",
        "9",
        "--name",
        "R",
        "--config",
        "7",
        "--milestone",
        "8",
      ]);

      expect(clientMocks.findConfigurationByName).not.toHaveBeenCalled();
      expect(clientMocks.findMilestoneByName).not.toHaveBeenCalled();
      expect(clientMocks.createTestRun).toHaveBeenCalledWith(
        expect.objectContaining({ configId: 7, milestoneId: 8 }),
      );
    });

    it("falls back to TESTPLANIT_PROJECT_ID", async () => {
      process.env.TESTPLANIT_PROJECT_ID = "9";
      await run(["create-run", "--name", "R"]);

      expect(clientMocks.createTestRun).toHaveBeenCalledWith(
        expect.objectContaining({ projectId: 9 }),
      );
    });

    it("requires a name", async () => {
      await expect(run(["create-run", "--project", "9"])).rejects.toThrow("Run name is required");
    });

    it("requires a project", async () => {
      await expect(run(["create-run", "--name", "R"])).rejects.toThrow("No project");
    });
  });

  describe("complete-run", () => {
    it("completes the run with an explicit project", async () => {
      const output = await run(["complete-run", "--id", "984", "--project", "9"]);

      expect(output).toBe("984");
      expect(clientMocks.completeTestRun).toHaveBeenCalledWith(984, 9);
      expect(clientMocks.getTestRun).not.toHaveBeenCalled();
    });

    it("reads the project from the run when not given", async () => {
      await run(["complete-run", "--id", "984"]);

      expect(clientMocks.getTestRun).toHaveBeenCalledWith(984);
      expect(clientMocks.completeTestRun).toHaveBeenCalledWith(984, 9);
    });

    it("requires a run ID", async () => {
      await expect(run(["complete-run"])).rejects.toThrow("Test run ID is required");
    });

    it("rejects a non-numeric run ID", async () => {
      await expect(run(["complete-run", "--id", "abc"])).rejects.toThrow(
        "Test run ID must be a positive integer",
      );
    });
  });

  describe("connection options", () => {
    it("prefers --url and --token over the environment", async () => {
      await run([
        "create-run",
        "--project",
        "9",
        "--name",
        "R",
        "--url",
        "https://other.example.com",
        "--token",
        "tpi_other",
      ]);

      expect(clientMocks.constructed[0]).toEqual({
        baseUrl: "https://other.example.com",
        apiToken: "tpi_other",
      });
    });

    it("falls back to TESTPLANIT_API_URL", async () => {
      delete process.env.TESTPLANIT_URL;
      process.env.TESTPLANIT_API_URL = "https://fallback.example.com";

      await run(["create-run", "--project", "9", "--name", "R"]);

      expect(clientMocks.constructed[0].baseUrl).toBe("https://fallback.example.com");
    });

    it("requires a URL", async () => {
      delete process.env.TESTPLANIT_URL;
      await expect(run(["create-run", "--project", "9", "--name", "R"])).rejects.toThrow(
        "No TestPlanIt URL",
      );
    });

    it("requires a token", async () => {
      delete process.env.TESTPLANIT_API_TOKEN;
      await expect(run(["create-run", "--project", "9", "--name", "R"])).rejects.toThrow(
        "No API token",
      );
    });
  });

  describe("usage", () => {
    it("prints usage with no command", async () => {
      const output = await run([]);
      expect(output).toContain("testplanit create-run");
      expect(output).toContain("TESTPLANIT_RUN_ID");
    });

    it("prints usage with --help", async () => {
      const output = await run(["create-run", "--help"]);
      expect(output).toContain("testplanit complete-run");
    });

    it("rejects an unknown command", async () => {
      await expect(run(["do-thing"])).rejects.toThrow('Unknown command "do-thing"');
    });
  });
});
