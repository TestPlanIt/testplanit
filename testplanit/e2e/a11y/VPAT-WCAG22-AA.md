# Accessibility Conformance Report — TestPlanIt
### WCAG 2.2 Level A & AA (VPAT® 2.5 INT — WCAG chapter)

**Status: DRAFT — automated baseline only. NOT a conformance claim.**

| | |
|---|---|
| **Product** | TestPlanIt (web application) |
| **Report date** | 2026-06-05 |
| **Evaluated against** | WCAG 2.2 Levels A and AA |
| **Evaluation methods** | Automated: axe-core via the `e2e/a11y` Playwright harness, **79 of 80 application routes** scanned as an authenticated admin against seeded data, in the **"Accessible" theme**. Manual testing: **not yet performed.** |
| **Configuration note** | Results reflect the opt-in **Accessible theme**. Other themes show additional 1.4.3/2.5.8 issues. |

---

## How to read this report

Automated tooling (axe-core) reliably evaluates only ~30–40% of WCAG success criteria. **This report is a floor, not a conformance determination.**

| Term | Meaning here |
|---|---|
| **Supports** | No automated failures detected. **¹ Pending manual confirmation** — not a verified pass. |
| **Partially Supports** | Automated testing found failures (evidence in Remarks). |
| **Does Not Support** | Majority of functionality fails (none currently). |
| **Not Applicable** | The criterion does not apply to this product. |
| **Not Evaluated** | Requires manual testing (keyboard / screen reader / zoom) **that has not been done.** |

> **A conformance *claim* requires every A/AA criterion to be `Supports` after manual testing.** Today, several rows are `Partially Supports` and the majority are `Not Evaluated`, so **TestPlanIt cannot yet claim WCAG 2.2 AA conformance.** This document is a truthful support inventory + remediation roadmap.

---

## Table 1 — WCAG 2.2 Level A

| Criterion | Level | Conformance | Remarks |
|---|---|---|---|
| 1.1.1 Non-text Content | A | Supports¹ | No `image-alt` / `input-image-alt` failures. Manual review needed for icon-only and complex images. |
| 1.2.1 Audio/Video-only (Prerecorded) | A | Not Applicable | No prerecorded media as core content. Confirm scope of user-uploaded attachments. |
| 1.2.2 Captions (Prerecorded) | A | Not Applicable | As above. |
| 1.2.3 Audio Description / Alternative | A | Not Applicable | As above. |
| 1.3.1 Info and Relationships | A | Not Evaluated | Automated table/list/form-label checks pass, but landmark and heading structure is incomplete (best-practice flags: missing `<main>` on 45 routes, no `<h1>` on 77). Manual review required. |
| 1.3.2 Meaningful Sequence | A | Not Evaluated | Manual (DOM/reading order). |
| 1.3.3 Sensory Characteristics | A | Not Evaluated | Manual. |
| 1.4.1 Use of Color | A | Not Evaluated | Manual (status colors, link distinction). |
| 1.4.2 Audio Control | A | Not Applicable | No auto-playing audio. |
| **2.1.1 Keyboard** | A | **Partially Supports** | `scrollable-region-focusable`: 2 elements / 2 routes (scrollable table region not keyboard-focusable). Full keyboard operability otherwise **unverified** (manual). |
| 2.1.2 No Keyboard Trap | A | Not Evaluated | Manual (modals, editors). |
| 2.1.4 Character Key Shortcuts | A | Not Evaluated | Manual. |
| 2.2.1 Timing Adjustable | A | Not Evaluated | Manual (session timeout, toasts). |
| 2.2.2 Pause, Stop, Hide | A | Not Evaluated | Manual (any auto-updating content). |
| 2.3.1 Three Flashes | A | Supports¹ | No flashing content observed. |
| 2.4.1 Bypass Blocks | A | Not Evaluated | Landmark coverage incomplete (best-practice). Skip mechanism needs manual check. |
| 2.4.2 Page Titled | A | Supports¹ | All scanned routes have a `<title>`. |
| 2.4.3 Focus Order | A | Not Evaluated | Manual. |
| **2.4.4 Link Purpose (In Context)** | A | **Partially Supports** | `link-name`: 7 elements / 7 routes (empty folder-path links). |
| 2.5.1 Pointer Gestures | A | Not Evaluated | Manual. |
| 2.5.2 Pointer Cancellation | A | Not Evaluated | Manual. |
| 2.5.3 Label in Name | A | Supports¹ | No `label-in-name` failures. |
| 2.5.4 Motion Actuation | A | Not Applicable | No motion-actuated functionality. |
| 3.1.1 Language of Page | A | Supports¹ | `<html lang>` present on all routes. |
| 3.2.1 On Focus | A | Not Evaluated | Manual. |
| 3.2.2 On Input | A | Not Evaluated | Manual. |
| 3.3.1 Error Identification | A | Not Evaluated | Manual (form validation). |
| **3.3.2 Labels or Instructions** | A | **Partially Supports** | Form inputs without programmatic labels — `label` rule: 9 elements / 6 routes (react-select inputs, OTP fields). Also counts under 4.1.2. |
| 3.3.7 Redundant Entry | A | Not Evaluated | Manual (multi-step flows). |
| 4.1.1 Parsing | A | Supports | **Obsolete/removed in WCAG 2.2** — always satisfied. |
| **4.1.2 Name, Role, Value** | A | **Partially Supports** | The primary remaining gap. `button-name` 400/36 routes, `label` 9/6, `aria-allowed-attr` 7/2, `aria-hidden-focus` 8/4, `nested-interactive` 7/4, `aria-valid-attr-value` 1/1. See roadmap. |

## Table 2 — WCAG 2.2 Level AA

