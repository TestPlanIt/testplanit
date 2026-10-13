---
"@testplanit/mcp-server": patch
---

Store custom field values from `cases_update` the way the web UI does

`cases_update` passed every value other than a Dropdown or Multi-Select
straight through, so a Checkbox sent as "false" was stored as a string that
rendered checked, numbers sent as strings sorted as text, and a date without a
time showed as the day before for users west of UTC. Values are now stored in
the web UI's shapes, matching `cases_create`: numbers within the field's
min/max, true/false for Checkbox, ISO dates (a bare YYYY-MM-DD reads as that
day everywhere), http(s) links, and option names matched case-insensitively.
A single Multi-Select option is taken as a one-item list, and disabled
options are no longer accepted. The same rules apply to `cases_list` custom
field filters.
