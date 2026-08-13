// lib/zenstack-plugins/esSyncPlugin.ts
// Elasticsearch indexing, split out of `sideEffectsPlugin` so it can run AFTER
// the mutation's transaction commits.
//
// Why this is a separate plugin rather than a few more cases in that one:
// `runAfterMutationWithinTransaction` is a property of the hook, not of the
// individual side effect, and `sideEffectsPlugin` needs `true` — its webhook
// emits and in-transaction writes must commit-or-roll-back with the mutation.
// Indexing needs the opposite. One hook cannot be both, so the two side effects
// live in two plugins.
//
// The bug this fixes: every `sync*ToElasticsearch` function reads the mutated
// row through `rawDb`, which is a SEPARATE pool connection from the mutation's
// transaction. Called from an in-transaction hook, that read runs under READ
// COMMITTED against an uncommitted row and finds nothing. The sync was also
// fire-and-forget, so it raced the commit: short single-row writes usually
// committed before the queued read executed and indexed fine, while long
// transactions — bulk imports especially — lost the race and silently skipped
// indexing.
//
// Verified against a scratch database before this was written:
//   runAfterMutationWithinTransaction: true  -> row NOT visible to a separate
//                                               connection (the bug)
//   runAfterMutationWithinTransaction: false -> row visible (this plugin)
// and the after-hook does NOT fire when the transaction rolls back, so a
// rolled-back write never reaches the index.
//
// Observed in production before the fix: 27 `source=API` repository cases,
// created Aug 5-12 2026 in consecutive id runs (the signature of bulk imports
// sharing one transaction), were absent from `testplanit-repository-cases`.
//
// RepositoryCases makes the race actively destructive rather than merely
// lossy: alone among the indexers, `syncRepositoryCaseToElasticsearch` reads a
// missing row as "hard deleted" and DELETES the document, so a mid-transaction
// update could remove a perfectly good doc.
import { definePlugin } from "@zenstackhq/orm";

import { schema } from "~/zenstack/schema";

// The `sync*ToElasticsearch` functions are imported LAZILY, inside the hook.
//
// Statically importing them here creates a module cycle — this plugin ->
// services/*Search -> lib/rawDb -> lib/zenstack -> this plugin — and
// `lib/zenstack` calls `$use(esSyncPlugin)` at module scope, so depending on
// which module the process happens to load first the binding is still in its
// temporal dead zone. That surfaces either as "Cannot access 'esSyncPlugin'
// before initialization" or, worse, as a plugin that silently never fires.
//
// `import()` inside the hook defers the resolution to first mutation, long
// after every module is initialised, and the loader caches the module so the
// cost is a map lookup per call. `sideEffectsPlugin` breaks the same cycle the
// same way for `~/lib/multiTenantDb`.
const syncOne = {
  repositoryCase: async (id: number) =>
    (
      await import("~/services/repositoryCaseSync")
    ).syncRepositoryCaseToElasticsearch(id),
  testRun: async (id: number) =>
    (await import("~/services/testRunSearch")).syncTestRunToElasticsearch(id),
  session: async (id: number) =>
    (await import("~/services/sessionSearch")).syncSessionToElasticsearch(id),
  issue: async (id: number) =>
    (await import("~/services/issueSearch")).syncIssueToElasticsearch(id),
  sharedStep: async (id: number) =>
    (await import("~/services/sharedStepSearch")).syncSharedStepToElasticsearch(
      id
    ),
  milestone: async (id: number) =>
    (await import("~/services/milestoneSearch")).syncMilestoneToElasticsearch(
      id
    ),
  project: async (id: number) =>
    (await import("~/services/projectSearch")).syncProjectToElasticsearch(id),
};

/**
 * Hard-delete counterparts. A hard delete leaves no row for
 * `sync*ToElasticsearch` to rebuild a document from, and most of those
 * functions treat "no row" as nothing-to-do and return — so before this plugin
 * existed a hard-deleted entity kept its document forever. Production had 5
 * such orphaned Issue documents.
 *
 * Removing the document on delete is only SAFE now that indexing runs after
 * commit. From inside the transaction, "row not found" was ambiguous — it
 * equally meant "not yet visible" — so acting on it would have deleted live
 * documents. Post-commit the row is genuinely gone.
 *
 * Soft deletes are updates, not deletes, and stay indexed on purpose (the
 * indexers store `isDeleted` and filter at search time).
 */
