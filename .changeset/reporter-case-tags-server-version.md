---
"@testplanit/playwright-reporter": patch
---

State the TestPlanIt server version that copying tags needs

Documentation only; no code changes. Copying Playwright tags onto test cases
(`captureTags`, `overwriteTags`, added in 1.1.2) requires a TestPlanIt server
on 1.0.0 or later. The README said 1.2.0, which was wrong, and its
Compatibility section did not mention the server at all.

`captureTags` is on by default. Against a server older than 1.0.0 the reporter
logs an error for each new case that has tags and reports results as usual;
set `captureTags: false` to stop the attempts.
