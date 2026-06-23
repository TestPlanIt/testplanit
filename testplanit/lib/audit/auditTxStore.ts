/**
 * Holds the transaction opened by `auditedTransaction` so the `lib/prisma.ts`
 * `$extends` write hooks can reuse it instead of opening their own second,
 * separate transaction.
 *
 * ── WHY THIS EXISTS ────────────────────────────────────────────────────────
 * The hooked-client write hooks each wrap their mutation in
 * `baseClient.$transaction(...)` so they can `set_config('app.audit_context')`
 * (SET LOCAL) in the SAME transaction as the write. That is correct for a
 * standalone autocommit write, but when a route already runs its writes inside
 * its own `prisma.$transaction`, the hook's nested `baseClient.$transaction`
 * opens a *separate* transaction on a *separate* connection. That:
 *   1. attributes only the hooked parent row (its split-off tx carries the GUC)
 *      while sibling child/value-table writes in the route's own tx get no
 *      actor, and
 *   2. breaks atomicity — the hooked write commits independently of the route's
 *      transaction (and can deadlock under a small/pgbouncer pool).
 *
 * `auditedTransaction` sets the GUC once at the route's transaction boundary and
 * publishes that transaction here. A hook firing inside it reads the ambient tx
 * and runs on it (GUC already present, single transaction, full attribution)
 * rather than opening its own.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import type { TxClient } from "~/lib/zenstack";

export const auditTxStore = new AsyncLocalStorage<TxClient>();
