---
"@testplanit/mcp-server": minor
---

Create cases through the same writer as `cases_create_many`, with the web UI's checks

`cases_create` and `cases_create_many` used to store the same input
differently: one built the case row by row, the other went through the host's
bulk-create route. `cases_create` now calls bulk-create with a single case, so
both write in one transaction and store identical data. On a host that
includes the matching fixes, custom field values are also checked and stored
the way the web UI stores them:

- Dropdown and Multi-Select options by name (any case) or id; unknown options
  are refused rather than stored raw.
- Integer and Number values as numbers within the field's min/max; Checkbox
  values as true/false, including the strings "true" and "false"; dates as
  ISO timestamps, a bare `YYYY-MM-DD` reading as that day everywhere; Links as
  http(s) URLs.
- Template defaults fill the fields you leave out (the Dropdown option marked
  default, a Checkbox's default, default text), and a required field without
  a value fails the case with a message naming it.
- Restricted fields need the restricted-fields permission.

`cases_create` also accepts `issues` (tracker keys) and `integrationId`, as
`cases_create_many` does, and refuses names over 255 characters instead of
cutting them.
