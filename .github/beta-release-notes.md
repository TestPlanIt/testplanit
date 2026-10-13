**Beta pre-release of TestPlanIt 1.0 — source only.**

There is no prebuilt Docker image for betas: official images bake
`BASE_DOMAIN=testplanit.com` into the build and can't be reused by other
installs. You build it yourself from the source attached below.

> ⚠️ This is pre-release software. **Back up your database before trying it.**

### What's new since beta.17

#### Milestone and report counting

- **Executed automated cases counted as never run.** Automated runs (JUnit,
  TestNG, Mocha, …) record their outcomes in the result table and never write
  a status onto the run-case row — and eight consumers assumed that row was
  always populated. Each now reads manual and automated cases from their own
  sources:
  - **Milestone completion and burndown** counted every automated case as
    permanently incomplete, and also counted cases that had been removed from
    a run. A dozen-plus milestones were understated, several that were
    actually at 100%; on the reference data set one milestone's open work was
    94.7% removed-case phantom.
  - The **Milestone Completion (%) project-health metric** read the run-case
    status unconditionally — a milestone reporting 0% across 12,790 cases now
    reports 100% from its 31,992 results — and its drill-down said
    "Completed: No" for every automated case, contradicting the number it
    drills into.
  - The **export traceability matrix** wrote a blank status for
    automated-only cases, which read as "Not run".
  - **Member coverage** treated an empty automated run-case row as
    authoritative, so its automated fallback never engaged and cases showed
    falsely as "Not run".
  - The duplicate scan's **Last Run** column showed a run name and date with
    a blank status — the worst-hit surface, since automation-sourced cases
    dominate duplicate scans.
  - The **run-case detail sheet** fell back to "Untested" — reached directly
    from Latest Results chips, so clicking a passing automated result opened
    a sheet saying it never ran.
  - The dashboard's **assigned-to-me list** kept cases that had been removed
    from a run in the assignee's task list indefinitely.
  - The **matrix report** still aggregated iterations, configurations, and
    snapshots from removed run-cases.
- **The rule now lives in one place.** Effective run-case status resolves
  through a single database view used by all of these consumers, so the
  manual-vs-automated split can't regress one surface at a time. The view is
  also queryable from psql and BI tools, where the empty status columns were
  most misleading, and a lint gate fails any new code that reads the raw
  column directly.
- No backfill is needed: results were always recorded correctly, so these
  fixes correct historical and future data alike.

#### Reviews

- **Your own requests join the Pending queue.** The Pending tab only listed
  reviews assigned to you, so a request you submitted was invisible until
  someone decided it. It now also shows the reviews you requested, with a new
  Assignee column saying who each one is parked with. Rows you submitted
  carry **Send reminder** and **Cancel request** instead of the decision
  actions; when you're both requester and eligible reviewer, the decision
  actions win. Send reminder reuses the scheduled reminder pipeline — same
  notification, same webhook, same cooldown — so a request nudged just after
  the hourly scan is refused rather than double-notifying, and the button
  says when the last reminder went out. The header badge stays scoped to
  reviews awaiting *your* decision.
- **A moved case no longer strands its reviews.** Moving cases between
  projects soft-deletes the source rows through a path that skipped review
  cleanup, so in-flight reviews stayed pending against cases the inbox hides
  — the assignee saw an empty inbox while the reminder worker emailed them
  every day. The move now cancels those reviews, and the reminder scan
  retires any review whose subject is gone instead of nagging about it.

#### Profile

- **Mentioned in Comments becomes My Comments.** The section now lists both
  comments you've written and comments that @-mention you, with a scope
  filter (All Comments / Mentioning Me / Written by Me) and a text search —
  @-mentioned names count as text, so searching a teammate's name finds the
  comments that mention them. The list loads more as you scroll, with a
  counter showing how many are loaded and, while searching, how many match.

#### Repository

- The folder tree fills the full height of its panel instead of stopping
  short of the bottom.

#### Stored preferences and hydration

- **A saved preference no longer breaks the page that saved it.** Six
  components read localStorage while initializing state, which renders one
  way on the server and another on the client. With nothing stored both
  agree — so everything worked in a fresh browser — but the first write broke
  every load after it. Affected surfaces now render the default and adopt the
  stored value on mount: sidebar sections no longer collapse the section
  you're currently on (previously leaving you on a page with no link to it),
  and a lint scanner fails the build if the pattern reappears.
- **Resizable panels move again.** Panel groups with a saved layout hydrated
  into a state where the divider dragged but nothing moved — invisible until
  you resized once, since the failure needed a stored layout. Panel groups
  now mount client-side behind a same-sized placeholder. Affects every
  resizable surface.

#### Uploads

- **The per-file upload limit is configurable.** `UPLOAD_MAX_MB` (default 10,
  the previous hardcoded value) sets the ceiling for attachments and inline
  document images. It must be present at both build and run time — Compose
  wires both from the one variable in `.env`, so raising it is an edit plus a
  rebuild, not a restart. This also fixes at-limit uploads being rejected by
  the framework's body cap with an opaque error before the friendly "File is
  too large" message could run. Project icons and avatars stay fixed — they
  are UI thumbnails, not operator-sized payloads.

#### API docs

- **The /api/docs spec is generated again.** The OpenAPI spec had been
  hand-patched since the ORM migration and drifted badly — it advertised
  relation shapes that now return 422 and was missing the join models for
  case issues, case tags, and milestone issues, `deletedAt` on ~40 models,
  and the milestone external-sync fields. It is now regenerated from the live
  schema, a parity test fails CI whenever the checked-in spec no longer
  matches, and the broken examples in the API reference are corrected (reads
  are GET with a `q` query parameter, not POST).

#### Deployment

- **The nginx container log is capped** at 10 files × 100 MB. It logs request
  timing on every request and previously grew without bound — 3 GB in 9 days
  on one deployment — with nothing reclaiming the space short of recreating
  the container. The cap retains roughly three days of timing data for
  latency debugging.

#### Schema

- Adds a migration creating the effective-case-status view described above.
  Upgrading applies it normally via `migrate deploy`; databases built with
  `db push` get it created at application startup.
