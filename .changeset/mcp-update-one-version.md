---
"@testplanit/mcp-server": patch
---

Record one version per `cases_update`, even when it flips `automated`

`cases_update` wrote the case, then its steps and fields, then bumped the
version in a separate call. Flipping `automated` let the host record an
extra version of the half-written case in between, so one edit produced two
versions, the first with the old steps. Steps and fields are now written
first, and the version bump travels with the case's own changes in a single
write, as a web UI save does.
