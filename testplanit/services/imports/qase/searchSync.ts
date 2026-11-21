import type { DbClient } from "~/lib/zenstack";
import { syncProjectIssuesToElasticsearch } from "~/services/issueSearch";
import { syncProjectMilestonesToElasticsearch } from "~/services/milestoneSearch";
import { syncAllProjectsToElasticsearch } from "~/services/projectSearch";
import { syncProjectCasesToElasticsearch } from "~/services/repositoryCaseSync";
import { syncProjectSharedStepsToElasticsearch } from "~/services/sharedStepSearch";
import { syncProjectTestRunsToElasticsearch } from "~/services/testRunSearch";

/**
 * Adds what an import wrote to the search index. The import writes past the
 * hooks that normally keep search current.
 *
 * The documents are written into the indices as they are. A queued reindex
 * is not used: it deletes an index and rebuilds it for one project only,
 * which drops every other project from search.
 */
export async function syncQaseImportToSearch(
  db: DbClient,
  projectIds: number[],
  createdProjects: boolean,
  tenantId?: string
): Promise<void> {
  const attempt = async (what: string, work: () => Promise<unknown>) => {
    try {
      await work();
    } catch (error) {
      console.error(`Failed to add ${what} to search after Qase import`, error);
    }
  };
  if (createdProjects) {
    await attempt("projects", () =>
      syncAllProjectsToElasticsearch(db, tenantId)
    );
  }
  for (const projectId of projectIds) {
    await attempt(`the test cases of project ${projectId}`, () =>
      syncProjectCasesToElasticsearch(projectId, 100, undefined, db, tenantId)
    );
    await attempt(`the shared steps of project ${projectId}`, () =>
      syncProjectSharedStepsToElasticsearch(projectId, 100, db, tenantId)
    );
    await attempt(`the milestones of project ${projectId}`, () =>
      syncProjectMilestonesToElasticsearch(projectId, db, tenantId)
    );
    await attempt(`the test runs of project ${projectId}`, () =>
      syncProjectTestRunsToElasticsearch(projectId, db, tenantId)
    );
    await attempt(`the issues of project ${projectId}`, () =>
      syncProjectIssuesToElasticsearch(projectId, db, tenantId)
    );
  }
}