const removeOne = {
  repositoryCase: async (id: number) =>
    (await import("~/services/elasticsearchIndexing")).deleteRepositoryCase(id),
  testRun: async (id: number) =>
    (await import("~/services/testRunSearch")).deleteTestRunFromIndex(id),
  session: async (id: number) =>
    (await import("~/services/sessionSearch")).deleteSessionFromIndex(id),
  issue: async (id: number) =>
    (await import("~/services/issueSearch")).deleteIssueFromIndex(id),
  sharedStep: async (id: number) =>
    (await import("~/services/sharedStepSearch")).deleteSharedStep(id),
  milestone: async (id: number) =>
    (await import("~/services/milestoneSearch")).deleteMilestoneFromIndex(id),
  project: async (id: number) =>
    (await import("~/services/projectSearch")).deleteProjectFromIndex(id),
};
/**
 * TestPlanIt model -> indexer key. Only these models have Elasticsearch
 * documents; everything else falls straight through.
 */
const INDEXED_MODELS: Record<string, keyof typeof syncOne> = {
  RepositoryCases: "repositoryCase",
  TestRuns: "testRun",
  Sessions: "session",
  Issue: "issue",
  SharedStepGroup: "sharedStep",
  Milestones: "milestone",
  Projects: "project",
};

/**
 * A hard delete leaves no row, so the id can only come from the pre-mutation
 * snapshot — every indexed model needs its before-image, plus the tag link
 * table (whose deletes must reindex the owning case).
 *
 * `beforeMutationEntities` is per-plugin: it is populated only if THIS
 * plugin's before-hook called `loadBeforeMutationEntities()`, so the load is
 * required even though `sideEffectsPlugin` loads its own. Gated on `delete` to
 * keep it off the create/update hot path.
 */
const DELETE_BEFORE_IMAGE_MODELS = new Set([
  ...Object.keys(INDEXED_MODELS),
  "RepositoryCaseTag",
]);

function logEsError(kind: string, id: unknown) {
  return (error: unknown) =>
    console.error(
      `Failed to sync ${kind} ${String(id)} to Elasticsearch:`,
      error
    );
}

export const esSyncPlugin = definePlugin(schema, {
  id: "testplanit-es-sync",

  onEntityMutation: {
    // The whole point of this plugin — see the header.
    runAfterMutationWithinTransaction: false,

    beforeEntityMutation: async ({
      model,
      action,
      loadBeforeMutationEntities,
    }) => {
      if (action === "delete" && DELETE_BEFORE_IMAGE_MODELS.has(model)) {
        await loadBeforeMutationEntities();
      }
    },

    afterEntityMutation: async ({
      model,
      action,
      loadAfterMutationEntities,
      beforeMutationEntities,
    }) => {
      const isIndexed = model in INDEXED_MODELS;
      if (!isIndexed && model !== "RepositoryCaseTag") return;

      const before = (beforeMutationEntities ?? []) as any[];
      // A delete has no after-image; skip the load rather than pay for a query
      // that can only come back empty.
      const after =
        action === "delete"
          ? []
          : (((await loadAfterMutationEntities()) ?? []) as any[]);

      // Tags live in the case's document but are written as standalone link
      // rows (the case details view and the CSV import both write
      // RepositoryCaseTag directly, never touching the case), so the case has
      // to be reindexed off the link table's own mutations.
      if (model === "RepositoryCaseTag") {
        const caseIds = new Set<number>();
        for (const row of [...after, ...before]) {
          if (row?.caseId != null) caseIds.add(row.caseId);
        }
        for (const caseId of caseIds) {
          syncOne
            .repositoryCase(caseId)
            .catch(logEsError("repository case", caseId));
        }
        return;
      }

      const kind = INDEXED_MODELS[model];

      // Hard delete: drop the document. Soft deletes arrive as updates and stay
      // indexed on purpose.
      if (action === "delete") {
        for (const row of before) {
          if (row?.id) removeOne[kind](row.id).catch(logEsError(kind, row.id));
        }
        return;
      }

      for (const row of after) {
        if (row?.id) syncOne[kind](row.id).catch(logEsError(kind, row.id));
      }
    },
  },
});
