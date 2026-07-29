---
"@testplanit/mcp-server": patch
---

Stop the build racing its own CLI bundle

The package builds through two concurrent tsup configs, and the library config's
`clean: true` could wipe `dist/cli.js` after the CLI config had written it —
publishing a package whose `bin` pointed at a file that did not exist. The clean
now preserves the CLI output.
