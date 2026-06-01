/**
 * Heuristic fallback ranking for the Automation Candidates report.
 *
 * Used when the project has no active LLM integration configured (or any
 * other failure path where we'd otherwise have nothing to show). The
 * heuristic mirrors what each selection strategy is already optimizing
 * for — the strategy ordered the input cases by `executionCount` /
 * `flakinessScore` / etc., so we can emit those orderings directly as
 * the ranking, generate a metric-grounded rationale, and skip the LLM
 * call entirely. Output shape matches the LLM path so the UI renders
 * identically.
 *
 * Score scales the case's metric to 0–100 relative to the maximum in
 * the input set, so the top-ranked case always scores 100 and the
 * weakest scores >0. For metrics that can be `null` (no forecast, no
 * executions), we emit 50 as a neutral midpoint so the case still
 * appears with a defensible-looking score rather than 0.
 *
 * Strings rendered to the viewer (the summary and per-case rationales)
 * are localized via `getServerTranslation` at generation time. The
 * resulting text is persisted in the snapshot's `output` JSON, so the
 * locale is effectively pinned to whoever ran the report — mirroring
 * how the LLM path pins to whichever language the model chose.
 */

import { getServerTranslation } from "~/lib/server-translations";

import type {
  AutomationCandidatesCase,
  AutomationCandidatesContext,
  CaseSelectionStrategy,
} from "./automationCandidatesContext";

const I18N_NS = "reports.ui.automationCandidates.heuristic";

export interface HeuristicCandidate {
  caseId: number;
  rank: number;
  score: number;
  rationale: string;
}

export interface HeuristicOutput {
  candidates: HeuristicCandidate[];
  summary: string;
}

/**
 * Build a heuristic ranking for the given context using the strategy's
 * natural ordering. Cases are assumed to be already sorted by the
 * materializer per the chosen strategy; we just assign ranks 1..N and
 * derive scores + rationales from the relevant metric.
 *
 * `locale` is the Prisma `Locale` enum form (e.g. "en_US"). The
 * server-translation helper normalizes the underscore form internally
 * and falls back to en-US when a locale's JSON is missing.
 */
export async function buildHeuristicRanking(
  context: AutomationCandidatesContext,
  locale: string = "en_US"
): Promise<HeuristicOutput> {
  const strategy = context.selectionStrategy;
  const cases = context.cases;

  const candidates: HeuristicCandidate[] = await Promise.all(
    cases.map(async (c, idx) => ({
      caseId: c.id,
      rank: idx + 1,
      score: scoreFor(strategy, c, cases),
      rationale: await rationaleFor(strategy, c, locale),
    }))
  );

  return {
    candidates,
    summary: await summaryFor(
      strategy,
      cases.length,
      context.totalManualCases,
      locale
    ),
  };
}

function scoreFor(
  strategy: CaseSelectionStrategy,
  c: AutomationCandidatesCase,
  all: ReadonlyArray<AutomationCandidatesCase>
): number {
  switch (strategy) {
    case "most_executed": {
      const max = maxOf(all.map((x) => x.executionCount));
      return max > 0 ? Math.round((c.executionCount / max) * 100) : 50;
    }
    case "flakiest_first": {
      if (c.flakinessScore == null) return 0;
      return Math.round(c.flakinessScore * 100);
    }
    case "longest_first": {
      if (c.estimateSeconds == null) return 0;
      const max = maxOf(
        all.map((x) => x.estimateSeconds ?? 0).filter((v): v is number => v > 0)
      );
      return max > 0 ? Math.round((c.estimateSeconds / max) * 100) : 50;
    }
    case "oldest_first":
    case "newest_first": {
      // Date-based strategies score by position: top of the list = 100,
      // bottom = a small floor so even last place has presence. The
      // strategy itself decides direction, so position is what matters.
      const total = all.length;
      const idx = all.findIndex((x) => x.id === c.id);
      if (total <= 1) return 100;
      // Linear: top index 0 → 100, bottom → ~10.
      return Math.round(100 - (idx / (total - 1)) * 90);
    }
    case "random":
      // Random has no metric to score against — every case gets the
      // same neutral score so the heuristic mode doesn't pretend to a
      // ranking quality it doesn't have.
      return 50;
  }
}

