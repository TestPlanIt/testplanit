**Beta pre-release of TestPlanIt 1.0 — source only.**

> 🔒 **This is the release candidate for 1.0.** The beta channel is now
> locked: barring showstoppers, this build is what graduates to `main` as
> **v1.0.0**. Only critical fixes land between now and release — if you've
> been waiting to try the beta, this is the one to test.

There is no prebuilt Docker image for betas: official images bake
`BASE_DOMAIN=testplanit.com` into the build and can't be reused by other
installs. You build it yourself from the source attached below.

> ⚠️ This is pre-release software. **Back up your database before trying it.**

### What's new since beta.18

#### Issues

- **Multi-select filters on every issue list.** Issue Type joins Status and
  Priority on the global and project issue lists, and all three come to
  Admin → Issues, which previously had only search. Each dropdown is
  multi-select — values OR within a facet, facets AND across each other —
  and Issue Type offers an explicit "No Issue Type" bucket, since several
  providers never supply a type and untyped issues would otherwise drop out
  of view the moment any type is picked. A dropdown is hidden when nothing
  in view has a value for that field.

#### Search

- **Result cards are real links.** Cards captured the click and pushed the
  route, so a command-click or middle-click could not open a result in a new
  tab. Cards are now anchors: plain clicks navigate in place, modified
  clicks open a new tab or window with the search sheet left open, and an
  open-in-new-tab button sits on the title row beside the entity type badge.

#### Repository

- **Dynamic-field facet counts match what filtering returns.** Duplicate
  field-value rows inflated per-option counts (they summed to 25,821
  against 25,765 real cases on the reference data set) and collapsed the
  "None" bucket to 0 — a None row read 0 while clicking it returned 56
  cases. Every dynamic-field facet now counts distinct cases, mirroring the
  filter semantics exactly. The duplicates themselves came from the import
  route's create-or-restore branch, which resurrected a deleted case on top
  of the field values surviving from its previous life; reusing an existing
  case row now clears its old field values first.
- **Folder drags survive tree re-renders.** Picking a folder up re-renders
  the tree, and the tree remounted every row on each re-render — which
  pulled the dragged row out of the document and ended the drag, so folders
  could no longer be dropped onto other folders. The tree now gets a stable
  row component and drags stay alive.

#### Runs

- **Deep links into automated runs land on the row.** A `selectedCase` link
  into an automated run — from a Latest Results chip, for example — opened
  the per-case details sheet, which doesn't apply to automated runs (their
  rows are JUnit attempts, not run cases). The link now highlights and
  scrolls to the row in the results table instead, and skips the sheet's
  case-detail query entirely.

#### Reports

- **The last column is no longer frozen on report tables.** The automatic
  last-column pin exists for action columns; the report results table and
  the drill-down drawer end in ordinary data columns, which now scroll with
  the rest of the table.

#### Parameters

- Long dataset values truncate with an ellipsis instead of clipping at the
  cell edge.

#### Dependencies

- A final dependency refresh ahead of the 1.0 cut: Next.js 16.3.3, ZenStack
  3.9.2, TanStack Query/Virtual, Tiptap 3.30.5, BullMQ 5.81.4, the AWS SDK,
  and the rest of the stack brought current.
