// lib/zenstack-plugins/repoJobStatusPlugin.ts
//
// Every read of ProjectCodeRepositoryConfig reports its jobs (ticket scan,
// stale pin check, cache refresh) from the repo-cache queue rather than from
// the saved flags alone. The Impact settings pages fetch the model through
// the RPC endpoint, so hooking the read is what lets them show Queued,
// Running, Not responding or Interrupted without a polling endpoint of
// their own. A flag the queue disowns is rewritten as interrupted on the
// way out and persisted, so a leftover clears itself on first read.
import { definePlugin } from "@zenstackhq/orm";
import { schema } from "~/zenstack/schema";
import type { RepoStatusRow } from "~/lib/services/impact/repoJobStatus";

const READ_OPERATIONS = new Set([
  "findMany",
  "findFirst",
  "findFirstOrThrow",
  "findUnique",
  "findUniqueOrThrow",
]);

let warnedOnce = false;

export const repoJobStatusPlugin = definePlugin(schema, {
  id: "testplanit-repo-job-status",

  onQuery: async ({ model, operation, args, proceed, client }) => {
    const result = await proceed(args as never);
    if (
      model !== "ProjectCodeRepositoryConfig" ||
      !READ_OPERATIONS.has(operation)
    ) {
      return result;
    }
    const rows = (
      Array.isArray(result) ? result : result ? [result] : []
    ) as RepoStatusRow[];
    if (rows.length === 0) return result;
    try {
      // Loaded here, not at module scope: lib/queues and lib/multiTenantDb
      // both reach back into the client layer this plugin is part of.
      const [{ annotateRepoJobStatus }, { getRepoCacheQueue }, tenant] =
        await Promise.all([
          import("~/lib/services/impact/repoJobStatus"),
          import("~/lib/queues"),
          import("~/lib/multiTenantDb"),
        ]);
      // The plugin client has no model accessors; a derived client shares
      // the connection and, without plugins, neither re-enters this hook nor
      // subjects the write to the reader's policy.
      const plain = client.$unuseAll() as unknown as {
        projectCodeRepositoryConfig: {
          update: (args: unknown) => Promise<unknown>;
        };
      };
      await annotateRepoJobStatus(rows, {
        queue: getRepoCacheQueue(),
        tenantId: tenant.getCurrentTenantId(),
        persist: async (configId, data) => {
          await plain.projectCodeRepositoryConfig.update({
            where: { id: configId },
            data,
          });
        },
      });
    } catch (err) {
      // The saved flags stand in when the queue cannot be asked.
      if (!warnedOnce) {
        warnedOnce = true;
        console.warn("[repoJobStatus] Could not resolve job status:", err);
      }
    }
    return result;
  },
});
