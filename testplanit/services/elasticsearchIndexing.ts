import {
  getElasticsearchClient,
  REPOSITORY_CASE_INDEX,
  RepositoryCaseDocument,
} from "./elasticsearchService";

/**
 * Index a repository case in Elasticsearch
 */
export async function indexRepositoryCase(
  caseData: RepositoryCaseDocument
): Promise<boolean> {
  const client = getElasticsearchClient();
  if (!client) return false;

  try {
    // Build searchable content from various fields
    const searchableContent = [
      caseData.name,
      caseData.className,
      caseData.tags?.map((t) => t.name).join(" "),
      caseData.steps?.map((s) => {
        const stepContent = `${s.step} ${s.expectedResult}`;
        // Include shared step group name if it's a shared step
        return s.isSharedStep && s.sharedStepGroupName 
          ? `${stepContent} ${s.sharedStepGroupName}`
          : stepContent;
      }).join(" "),
      caseData.customFields?.map((cf) => cf.value).join(" "),
    ]
      .filter(Boolean)
      .join(" ");

    await client.index({
      index: REPOSITORY_CASE_INDEX,
      id: caseData.id.toString(),
      document: {
        ...caseData,
        searchableContent,
      },
    });

    console.log(`Indexed repository case ${caseData.id} in Elasticsearch`);
    return true;
  } catch (error) {
    console.error(`Failed to index repository case ${caseData.id}:`, error);
    return false;
  }
}

/**
 * Bulk index repository cases
 */
export async function bulkIndexRepositoryCases(
  cases: RepositoryCaseDocument[]
): Promise<boolean> {
  const client = getElasticsearchClient();
  if (!client || cases.length === 0) return false;

  try {
    const operations = cases.flatMap((caseData) => {
      // Build searchable content
      const searchableContent = [
        caseData.name,
        caseData.className,
        caseData.tags?.map((t) => t.name).join(" "),
        caseData.steps?.map((s) => {
          const stepContent = `${s.step} ${s.expectedResult}`;
          // Include shared step group name if it's a shared step
          return s.isSharedStep && s.sharedStepGroupName 
            ? `${stepContent} ${s.sharedStepGroupName}`
            : stepContent;
        }).join(" "),
        caseData.customFields?.map((cf) => cf.value).join(" "),
      ]
        .filter(Boolean)
        .join(" ");

      return [
        {
          index: { _index: REPOSITORY_CASE_INDEX, _id: caseData.id.toString() },
        },
        { ...caseData, searchableContent },
      ];
    });

    const bulkResponse = await client.bulk({
      operations,
      refresh: true,
    });

    if (bulkResponse.errors) {
      const errorItems = bulkResponse.items.filter((item) => item.index?.error);
      console.error("Bulk indexing errors:", errorItems);
      // Log detailed error information
      errorItems.forEach((item) => {
        if (item.index?.error) {
          console.error(`Failed to index document ${item.index._id}:`);
          console.error(`  Error type: ${item.index.error.type}`);
          console.error(`  Error reason: ${item.index.error.reason}`);
        }
      });
      return false;
    }

    console.log(
      `Bulk indexed ${cases.length} repository cases in Elasticsearch`
    );
    return true;
  } catch (error) {
    console.error("Failed to bulk index repository cases:", error);
    return false;
  }
}

/**
 * Delete a repository case from Elasticsearch
 */
export async function deleteRepositoryCase(caseId: number): Promise<boolean> {
  const client = getElasticsearchClient();
  if (!client) return false;

  try {
    await client.delete({
      index: REPOSITORY_CASE_INDEX,
      id: caseId.toString(),
    });

    console.log(`Deleted repository case ${caseId} from Elasticsearch`);
    return true;
  } catch (error) {
    // 404 is expected if document doesn't exist
    if ((error as any).statusCode === 404) {
      console.log(
        `Repository case ${caseId} not found in Elasticsearch (already deleted)`
      );
      return true;
    }
    console.error(`Failed to delete repository case ${caseId}:`, error);
    return false;
  }
}
