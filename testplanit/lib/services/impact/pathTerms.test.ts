import { describe, expect, it } from "vitest";
import {
  MAX_PATH_TERMS,
  PATH_STOP_SEGMENTS,
  derivePathTerms,
  tokenizeSegment,
} from "./pathTerms";
import type { DiffFileSummary, DiffSummary } from "./types";

function file(
  path: string,
  symbols: string[] = [],
  overrides: Partial<DiffFileSummary> = {}
): DiffFileSummary {
  return {
    path,
    status: "modified",
    additions: 1,
    deletions: 1,
    class: "source",
    detail: "hunks",
    hunks:
      symbols.length > 0
        ? [
            {
              header: "@@ -1,1 +1,1 @@",
              oldStart: 1,
              oldLines: 1,
              newStart: 1,
              newLines: 1,
              changedSymbols: symbols,
            },
          ]
        : [],
    ...overrides,
  };
}

function summaryOf(files: DiffFileSummary[]): DiffSummary {
  return {
    baseSha: "a",
    headSha: "b",
    files,
    excludedFiles: [],
    totalFiles: files.length,
    truncatedByProvider: false,
    truncatedByBudget: false,
    omittedFileCount: 0,
    estimatedTokens: 0,
  };
}

describe("tokenizeSegment", () => {
  it("splits camelCase and PascalCase", () => {
    expect(tokenizeSegment("validatePassword")).toEqual([
      "validate",
      "password",
    ]);
    expect(tokenizeSegment("LoginForm")).toEqual(["login", "form"]);
    expect(tokenizeSegment("HTMLParser")).toEqual(["html", "parser"]);
  });

  it("splits on dots, dashes, underscores and brackets", () => {
    expect(tokenizeSegment("login-page_form.view")).toEqual([
      "login",
      "form",
      "view",
    ]);
    expect(tokenizeSegment("[projectId]")).toEqual(["project"]);
  });

  it("drops short tokens and stop segments", () => {
    expect(tokenizeSegment("ui")).toEqual([]);
    expect(tokenizeSegment("db.ts")).toEqual([]);
    for (const stop of ["src", "components", "index", "spec", "tests"]) {
      expect(PATH_STOP_SEGMENTS.has(stop)).toBe(true);
      expect(tokenizeSegment(stop)).toEqual([]);
    }
  });
});

describe("derivePathTerms", () => {
  it("weights symbols over filenames over directories", () => {
    const terms = derivePathTerms(
      summaryOf([file("src/auth/LoginForm.tsx", ["validatePassword"])])
    );
    expect(terms.symbolTerms).toEqual(["validate", "password"]);
    expect(terms.pathTerms).toEqual(["login", "form", "auth"]);
    expect(terms.weights.get("validate")).toBe(3);
    expect(terms.weights.get("password")).toBe(3);
    expect(terms.weights.get("login")).toBe(2);
    expect(terms.weights.get("form")).toBe(2);
    expect(terms.weights.get("auth")).toBe(1.5);
    expect(terms.weights.has("src")).toBe(false);
    expect(terms.weights.has("tsx")).toBe(false);
  });

  it("gives the innermost directory the bonus and outer ones weight 1", () => {
    const terms = derivePathTerms(
      summaryOf([file("billing/invoices/pdf/render.ts")])
    );
    expect(terms.weights.get("billing")).toBe(1);
    expect(terms.weights.get("invoices")).toBe(1);
    expect(terms.weights.get("pdf")).toBe(1.5);
    expect(terms.weights.get("render")).toBe(2);
  });

  it("accumulates weight for a token seen in several files", () => {
    const terms = derivePathTerms(
      summaryOf([file("auth/login.ts"), file("auth/logout.ts")])
    );
    expect(terms.weights.get("auth")).toBe(3);
    expect([...terms.weights.keys()][0]).toBe("auth");
  });

  it("counts a symbol once per file even when several hunks touch it", () => {
    const f = file("x/y.ts");
    f.hunks = [
      {
        header: "@@ -1,1 +1,1 @@",
        oldStart: 1,
        oldLines: 1,
        newStart: 1,
        newLines: 1,
        changedSymbols: ["saveOrder"],
      },
      {
        header: "@@ -9,1 +9,1 @@",
        oldStart: 9,
        oldLines: 1,
        newStart: 9,
        newLines: 1,
        changedSymbols: ["saveOrder"],
      },
    ];
    const terms = derivePathTerms(summaryOf([f]));
    expect(terms.weights.get("save")).toBe(3);
    expect(terms.weights.get("order")).toBe(3);
  });

  it("drops tokens of two characters or fewer and stop segments", () => {
    const terms = derivePathTerms(
      summaryOf([file("src/ui/db.ts"), file("lib/app/index.ts")])
    );
    expect(terms.pathTerms).toEqual([]);
    expect(terms.symbolTerms).toEqual([]);
    expect(terms.weights.size).toBe(0);
  });

  it("drops prose stop words shared with relevance-terms", () => {
    const terms = derivePathTerms(summaryOf([file("with/user/verify.ts")]));
    expect(terms.pathTerms).toEqual([]);
  });

  it("keeps only the top 40 terms by weight", () => {
    const files = [
      file("payments/checkout.ts", ["chargeCard"]),
      ...Array.from({ length: 50 }, (_, i) =>
        file(`feature${String(i).padStart(2, "0")}.ts`)
      ),
    ];
    const terms = derivePathTerms(summaryOf(files));
    expect(terms.weights.size).toBe(MAX_PATH_TERMS);
    const ordered = [...terms.weights.keys()];
    expect(ordered.slice(0, 3)).toEqual(["charge", "card", "checkout"]);
    expect(ordered).not.toContain("payments");
    expect(ordered).toContain("feature36");
    expect(ordered).not.toContain("feature37");
    expect(terms.pathTerms.length + terms.symbolTerms.length).toBe(
      MAX_PATH_TERMS
    );
  });

  it("collects raw filename stems and directory names as exact segments", () => {
    const terms = derivePathTerms(
      summaryOf([
        file("src/auth/login.spec.ts"),
        file("Billing/Invoice-PDF/render.ts"),
        file("src/auth/login.ts"),
      ])
    );
    expect(terms.exactSegments).toEqual([
      "auth",
      "login",
      "billing",
      "invoice-pdf",
      "render",
    ]);
  });

  it("includes the previous path of a rename", () => {
    const terms = derivePathTerms(
      summaryOf([
        file("auth/signin.ts", [], {
          status: "renamed",
          previousPath: "auth/login.ts",
        }),
      ])
    );
    expect(terms.pathTerms).toContain("login");
    expect(terms.pathTerms).toContain("signin");
    expect(terms.weights.get("auth")).toBe(3);
  });

  it("tolerates empty and malformed summaries", () => {
    expect(derivePathTerms(summaryOf([])).weights.size).toBe(0);
    const terms = derivePathTerms({
      ...summaryOf([]),
      files: [undefined as unknown as DiffFileSummary, file("")],
    });
    expect(terms.pathTerms).toEqual([]);
  });
});