| Criterion | Level | Conformance | Remarks |
|---|---|---|---|
| 1.2.4 Captions (Live) | AA | Not Applicable | No live media. |
| 1.2.5 Audio Description (Prerecorded) | AA | Not Applicable | No prerecorded media as core content. |
| 1.3.4 Orientation | AA | Not Evaluated | Manual (no orientation lock expected). |
| 1.3.5 Identify Input Purpose | AA | Supports¹ | No `autocomplete-valid` failures. |
| **1.4.3 Contrast (Minimum)** | AA | **Partially Supports** | `color-contrast`: 48 elements / 12 routes in the Accessible theme. Residual = **data-colored badges/tags** (contrast depends on the user-chosen color) and **disabled controls** (WCAG-exempt; axe still flags). Non-Accessible themes have substantially more. |
| 1.4.4 Resize Text | AA | Not Evaluated | Manual (200% zoom). |
| 1.4.5 Images of Text | AA | Not Evaluated | Manual. |
| 1.4.10 Reflow | AA | Not Evaluated | Manual (400% / 320 CSS px). Wide data tables are a likely risk. |
| 1.4.11 Non-text Contrast | AA | Supports¹ | No failures; Accessible theme strengthens borders, inputs, and focus ring. |
| 1.4.12 Text Spacing | AA | Not Evaluated | Manual. |
| 1.4.13 Content on Hover or Focus | AA | Not Evaluated | Manual (tooltips, popovers). |
| 2.4.5 Multiple Ways | AA | Not Evaluated | Search + navigation present — confirm manually. |
| 2.4.6 Headings and Labels | AA | Not Evaluated | Heading order / missing `<h1>` flagged (best-practice). Manual. |
| 2.4.7 Focus Visible | AA | Not Evaluated | Accessible theme adds a high-contrast focus ring; not axe-verifiable. Manual. |
| 2.4.11 Focus Not Obscured (Min) | AA | Not Evaluated | Manual (sticky headers/toolbars). |
| 2.5.7 Dragging Movements | AA | Not Evaluated | **Likely gap** — the repository folder tree uses drag-and-drop; needs a single-pointer alternative. |
| **2.5.8 Target Size (Minimum)** | AA | **Partially Supports** | `target-size`: 33 elements / 15 routes in the Accessible theme (color-picker swatch, a few compact icon controls). Non-Accessible themes have more. |
| 3.1.2 Language of Parts | AA | Supports¹ | No `valid-lang` failures. |
| 3.2.3 Consistent Navigation | AA | Not Evaluated | Manual. |
| 3.2.4 Consistent Identification | AA | Not Evaluated | Manual. |
| 3.2.6 Consistent Help | AA | Not Evaluated | Manual. |
| 3.3.3 Error Suggestion | AA | Not Evaluated | Manual. |
| 3.3.4 Error Prevention (Legal/Fin/Data) | AA | Not Evaluated | Manual (destructive actions). |
| 3.3.8 Accessible Authentication (Min) | AA | Not Evaluated | **Review needed** — login / SSO / magic-link flows. |
| 4.1.3 Status Messages | AA | Not Evaluated | Manual (toast `role="status"`, live regions). |

---

## Remediation roadmap (to clear the `Partially Supports` rows)

**4.1.2 Name, Role, Value** — *largest remaining; all shared sources already fixed*
- ✅ Done: avatars, row-action menus, the project sidebar toggle, all 18 admin tables (edit/delete buttons + status toggle switches), shared column-filter operator selects, result-expand, and more.
- ⬜ Remaining (`button-name` 400 els): per-page **visible Selects** (status/page-size filters on ~15 list pages) and **generic icon buttons** on ~21 feature pages — each a one-off `aria-label`.
- ⬜ `aria-allowed-attr` (issue-title trigger), `nested-interactive` (tags page), `aria-hidden-focus` (Radix menu state), `aria-valid-attr-value` (Radix tab) — **structural changes**, held pending design review (they render in all themes).

**1.4.3 Contrast** — fixed app-wide via the Accessible theme; residual is **data-driven badge colors** (consider enforcing a readable foreground per badge) + exempt disabled controls (document as exception).

**2.5.8 Target Size** — color-picker swatch + a few compact controls; bump to ≥24px in the Accessible theme override.

**2.4.4 / 3.3.2** — folder-path link names (2.4.4) and react-select/OTP input labels (3.3.2).

**2.1.1** — make the scrollable table region keyboard-focusable (`tabindex="0"`).

---

## Manual audit required (to convert `Not Evaluated` → a conformance claim)

Automated scanning cannot verify these — they gate any AA claim:

1. **Keyboard-only** operation of every interactive flow (2.1.1, 2.1.2, 2.4.3, 2.1.4).
2. **Screen reader** pass — NVDA + VoiceOver — for names/roles/states, live regions (4.1.3), and reading order (1.3.1, 1.3.2).
3. **Focus visible / not obscured** (2.4.7, 2.4.11) across components.
4. **Reflow & resize** at 400% / 320px and 200% text (1.4.10, 1.4.4, 1.4.12) — wide tables especially.
5. **Drag alternative** for the repository folder tree (2.5.7).
6. **Authentication** flows (3.3.8) — login, SSO, magic link.
7. **Forms & errors** (3.3.1, 3.3.3, 3.3.4) and **on-focus/on-input** behavior (3.2.1, 3.2.2).
8. **Landmarks & headings** — add a single `<main>` and an `<h1>` per page (1.3.1, 2.4.1, 2.4.6).

---

*Generated from the `e2e/a11y` automated baseline (Accessible theme, 79 routes). Re-run `pnpm a11y:scan` and `A11Y_THEME=accessible pnpm a11y:scan` to refresh evidence. This is a working document, not a published ACR — a published VPAT requires the manual audit above and legal/accessibility sign-off.*
