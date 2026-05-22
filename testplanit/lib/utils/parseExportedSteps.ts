import { extractTextFromNode } from "~/utils/extractTextFromJson";

export interface ParsedExportedStep {
  step: string;
  expectedResult: string;
  order: number;
}

const LABEL_LINE_RE = /^(Step|Expected Result)\s+\d+:\s*$/m;
const LABEL_LINE_RE_G = /^(Step|Expected Result)\s+\d+:\s*$/gm;
const BLOCK_SEPARATOR_RE = /\n[ \t]*---[ \t]*\n/;

export function hasLabeledStepFormat(text: string): boolean {
  return LABEL_LINE_RE.test(text);
}

export function parseLabeledSteps(text: string): ParsedExportedStep[] {
  const normalized = text.replace(/\r\n?/g, "\n");
  const blocks = normalized.split(BLOCK_SEPARATOR_RE);

  return blocks.map((rawBlock, index) => {
    const block = rawBlock.trim();
    if (!block) {
      return { step: "", expectedResult: "", order: index };
    }

    const labels: Array<{
      kind: "step" | "expected";
      labelStart: number;
      labelEnd: number;
    }> = [];
    const re = new RegExp(LABEL_LINE_RE_G.source, "gm");
    let m: RegExpExecArray | null;
    while ((m = re.exec(block)) !== null) {
      labels.push({
        kind: m[1] === "Step" ? "step" : "expected",
        labelStart: m.index,
        labelEnd: m.index + m[0].length,
      });
    }

    let stepText = "";
    let expectedText = "";

    if (labels.length === 0) {
      stepText = block;
    } else {
      for (let i = 0; i < labels.length; i++) {
        const start = labels[i].labelEnd;
        const end =
          i + 1 < labels.length ? labels[i + 1].labelStart : block.length;
        const content = block.slice(start, end).trim();
        if (labels[i].kind === "step") {
          stepText = content;
        } else {
          expectedText = content;
        }
      }
    }

    return { step: stepText, expectedResult: expectedText, order: index };
  });
}

export function tryParseJsonSteps(text: string): ParsedExportedStep[] | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (!Array.isArray(parsed)) return null;

  return parsed.map((item: any, index) => {
    const stepValue = item?.step;
    const expectedValue = item?.expectedResult;
    const orderRaw = item?.stepNumber;
    return {
      step:
        typeof stepValue === "string"
          ? stepValue
          : extractTextFromNode(stepValue),
      expectedResult:
        typeof expectedValue === "string"
          ? expectedValue
          : extractTextFromNode(expectedValue),
      order:
        typeof orderRaw === "number" && Number.isFinite(orderRaw)
          ? orderRaw - 1
          : index,
    };
  });
}