async function rationaleFor(
  strategy: CaseSelectionStrategy,
  c: AutomationCandidatesCase,
  locale: string
): Promise<string> {
  switch (strategy) {
    case "most_executed":
      return c.executionCount > 0
        ? getServerTranslation(
            locale,
            `${I18N_NS}.rationale.mostExecutedWithCount`,
            {
              count: c.executionCount,
            }
          )
        : getServerTranslation(locale, `${I18N_NS}.rationale.mostExecutedNone`);
    case "flakiest_first":
      if (c.flakinessScore == null) {
        return getServerTranslation(
          locale,
          `${I18N_NS}.rationale.flakiestNone`
        );
      }
      return getServerTranslation(
        locale,
        `${I18N_NS}.rationale.flakiestWithScore`,
        {
          percent: Math.round(c.flakinessScore * 100),
          description: await describeFlakiness(c.flakinessScore, locale),
        }
      );
    case "longest_first":
      if (c.estimateSeconds == null) {
        return getServerTranslation(locale, `${I18N_NS}.rationale.longestNone`);
      }
      return getServerTranslation(
        locale,
        `${I18N_NS}.rationale.longestWithDuration`,
        {
          duration: await formatDuration(c.estimateSeconds, locale),
        }
      );
    case "oldest_first":
      return getServerTranslation(locale, `${I18N_NS}.rationale.oldest`, {
        age: await formatRelativeAge(c.createdAtIso, locale),
      });
    case "newest_first":
      return getServerTranslation(locale, `${I18N_NS}.rationale.newest`, {
        age: await formatRelativeAge(c.createdAtIso, locale),
      });
    case "random":
      return getServerTranslation(locale, `${I18N_NS}.rationale.random`);
  }
}

async function summaryFor(
  strategy: CaseSelectionStrategy,
  ranked: number,
  totalEligible: number,
  locale: string
): Promise<string> {
  const [intro, strategyExplanation, rankedSummary] = await Promise.all([
    getServerTranslation(locale, `${I18N_NS}.intro`),
    getServerTranslation(locale, `${I18N_NS}.strategyExplanation.${strategy}`),
    getServerTranslation(locale, `${I18N_NS}.rankedSummary`, {
      ranked,
      totalEligible,
    }),
  ]);
  return `${intro} ${strategyExplanation} ${rankedSummary}`;
}

function maxOf(xs: ReadonlyArray<number>): number {
  let max = 0;
  for (const x of xs) if (x > max) max = x;
  return max;
}

/** Translate a flakiness score (~0–1) into a localized English fraction.
 *  Used inside the rationale to make the number feel less arbitrary. */
async function describeFlakiness(
  score: number,
  locale: string
): Promise<string> {
  const key =
    score >= 0.66
      ? "wellOverHalf"
      : score >= 0.33
        ? "roughlyHalf"
        : score >= 0.15
          ? "meaningfulShare"
          : "smallShare";
  return getServerTranslation(locale, `${I18N_NS}.flakinessFraction.${key}`);
}

async function formatDuration(
  seconds: number,
  locale: string
): Promise<string> {
  if (seconds < 60) {
    return getServerTranslation(locale, `${I18N_NS}.duration.seconds`, {
      seconds,
    });
  }
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) {
    return getServerTranslation(locale, `${I18N_NS}.duration.minutes`, {
      minutes,
    });
  }
  const hours = Math.floor(minutes / 60);
  const remMin = minutes % 60;
  if (remMin === 0) {
    return getServerTranslation(locale, `${I18N_NS}.duration.hours`, { hours });
  }
  return getServerTranslation(locale, `${I18N_NS}.duration.hoursAndMinutes`, {
    hours,
    minutes: remMin,
  });
}

/** A human-friendly "N days ago" / "N months ago" / "N years ago" for
 *  the rationale text. Approximate; the rationale doesn't need to be
 *  to-the-day precise. Uses a fixed `now` injection point so the
 *  caller (and tests) can pin it. */
export async function formatRelativeAge(
  isoTimestamp: string,
  locale: string = "en_US",
  now: Date = new Date()
): Promise<string> {
  const then = new Date(isoTimestamp);
  if (Number.isNaN(then.getTime())) {
    return getServerTranslation(locale, `${I18N_NS}.relativeAge.unknown`);
  }
  const days = Math.floor((now.getTime() - then.getTime()) / 86_400_000);
  if (days < 1) {
    return getServerTranslation(locale, `${I18N_NS}.relativeAge.today`);
  }
  if (days < 30) {
    return getServerTranslation(locale, `${I18N_NS}.relativeAge.days`, {
      count: days,
    });
  }
  const months = Math.floor(days / 30);
  if (months < 24) {
    return getServerTranslation(locale, `${I18N_NS}.relativeAge.months`, {
      count: months,
    });
  }
  const years = Math.floor(days / 365);
  return getServerTranslation(locale, `${I18N_NS}.relativeAge.years`, {
    count: years,
  });
}
