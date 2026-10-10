---
"@testplanit/mcp-server": patch
---

`code_repositories_list` describes every repository binding a project holds

A project can bind one repository per purpose (QuickScript test code and
impact-analysis application code), so the tool no longer claims one row per
project; each row now carries its `purpose`, and an optional `purpose` filter
picks one side. The settings allow-list now matches what each provider's
adapter stores, so GitLab (`projectPath`) and Bitbucket (`workspace`,
`repoSlug`) rows no longer come back with empty settings and a null `url`,
and GitHub Enterprise Server rows derive their web url from the stored API
root. `cases_get` reuses the same derivation for its inline `codeRepository`.
