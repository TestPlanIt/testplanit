**Beta pre-release of TestPlanIt 1.0 — source only.**

There is no prebuilt Docker image for betas: official images bake
`BASE_DOMAIN=testplanit.com` into the build and can't be reused by other
installs. You build it yourself from the source attached below.

> ⚠️ This is pre-release software. **Back up your database before trying it.**

### What's new since beta.15

#### Automated test runs

- **Execution Metrics.** Automated run pages open their Metrics & Charts panel
  with a summary card: pass rate, run duration (wall-clock, first to last
  result) alongside the summed test time, average and median test durations,
  and the five slowest tests linked to their cases. The run rows on
  the Test Runs page show the same run-duration and total-test-time pair.
- **Real parallelization.** The Parallelization tile now reports the peak
  number of tests that were actually running at once, reconstructed from each
  result's finish time and duration, with the time-weighted average in the
  tooltip. Results imported in one bulk upload share a single timestamp and are
  honestly reported as unmeasurable rather than guessed.
- **Execution Timeline.** The Status Timeline chart is replaced by a swimlane
  of the run on a real time axis — one bar per attempt, colored by status, one
  lane per worker. Lanes use the worker ids the updated reporters send
  (Playwright worker lanes, WebdriverIO runner cids) and are inferred from
  overlapping execution windows for results without them; bulk XML imports fall
  back to the previous per-suite view. Clicking a bar opens the case.
- **Retries and flakiness.** A case that failed and then passed on a later
  attempt in the same run is flagged flaky — an amber ⚡ on its rows and a
  Flaky Tests tile beside a Retries tile in the metrics card. Surefire XML
  imports now materialize `flakyFailure`/`rerunFailure` records as retry
  attempts, and the WebdriverIO reporter reports the failing attempts of
  Mocha/Jasmine per-test retries it previously dropped. Parameterized cases are
  excluded — their rows are iterations, not retries.
- **Result filters.** The results table gains a filter bar: Result and Suite
  multi-select comboboxes (search, Select All, Clear All, per-value counts)
  plus Flaky-only and Retried-only toggles. Clicking the Flaky Tests or Retries
  metric tile applies the matching filter. A Worker column (hidden by default)
  shows where each attempt ran.
- **Faster page loads.** The metrics card and charts read a lean query of
  their own instead of waiting for the full results payload — system output,
  stack traces, and attachments no longer gate the charts, and live runs
  re-fetch far less per streamed result.

#### Test case result history

- **The current run stands out.** Opened from a test run, the result history
  marks that run's rows with an accent bar and a Current badge.
- **Massive histories stop eating browser memory.** Past 50 results the
  history table virtualizes — only the visible window of rows is mounted —
  so automated cases with thousands of attempt rows scroll flat instead of
  swallowing RAM.

#### Reports

- **Date filters survive grouping for automated results.** A report that
  grouped by date dropped its date filter for automated results; the union
  query now applies it on both sides.

#### Search

- Automated test case results now carry the automation icon in unified search
  results.

#### Users

- User directory reads are scoped to project collaborators.

#### UI

- Status, count, and star badges keep readable contrast in every theme, and
  status-colored badges now pick black or white text perceptually — no more
  black-on-violet Skipped badges.

#### MCP server

- Repository reporting rollups: `cases_count` totals, subtree scoping, and
  folder trees that say when they're truncated.

#### Schema

- New nullable `worker` column on JUnit test results (applied by the normal
  schema migration on upgrade).

#### Package releases (`beta` dist-tag on npm)

| Package | Version |
| --- | --- |
| `@testplanit/api` | 1.0.0-beta.2 |
| `@testplanit/playwright-reporter` | 1.0.0-beta.3 |
| `@testplanit/wdio-reporter` | 1.0.0-beta.4 |
| `@testplanit/mcp-server` | 1.0.0-beta.3 |

The reporters send the worker id of every attempt; a TestPlanIt older than
this beta doesn't know the field, and the API client detects that, retries the
result without it, and stops sending it — no results are lost in either
pairing.
