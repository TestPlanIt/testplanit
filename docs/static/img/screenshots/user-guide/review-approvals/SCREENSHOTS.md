# Review & Approval — screenshot capture guide

This directory holds the four PNGs embedded by `docs/docs/user-guide/review-approvals.md`. Replace the placeholders by running through the flow below against a fresh build.

## Setup

```bash
cd testplanit
NODE_OPTIONS='--max-old-space-size=16382' pnpm build
E2E_PROD=on pnpm test:e2e:setup-db   # gives you a seeded project + admin user
pnpm start
```

Then visit `http://localhost:3000/en-US` and sign in as `admin@example.com` / `admin`. Capture each screenshot at viewport width 1440px (zoom 100%) so they render cleanly on the docs site at full bleed.

## Required captures

Save each as `<filename>.png` directly in this directory. PNG, max width 1600px, no shadow/border (Docusaurus adds its own framing).

| Filename | What to capture | How to set up |
| --- | --- | --- |
| `requires-review-toggle.png` | The Edit Workflow dialog with the **Requires review** switch turned on. | **Administration → Workflows** → click Edit on any state in the **Test Cases** scope. Toggle the Requires review switch on. Capture the modal — frame should include the state name field + the switch row + Submit/Cancel footer. |
| `request-review-sheet.png` | The Request Review sheet with target state, reviewer, and comment fields populated. | On any seeded test case in a project with a gated state, click **Request review**. Pick a target gated state, assign to a different user (the admin can't self-assign), type a short comment. Capture the full sheet — header + form + Submit/Cancel footer. |
| `status-banner-pending.png` | The pending review banner on a test case detail page. | After submitting the previous capture's request, the case page shows the pending banner. Crop to the banner + a hint of the page title above so the context is obvious. |
| `reviewer-inbox.png` | The reviewer inbox at `/reviews` showing the Pending tab with a request and the row actions (Approve / Request changes / Reject). | Log in as the assigned reviewer (or any admin), visit `/en-US/reviews`. The Pending tab is the default. Seed 2–3 review requests beforehand so the table doesn't look empty. Frame: the tab strip + table header row + at least 2 data rows + their row-action buttons. |
| `approve-dialog.png` | The Approve confirmation dialog showing the requester pill, entity name, target state pill, and the optional Approval note field. | In the inbox, click the green check on any row. The Approve dialog opens. Capture before clicking confirm. |

## Path convention

The embedded paths in the doc are root-relative to `docs/static/`, e.g. `/img/screenshots/user-guide/review-approvals/request-review-sheet.png`. Docusaurus resolves those at build time. Do not move the files out of this directory.

## After capture

```bash
pnpm --filter docs build   # verifies the markdown references resolve
```

Any broken image link will fail the docs build. When all five PNGs are in place, delete this `SCREENSHOTS.md` — it should not ship to readers.
