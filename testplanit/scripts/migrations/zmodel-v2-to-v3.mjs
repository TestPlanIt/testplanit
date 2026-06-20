#!/usr/bin/env node
/**
 * ZModel v2 -> v3 migration. Idempotent and re-runnable (safe after a rebase
 * from main that introduces new models/rules). Run: node scripts/migrations/zmodel-v2-to-v3.mjs [schema.zmodel]
 */
import fs from "node:fs";

const file = process.argv[2] || "schema.zmodel";
let s = fs.readFileSync(file, "utf8");
const orig = s;
const log = [];

// --- Header: drop the Prisma generator (v3 has its own ORM) ---
s = s.replace(/^generator\s+client\s*\{[^}]*\}\n+/m, () => (log.push("removed generator client"), ""));

// --- Header: drop v2-only plugins. v3 hooks are runtime (useClientQueries),
//     input validation is native, and there is no v3 openapi plugin yet. ---
for (const name of ["hooks", "zod", "openapi"]) {
  const re = new RegExp(`^plugin\\s+${name}\\s*\\{[^}]*\\}\\n+`, "m");
  if (re.test(s)) { s = s.replace(re, ""); log.push(`removed plugin ${name}`); }
}

// --- Header: ensure the access-policy plugin is present (insert after datasource) ---
if (!/plugin\s+policy\s*\{/.test(s)) {
  s = s.replace(
    /^(datasource\s+db\s*\{[^}]*\}\n)/m,
    `$1\nplugin policy {\n    provider = '@zenstackhq/plugin-policy'\n}\n`,
  );
  log.push("added plugin policy");
}

// --- Rule fix 1: v3 cannot apply `!` to the nullable auth entity ---
{
  const n = (s.match(/!auth\(\)/g) || []).length;
  if (n) { s = s.replace(/!auth\(\)/g, "auth() == null"); log.push(`!auth() -> auth() == null  x${n}`); }
}

// --- Rule fix 2: @password attribute removed in v3 (app hashes via bcrypt) ---
{
  const n = (s.match(/ @password\b/g) || []).length;
  if (n) { s = s.replace(/ @password\b/g, ""); log.push(`removed @password  x${n}`); }
}

// --- Rule fix 3: post-update semantics. v2 future() -> v3 post-update + before().
//     Notification: owner may only toggle isRead/isDeleted; admin unrestricted. ---
{
  const v2 = `@@allow('update', (auth().id == userId && (future().isRead != isRead || future().isDeleted != isDeleted)) || auth().access == 'ADMIN')`;
  const v3 = `@@allow('update', auth().id == userId || auth().access == 'ADMIN')\n    @@deny('post-update', auth().access != 'ADMIN' && isRead == before().isRead && isDeleted == before().isDeleted)`;
  if (s.includes(v2)) { s = s.replace(v2, v3); log.push("rewrote future() -> post-update (Notification)"); }
}

// --- Rule fix 4: v3 forbids non-owned (collection) relation fields in `create` rules.
//     Projects create stays covered by the admin + creator==auth() rules. ---
for (const frag of [
  `@@allow('all', userPermissions?[user == auth() && accessType == 'SPECIFIC_ROLE' && role.name == 'Project Admin'])`,
  `@@allow('all', assignedUsers?[user == auth() && auth().access == 'PROJECTADMIN'])`,
]) {
  if (s.includes(frag)) {
    s = s.replace(frag, frag.replace("@@allow('all',", "@@allow('read,update,delete',"));
    log.push("excluded create from non-owned relation rule (Projects)");
  }
}

// --- Rule fix 5: field-level @allow/@deny dropped the v2 3rd `override` arg ---
{
  const re = /(@(?:allow|deny)\('[^']*',[^,()]*(?:==|!=|>|<|>=|<=)[^,()]*),\s*(?:true|false)\)/g;
  const n = (s.match(re) || []).length;
  if (n) { s = s.replace(re, "$1)"); log.push(`dropped field-level policy override arg  x${n}`); }
}

if (s !== orig) {
  fs.writeFileSync(file, s);
  console.log(`Migrated ${file}:`);
  for (const l of log) console.log("  -", l);
} else {
  console.log(`${file}: already v3 (no changes).`);
}
