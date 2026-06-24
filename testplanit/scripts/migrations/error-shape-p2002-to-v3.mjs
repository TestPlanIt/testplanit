#!/usr/bin/env node
// Codemod: migrate the canonical v2 Prisma unique-constraint check
//   if (err.info?.prisma && err.info?.code === "P2002") {
// to the v3 helper
//   if (isUniqueConstraintError(err)) {
// and ensure the helper is imported. Only touches files containing the exact
// canonical pattern; variant sites (folders, sso, API routes, services) are
// handled by hand because they also need isNotFoundError / isForeignKeyError.
import { readFileSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";

const CANONICAL = 'err.info?.prisma && err.info?.code === "P2002"';
const REPLACEMENT = "isUniqueConstraintError(err)";
const IMPORT_LINE =
  'import { isUniqueConstraintError } from "~/lib/utils/errors";';

const files = execSync(
  `grep -rl 'if (${CANONICAL}) {' app/ components/ --include=*.tsx --include=*.ts`,
  { encoding: "utf8" }
)
  .split("\n")
  .filter(Boolean);

let changed = 0;
for (const file of files) {
  let src = readFileSync(file, "utf8");
  if (!src.includes(CANONICAL)) continue;
  src = src.split(CANONICAL).join(REPLACEMENT);

  // Inject the import after the last top-level import statement if absent.
  if (!src.includes(IMPORT_LINE)) {
    const lines = src.split("\n");
    let lastImport = -1;
    for (let i = 0; i < lines.length; i++) {
      if (/^\s*import\s.+from\s+["'].+["'];?\s*$/.test(lines[i])) lastImport = i;
      // stop scanning once real code starts (after some imports seen)
      if (lastImport >= 0 && /^(export|const|function|async|class)\s/.test(lines[i]))
        break;
    }
    if (lastImport >= 0) {
      lines.splice(lastImport + 1, 0, IMPORT_LINE);
      src = lines.join("\n");
    }
  }
  writeFileSync(file, src);
  changed++;
  console.log("patched", file);
}
console.log(`\n${changed} file(s) patched`);
