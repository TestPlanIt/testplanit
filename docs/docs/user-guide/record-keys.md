---
sidebar_position: 14
title: Record Keys
---

# Record Keys

Record Keys add optional, human-readable identifiers such as `BANKING-TC-1234` on top of the numeric IDs TestPlanIt already assigns to your records. The key tells a reader at a glance **which project** a record belongs to (`BANKING`) and **what kind** of record it is (`TC` = test case) — while the number (`1234`) stays the record's real, unchanged ID.

The feature is **cosmetic and additive**: nothing is renumbered, nothing new is stored per record, and every existing link, API call, and integration keeps working exactly as before. A key like `BANKING-TC-1234` is simply a decorated way of writing test case `1234`.

## The key format

A record key has three parts joined by hyphens:

```
BANKING - TC - 1234
   │       │     │
   │       │     └── the record's existing numeric ID (unchanged)
   │       └──────── a type token (TC = Test Case, TR = Test Run, …)
   └──────────────── the project's code
```

- The **project code** is set per project (e.g. `BANKING`, `PAYMENTS`, `RETAIL`).
- The **type token** is configured once for the whole instance (defaults: `TC`, `TR`, `SN`, `MS`, `RS`, `DS`, `TG`, `SS`, `IS`).
- The **number is the record's canonical ID** — it is never a new per-project sequence.

Both the project code and the type tokens are **uppercase letters only** (no digits), so the only number in a key is the record's ID and the whole key reads unambiguously.

## Enabling Record Keys

Record Keys are **off by default**. A system administrator turns them on:

1. Open the **Administration** area and select **Record Keys** from the **System** section of the left-hand navigation.
2. Toggle **Project-prefixed record keys** on.
3. Optionally adjust the **type tokens** — the short mnemonic used for each kind of record. Tokens are 1–6 uppercase letters, must be unique, and each row shows a live preview (`PROJECT-TC-1234`). Click **Save** to persist, or **Reset** to restore the defaults.

| Record type   | Default token |
| ------------- | ------------- |
| Test Case     | `TC`          |
| Test Run      | `TR`          |
| Session       | `SN`          |
| Milestone     | `MS`          |
| Result        | `RS`          |
| Data Set      | `DS`          |
| Tag           | `TG`          |
| Shared Steps  | `SS`          |
| Issue         | `IS`          |

While the feature is off, no keys appear anywhere and the per-project code field is hidden — the app behaves exactly as it did before.

## Setting a project code

Once the feature is enabled, each project defines its own code:

1. Open a project's **Settings → Advanced** page.
2. In the **Project code** field, enter a short code (2–10 uppercase letters, no digits). The field suggests a code derived from the project name — for example _Mobile Banking App_ suggests `MBA`, and _Web_ suggests `WEB` — which you can accept with one click or replace.
3. As you type, an example key is previewed and the code is checked against other projects; codes are **unique** across the instance, so a code already in use is rejected before you save.
4. Leave the field blank to keep showing plain numeric IDs for that project.

A project only shows keys once it has a code. Projects without a code continue to display their numeric IDs.

## Where keys appear

With the feature on and a project code set, the key is surfaced everywhere a record's identity is shown:

- **Detail pages** — case, run, session, and milestone pages show the key in the header. Click it to copy it to your clipboard.
- **Lists** — each list row's three-dot menu has a **copy key** action.
- **The ID column** — the cases table's optional ID column renders the key (or the bare number when no code is set).
- **Exports** — CSV, PDF, and NDJSON case exports, run and session PDFs, the traceability matrix CSV, run-results exports, and QuickScript templates (`{{displayKey}}`) all include the key.
- **Webhooks** — case, run, session, and iteration-result payloads carry a `displayKey` field alongside the numeric `id`.
- **Audit log** — entries for cases, runs, sessions, and milestones show the key.

Anywhere the key can't apply — a project with no code, a record type without a token, or the feature turned off — the plain numeric ID is shown instead, so nothing is ever hidden.

## Looking records up by key

Because the number inside a key is the real ID, TestPlanIt accepts **either form anywhere it accepts an ID**:

- **URLs** — opening `…/repository/5/BANKING-TC-1234` redirects to the canonical `…/repository/5/1234`. Pasted links, bookmarks, and shared URLs with a key all resolve.
- **Global search** — typing a key (`BANKING-TC-1234`) or a bare ID (`1234`) surfaces the matching record as a normal search result you can click through to. A bare number is type-agnostic, so search checks every record type and shows a result for each match.

This symmetry means teams can adopt keys in their tickets, reports, and conversations without breaking any existing numeric references.

## Notes

- **Cosmetic, not canonical.** The key is derived on read; the numeric ID remains the single source of truth in the database, APIs, and integrations.
- **Uniqueness.** Project codes are unique across the instance (enforced by the database), and type tokens must be unique within the token set.
- **Issues keep their external keys.** Records that already carry an external identifier — such as a linked Jira issue (`ABT-1234`) — are not given a second, TestPlanIt-style key, to avoid competing identifiers.
- **Bulk audit entries.** Audit rows for bulk operations record a synthetic batch identifier rather than a single record ID, so they intentionally do not display a key.
