/**
 * Cucumber step-title adapter for the WDIO reporter.
 *
 * `@wdio/cucumber-framework` reports each Gherkin step with the keyword
 * embedded in the title (e.g. `"Given I am on the homepage"`) — there is no
 * separate keyword field. This pure helper parses the leading keyword out of
 * each ordered step title and normalizes it into the `AutomationStep[]` shape
 * consumed by the shared `automationStepsToCaseSteps` mapper (`@testplanit/api`).
 *
 * Mapping (same role logic as the importer's adapter, so a Cucumber scenario
 * yields the SAME case Steps via the reporter as via the result importer):
 *   - `Given` → precondition,  `When` → action,  `Then` → assertion
 *   - `And` / `But` / `*` inherit the kind of the nearest preceding primary
 *     keyword (seeded to `action` before any primary is seen)
 *   - a step with no recognized keyword keeps its full title and inherits the
 *     current primary kind
 *
 * Keyword matching is case-sensitive: WDIO preserves the feature file's
 * original keyword casing, and Gherkin primary keywords are capitalized.
 */
import type { AutomationStep } from '@testplanit/api';

/** Primary Gherkin keyword → role; each sets the inherited kind. */
const PRIMARY_KEYWORDS: Record<string, AutomationStep['kind']> = {
  Given: 'precondition',
  When: 'action',
  Then: 'assertion',
};

/** Keywords that inherit the nearest prior primary keyword's kind. */
const INHERITING_KEYWORDS = ['And', 'But', '*'] as const;

export function adaptCucumberStepTitles(stepTitles: string[]): AutomationStep[] {
  const result: AutomationStep[] = [];
  // `And`/`But`/`*` and keyword-less steps inherit the nearest prior primary.
  let lastPrimaryKind: AutomationStep['kind'] = 'action';

  for (const raw of stepTitles) {
    const trimmed = raw.trim();
    let title = trimmed;
    let kind: AutomationStep['kind'] = lastPrimaryKind;
    let matched = false;

    for (const kw of Object.keys(PRIMARY_KEYWORDS)) {
      if (trimmed.startsWith(kw + ' ')) {
        title = trimmed.slice(kw.length + 1);
        kind = PRIMARY_KEYWORDS[kw];
        lastPrimaryKind = kind;
        matched = true;
        break;
      }
    }

    if (!matched) {
      for (const kw of INHERITING_KEYWORDS) {
        if (trimmed.startsWith(kw + ' ')) {
          title = trimmed.slice(kw.length + 1);
          kind = lastPrimaryKind;
          matched = true;
          break;
        }
      }
    }

    // No recognized keyword: keep the full title, inherit the current kind.
    result.push({ title, kind });
  }

  return result;
}
