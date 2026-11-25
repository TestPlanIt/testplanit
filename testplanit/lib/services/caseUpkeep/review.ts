import {
  describeField,
  type TemplateData,
} from "~/app/api/llm/generate-test-cases/shared";
import { withFieldGuidance } from "~/app/api/llm/generate-test-cases/fieldGuidance";
import { LLM_FEATURES } from "~/lib/llm/constants";
import { LlmManager } from "~/lib/llm/services/llm-manager.service";
import { fillPrompt } from "~/lib/llm/services/prompt-fill";
import { PromptResolver } from "~/lib/llm/services/prompt-resolver.service";
import type { UpkeepCase, UpkeepCaseText } from "./caseText";
import { parseUpkeepResponse, type UpkeepDecision } from "./decisions";

/** The most test cases put in front of the model in one request. */
export const CASES_PER_REQUEST = 12;
/** The most issue text sent, in characters; longer descriptions are cut. */
export const MAX_ISSUE_TEXT = 24000;

export interface ReviewIssue {
  key: string;
  title: string;
  description: string;
  /** The text before the change, when a version history has it. */
  previous?: { title: string; description: string } | null;
}

export interface ReviewParams {
  projectId: number;
  tenantId?: string;
  /** The user the model usage is recorded against. */
  userId: string;
  issue: ReviewIssue;
  /** Other issues the cases are linked to, as context. */
  otherIssues: { key: string; title: string }[];
  cases: UpkeepCase[];
  template: TemplateData;
}

export type ReviewResult =
  | {
      ok: true;
      decisions: UpkeepDecision[];
      newCases: UpkeepCaseText[];
      problems: string[];
    }
  | { ok: false; reason: "no_llm" }
  | { ok: false; reason: "failed"; detail: string };

const cut = (text: string): string =>
  text.length > MAX_ISSUE_TEXT
    ? `${text.slice(0, MAX_ISSUE_TEXT)}\n[cut]`
    : text;

function issueText(issue: {
  key?: string;
  title: string;
  description: string;
}) {
  return [
    ...(issue.key ? [`Key: ${issue.key}`] : []),
    `Title: ${issue.title}`,
    "Description:",
    cut(issue.description.trim() || "(none)"),
  ].join("\n");
}

/** The field list the model may write, with each field's guidance. */
export function fieldsSection(template: TemplateData): string {
  const fields = template.fields.filter(
    (field) => field.type.toLowerCase() !== "steps"
  );
  return fields.length > 0
    ? fields.map(describeField).join("\n")
    : "(this template has no fields besides the steps)";
}

/** The cases of one request, and the names of the linked cases left out of it. */
export function casesSection(
  cases: UpkeepCase[],
  others: string[],
  allowNewCases: boolean
): string {
  const body = JSON.stringify(
    cases.map((testCase) => ({
      id: testCase.id,
      name: testCase.name,
      fieldValues: testCase.fieldValues,
      steps: testCase.steps,
      ...(testCase.stepsFixed ? { note: "steps are fixed" } : {}),
    })),
    null,
    2
  );
  const lines = [body];
  if (others.length > 0) {
    lines.push(
      "",
      "Other test cases linked to this issue, handled separately (names only):",
      ...others.map((name) => `- ${name}`)
    );
  }
  if (!allowNewCases) {
    lines.push("", 'Leave "newCases" empty for this request.');
  }
  return lines.join("\n");
}

/**
 * Ask the project's AI model what a changed issue means for each linked test
 * case. Cases go in groups of CASES_PER_REQUEST; every group is told the
 * names of the rest, and only the first may add new cases, so two groups
 * cannot both fill the same gap.
 */
export async function reviewCasesAgainstIssue(
  db: any,
  params: ReviewParams
): Promise<ReviewResult> {
  const manager = LlmManager.createForWorker(db, params.tenantId);
  const prompt = await new PromptResolver(db).resolve(
    LLM_FEATURES.CASE_UPKEEP,
    params.projectId
  );
  const resolved = await manager.resolveIntegration(
    LLM_FEATURES.CASE_UPKEEP,
    params.projectId,
    prompt
  );
  if (!resolved) return { ok: false, reason: "no_llm" };

  const template = await withFieldGuidance(params.template, db);
  const fieldNames = template.fields
    .filter((field) => field.type.toLowerCase() !== "steps")
    .map((field) => field.name);
  const shared = {
    FIELDS: fieldsSection(template),
    ISSUE: issueText(params.issue),
    ISSUE_CHANGES: params.issue.previous
      ? `Before the change the issue read:\n${issueText(params.issue.previous)}`
      : "The earlier text is not available. Compare each test case with the issue as it reads now.",
    OTHER_ISSUES:
      params.otherIssues.length > 0
        ? params.otherIssues
            .map((other) => `- ${other.key}: ${other.title}`)
            .join("\n")
        : "(none)",
  };

  const decisions: UpkeepDecision[] = [];
  const newCases: UpkeepCaseText[] = [];
  const problems: string[] = [];
  // An issue with no linked cases still gets one request, for new cases.
  const groups: UpkeepCase[][] = [];
  for (let i = 0; i < params.cases.length; i += CASES_PER_REQUEST) {
    groups.push(params.cases.slice(i, i + CASES_PER_REQUEST));
  }
  if (groups.length === 0) groups.push([]);

  for (const [index, group] of groups.entries()) {
    const vars = {
      ...shared,
      CASES: casesSection(
        group,
        params.cases
          .filter((testCase) => !group.includes(testCase))
          .map((testCase) => testCase.name),
        index === 0
      ),
    };
    let content: string;
    try {
      const response = await manager.chat(
        resolved.integrationId,
        {
          messages: [
            { role: "system", content: fillPrompt(prompt.systemPrompt, vars) },
            { role: "user", content: fillPrompt(prompt.userPrompt, vars) },
          ],
          temperature: prompt.temperature,
          maxTokens: prompt.maxOutputTokens,
          userId: params.userId,
          projectId: params.projectId,
          feature: LLM_FEATURES.CASE_UPKEEP,
          ...(resolved.model ? { model: resolved.model } : {}),
        },
        { maxRetries: 2, baseDelayMs: 1000 }
      );
      if (response.finishReason === "length") {
        return {
          ok: false,
          reason: "failed",
          detail: "The model's answer was cut off before it finished",
        };
      }
      content = response.content;
    } catch (error) {
      return {
        ok: false,
        reason: "failed",
        detail:
          error instanceof Error ? error.message : "The model call failed",
      };
    }
    const parsed = parseUpkeepResponse(content, group, fieldNames);
    if (!parsed.ok)
      return { ok: false, reason: "failed", detail: parsed.error };
    decisions.push(...parsed.decisions);
    problems.push(...parsed.problems);
    if (index === 0) newCases.push(...parsed.newCases);
    else if (parsed.newCases.length > 0) {
      problems.push("ignored new cases from a later request");
    }
  }

  return { ok: true, decisions, newCases, problems };
}
