---
"@testplanit/wdio-reporter": patch
"@testplanit/mcp-server": patch
"@testplanit/api": patch
---

Lower minimum Node.js requirement to 20

Relaxes `engines.node` from `>=24` to `>=20` so the packages can be installed on projects that have not yet upgraded to Node 24. The client code only relies on APIs available since Node 18 (`fetch`, `FormData`, `Blob`, `AbortSignal.timeout`, and Web Streams); the previous `>=24` pin came from a workspace-wide standardization rather than an actual code requirement.
