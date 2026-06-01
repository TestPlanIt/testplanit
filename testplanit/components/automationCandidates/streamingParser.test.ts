import { describe, expect, it } from "vitest";
import {
  extractCandidatesFromBuffer,
  extractSummaryFromBuffer,
} from "./streamingParser";

describe("extractCandidatesFromBuffer", () => {
  it("returns no candidates before the candidates array even starts", () => {
    expect(extractCandidatesFromBuffer("{")).toEqual([]);
    expect(extractCandidatesFromBuffer('{"sum')).toEqual([]);
    expect(extractCandidatesFromBuffer('{"candidates":')).toEqual([]);
  });

  it("extracts a single complete candidate as soon as its closing brace arrives", () => {
    const partial =
      '{"candidates": [{"caseId":42,"rank":1,"score":95,"rationale":"Critical login flow"}';
    expect(extractCandidatesFromBuffer(partial)).toEqual([
      { caseId: 42, rank: 1, score: 95, rationale: "Critical login flow" },
    ]);
  });

  it("extracts every complete candidate but waits for the in-progress one", () => {
    const partial =
      '{"candidates": [' +
      '{"caseId":1,"rank":1,"score":90,"rationale":"x"},' +
      '{"caseId":2,"rank":2,"score":85,"rationale":"y"},' +
      '{"caseId":3,"rank":3,"score":80,"rationale":"par';
    const result = extractCandidatesFromBuffer(partial);
    expect(result).toEqual([
      { caseId: 1, rank: 1, score: 90, rationale: "x" },
      { caseId: 2, rank: 2, score: 85, rationale: "y" },
    ]);
  });

  it("tolerates quoted strings that contain braces", () => {
    const partial =
      '{"candidates": [{"caseId":1,"rank":1,"score":50,"rationale":"see {note}"}]';
    expect(extractCandidatesFromBuffer(partial)).toEqual([
      { caseId: 1, rank: 1, score: 50, rationale: "see {note}" },
    ]);
  });

  it("tolerates escaped quotes inside strings", () => {
    const partial =
      '{"candidates": [{"caseId":1,"rank":1,"score":50,"rationale":"He said \\"hi\\" then left"}]';
    expect(extractCandidatesFromBuffer(partial)).toEqual([
      {
        caseId: 1,
        rank: 1,
        score: 50,
        rationale: 'He said "hi" then left',
      },
    ]);
  });

  it("skips malformed entries silently and keeps reading", () => {
    const partial =
      '{"candidates": [' +
      // missing required field "score"
      '{"caseId":1,"rank":1,"rationale":"x"},' +
      '{"caseId":2,"rank":2,"score":85,"rationale":"y"}]';
    expect(extractCandidatesFromBuffer(partial)).toEqual([
      { caseId: 2, rank: 2, score: 85, rationale: "y" },
    ]);
  });

  it("handles whitespace and newlines between entries", () => {
    const partial =
      '{\n  "candidates": [\n' +
      '    {"caseId":1,"rank":1,"score":90,"rationale":"x"},\n' +
      '    {"caseId":2,"rank":2,"score":85,"rationale":"y"}\n' +
      "  ]";
    expect(extractCandidatesFromBuffer(partial)).toEqual([
      { caseId: 1, rank: 1, score: 90, rationale: "x" },
      { caseId: 2, rank: 2, score: 85, rationale: "y" },
    ]);
  });
});

describe("extractSummaryFromBuffer", () => {
  it("returns null until summary appears", () => {
    expect(
      extractSummaryFromBuffer(
        '{"candidates": [{"caseId":1,"rank":1,"score":90,"rationale":"x"}]'
      )
    ).toBeNull();
  });

  it("returns null until the summary closing quote arrives", () => {
    expect(
      extractSummaryFromBuffer('{"candidates": [...], "summary":"In progres')
    ).toBeNull();
  });

  it("returns the summary once it is fully quoted", () => {
    expect(
      extractSummaryFromBuffer(
        '{"candidates": [...], "summary":"Top picks favor stable critical-path checks."}'
      )
    ).toBe("Top picks favor stable critical-path checks.");
  });

  it("handles escaped quotes inside the summary", () => {
    expect(
      extractSummaryFromBuffer(
        '{"candidates": [], "summary":"Author said \\"automate the login flow\\" — agreed."}'
      )
    ).toBe('Author said "automate the login flow" — agreed.');
  });
});
