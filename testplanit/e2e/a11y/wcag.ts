/**
 * Maps axe-core success-criterion tags (e.g. "wcag143") to a human-readable
 * WCAG success criterion ("1.4.3 Contrast (Minimum)") plus conformance level.
 *
 * This is what lets the aggregated report group findings by SC number, which
 * is the shape a VPAT 2.5 conformance table needs. axe attaches one or more
 * `wcag<p><g><c>` tags to each rule; we resolve the primary one here.
 *
 * Reference: https://www.w3.org/WAI/WCAG22/quickref/ and the axe-core tag list.
 */

export type WcagLevel = "A" | "AA" | "AAA";

export interface SuccessCriterion {
  /** Dotted SC number, e.g. "1.4.3" */
  num: string;
  /** Official SC name, e.g. "Contrast (Minimum)" */
  name: string;
  level: WcagLevel;
}

/** Keyed by the exact axe tag string. */
export const WCAG_TAG_TO_SC: Record<string, SuccessCriterion> = {
  // 1. Perceivable
  wcag111: { num: "1.1.1", name: "Non-text Content", level: "A" },
  wcag121: {
    num: "1.2.1",
    name: "Audio-only and Video-only (Prerecorded)",
    level: "A",
  },
  wcag122: { num: "1.2.2", name: "Captions (Prerecorded)", level: "A" },
  wcag123: {
    num: "1.2.3",
    name: "Audio Description or Media Alternative",
    level: "A",
  },
  wcag124: { num: "1.2.4", name: "Captions (Live)", level: "AA" },
  wcag125: {
    num: "1.2.5",
    name: "Audio Description (Prerecorded)",
    level: "AA",
  },
  wcag131: { num: "1.3.1", name: "Info and Relationships", level: "A" },
  wcag132: { num: "1.3.2", name: "Meaningful Sequence", level: "A" },
  wcag133: { num: "1.3.3", name: "Sensory Characteristics", level: "A" },
  wcag134: { num: "1.3.4", name: "Orientation", level: "AA" },
  wcag135: { num: "1.3.5", name: "Identify Input Purpose", level: "AA" },
  wcag141: { num: "1.4.1", name: "Use of Color", level: "A" },
  wcag142: { num: "1.4.2", name: "Audio Control", level: "A" },
  wcag143: { num: "1.4.3", name: "Contrast (Minimum)", level: "AA" },
  wcag144: { num: "1.4.4", name: "Resize Text", level: "AA" },
  wcag145: { num: "1.4.5", name: "Images of Text", level: "AA" },
  wcag1410: { num: "1.4.10", name: "Reflow", level: "AA" },
  wcag1411: { num: "1.4.11", name: "Non-text Contrast", level: "AA" },
  wcag1412: { num: "1.4.12", name: "Text Spacing", level: "AA" },
  wcag1413: { num: "1.4.13", name: "Content on Hover or Focus", level: "AA" },

  // 2. Operable
  wcag211: { num: "2.1.1", name: "Keyboard", level: "A" },
  wcag212: { num: "2.1.2", name: "No Keyboard Trap", level: "A" },
  wcag213: { num: "2.1.3", name: "Keyboard (No Exception)", level: "AAA" },
  wcag214: { num: "2.1.4", name: "Character Key Shortcuts", level: "A" },
  wcag221: { num: "2.2.1", name: "Timing Adjustable", level: "A" },
  wcag222: { num: "2.2.2", name: "Pause, Stop, Hide", level: "A" },
  wcag224: { num: "2.2.4", name: "Interruptions", level: "AAA" },
  wcag241: { num: "2.4.1", name: "Bypass Blocks", level: "A" },
  wcag242: { num: "2.4.2", name: "Page Titled", level: "A" },
  wcag243: { num: "2.4.3", name: "Focus Order", level: "A" },
  wcag244: { num: "2.4.4", name: "Link Purpose (In Context)", level: "A" },
  wcag245: { num: "2.4.5", name: "Multiple Ways", level: "AA" },
  wcag246: { num: "2.4.6", name: "Headings and Labels", level: "AA" },
  wcag247: { num: "2.4.7", name: "Focus Visible", level: "AA" },
  wcag2411: {
    num: "2.4.11",
    name: "Focus Not Obscured (Minimum)",
    level: "AA",
  },
  wcag251: { num: "2.5.1", name: "Pointer Gestures", level: "A" },
  wcag252: { num: "2.5.2", name: "Pointer Cancellation", level: "A" },
  wcag253: { num: "2.5.3", name: "Label in Name", level: "A" },
  wcag254: { num: "2.5.4", name: "Motion Actuation", level: "A" },
  wcag257: { num: "2.5.7", name: "Dragging Movements", level: "AA" },
  wcag258: { num: "2.5.8", name: "Target Size (Minimum)", level: "AA" },

  // 3. Understandable
  wcag311: { num: "3.1.1", name: "Language of Page", level: "A" },
  wcag312: { num: "3.1.2", name: "Language of Parts", level: "AA" },
  wcag321: { num: "3.2.1", name: "On Focus", level: "A" },
  wcag322: { num: "3.2.2", name: "On Input", level: "A" },
  wcag323: { num: "3.2.3", name: "Consistent Navigation", level: "AA" },
  wcag324: { num: "3.2.4", name: "Consistent Identification", level: "AA" },
  wcag325: { num: "3.2.6", name: "Consistent Help", level: "A" },
  wcag331: { num: "3.3.1", name: "Error Identification", level: "A" },
  wcag332: { num: "3.3.2", name: "Labels or Instructions", level: "A" },
  wcag333: { num: "3.3.3", name: "Error Suggestion", level: "AA" },
  wcag334: {
    num: "3.3.4",
    name: "Error Prevention (Legal, Financial, Data)",
    level: "AA",
  },
  wcag337: { num: "3.3.7", name: "Redundant Entry", level: "A" },
  wcag338: {
    num: "3.3.8",
    name: "Accessible Authentication (Minimum)",
    level: "AA",
  },

  // 4. Robust
  wcag411: { num: "4.1.1", name: "Parsing (obsolete)", level: "A" },
  wcag412: { num: "4.1.2", name: "Name, Role, Value", level: "A" },
  wcag413: { num: "4.1.3", name: "Status Messages", level: "AA" },
};

