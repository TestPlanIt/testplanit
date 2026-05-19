import { describe, expect, it } from "vitest";
import { buildIterationDeepLink } from "./iterationDeepLink";

describe("buildIterationDeepLink", () => {
  it("produces matrix-popover-compatible URL with exact format", () => {
    const url = buildIterationDeepLink({
      projectId: 7,
      runId: 42,
      iterationNumber: 3,
      repositoryCaseId: 199,
    });
    // Format MUST match `/projects/runs/{projectId}/{runId}?iteration=N&selectedCase=ID`
    expect(url).toBe(
      "/projects/runs/7/42?iteration=3&selectedCase=199"
    );
  });

  it("URL is parseable and round-trips iteration + selectedCase query params", () => {
    const url = buildIterationDeepLink({
      projectId: 1,
      runId: 2,
      iterationNumber: 10,
      repositoryCaseId: 555,
    });
    // Prepend a host to use the URL parser
    const parsed = new URL("http://localhost" + url);
    expect(parsed.pathname).toBe("/projects/runs/1/2");
    expect(parsed.searchParams.get("iteration")).toBe("10");
    expect(parsed.searchParams.get("selectedCase")).toBe("555");
  });

  it("handles large IDs without scientific notation", () => {
    const url = buildIterationDeepLink({
      projectId: 999_999,
      runId: 1_000_000,
      iterationNumber: 1,
      repositoryCaseId: 2_000_000,
    });
    expect(url).toBe(
      "/projects/runs/999999/1000000?iteration=1&selectedCase=2000000"
    );
  });

  it("prepends an absolute origin when one is supplied (external-tracker case)", () => {
    const url = buildIterationDeepLink({
      projectId: 7,
      runId: 42,
      iterationNumber: 3,
      repositoryCaseId: 199,
      origin: "https://testplanit.example.com",
    });
    expect(url).toBe(
      "https://testplanit.example.com/projects/runs/7/42?iteration=3&selectedCase=199"
    );
  });

  it("strips a single trailing slash from the origin so callers can pass NEXTAUTH_URL verbatim", () => {
    const url = buildIterationDeepLink({
      projectId: 7,
      runId: 42,
      iterationNumber: 3,
      repositoryCaseId: 199,
      origin: "https://testplanit.example.com/",
    });
    expect(url).toBe(
      "https://testplanit.example.com/projects/runs/7/42?iteration=3&selectedCase=199"
    );
  });

  it("strips multiple trailing slashes from the origin", () => {
    const url = buildIterationDeepLink({
      projectId: 7,
      runId: 42,
      iterationNumber: 3,
      repositoryCaseId: 199,
      origin: "https://testplanit.example.com////",
    });
    expect(url).toBe(
      "https://testplanit.example.com/projects/runs/7/42?iteration=3&selectedCase=199"
    );
  });

  it("treats an empty-string origin as 'no origin' (relative path)", () => {
    const url = buildIterationDeepLink({
      projectId: 7,
      runId: 42,
      iterationNumber: 3,
      repositoryCaseId: 199,
      origin: "",
    });
    expect(url).toBe("/projects/runs/7/42?iteration=3&selectedCase=199");
  });

  it("treats null origin as 'no origin' (relative path)", () => {
    const url = buildIterationDeepLink({
      projectId: 7,
      runId: 42,
      iterationNumber: 3,
      repositoryCaseId: 199,
      origin: null,
    });
    expect(url).toBe("/projects/runs/7/42?iteration=3&selectedCase=199");
  });
});
