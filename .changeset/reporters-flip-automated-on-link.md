---
"@testplanit/playwright-reporter": minor
"@testplanit/wdio-reporter": minor
---

Flip an explicitly linked case (`[123]` in the title — plus tags/annotations for Playwright) to `automated: true` when it receives a result and isn't automated yet. This extends the automated-flip the WebdriverIO reporter already applied to `matchByCustomField` matches (and both reporters applied to found cases via `findOrCreateTestCase`) to the direct case-ID link path, so a manually-authored case linked by ID stops showing as "not automated" once automated results land on it. The check runs once per case per run, skips the write when the case is already automated, and never blocks result reporting — a failed flip logs and continues.