/** Level/version tags that are not specific success criteria. */
const NON_SC_TAGS = new Set([
  "wcag2a",
  "wcag2aa",
  "wcag2aaa",
  "wcag21a",
  "wcag21aa",
  "wcag22aa",
  "best-practice",
  "ACT",
  "experimental",
  "review-item",
]);

/**
 * Resolve the primary success criterion for an axe violation from its tags.
 * Returns a synthetic "best-practice" or "other" bucket when no SC tag exists.
 */
export function primaryCriterion(
  tags: string[]
): SuccessCriterion & { key: string } {
  for (const tag of tags) {
    const sc = WCAG_TAG_TO_SC[tag];
    if (sc) return { ...sc, key: sc.num };
  }
  // Unmapped wcag tag (new SC we don't have a name for yet) — derive a number.
  const unmapped = tags.find(
    (t) => /^wcag\d{3,4}$/.test(t) && !NON_SC_TAGS.has(t)
  );
  if (unmapped) {
    const digits = unmapped.replace("wcag", "");
    const num =
      digits.length === 3
        ? `${digits[0]}.${digits[1]}.${digits[2]}`
        : `${digits[0]}.${digits[1]}.${digits.slice(2)}`;
    return { num, name: "(unmapped criterion)", level: "AA", key: num };
  }
  if (tags.includes("best-practice")) {
    return {
      num: "—",
      name: "Best Practice (non-WCAG)",
      level: "A",
      key: "best-practice",
    };
  }
  return { num: "—", name: "Other", level: "A", key: "other" };
}

/** True when a violation maps to at least one real WCAG success criterion. */
export function isWcagViolation(tags: string[]): boolean {
  return tags.some(
    (t) => WCAG_TAG_TO_SC[t] || (/^wcag\d{3,4}$/.test(t) && !NON_SC_TAGS.has(t))
  );
}
