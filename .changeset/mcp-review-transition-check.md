---
"@testplanit/mcp-server": patch
---

Report whether an approval actually moved the entity

`reviews_decide` set `transitionApplied: true` for every approval, but the
host applies the transition best-effort and can skip it (the entity is gone
or already past the target state) without failing the decision. The tool
now reads the entity back and reports `transitionApplied` from its actual
state, adding `currentStateId`.
