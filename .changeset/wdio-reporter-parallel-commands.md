---
"@testplanit/wdio-reporter": patch
---

Commands and screenshots go to the right test when tests run in parallel

With WebdriverIO 10's parallel mode, several tests run at once. The reporter
attached every browser command and screenshot to whichever test had started
last, so one test's screenshots and AI-derived steps could land on another.
On WebdriverIO 10.2 and later it now asks WebdriverIO which test a command
belongs to. Earlier versions run tests one at a time and are unchanged.
