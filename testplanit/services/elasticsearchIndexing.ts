import {
  getElasticsearchClient,
  getRepositoryCaseIndexName,
  RepositoryCaseDocument,
} from "./elasticsearchService";

/**
 * Index a repository case in Elasticsearch
 * @param caseData - The repository case data to index
 * @param tenantId - Optional tenant ID for multi-tenant mode
 */
export async function indexRepositoryCase(
  caseData: RepositoryCaseDocument,
  tenantId?: string
): Promise<boolean> {
  const client = getElasticsearchClient();
  if (!client) return false;

  const indexName = getRepositoryCaseIndexName(tenantId);

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
      index: indexName,
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
 * @param cases - Array of repository case data to index
 * @param tenantId - Optional tenant ID for multi-tenant mode
 */
export async function bulkIndexRepositoryCases(
  cases: RepositoryCaseDocument[],
  tenantId?: string
): Promise<boolean> {
  const client = getElasticsearchClient();
  if (!client || cases.length === 0) return false;

  const indexName = getRepositoryCaseIndexName(tenantId);

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
          index: { _index: indexName, _id: caseData.id.toString() },
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
 * @param caseId - The ID of the repository case to delete
 * @param tenantId - Optional tenant ID for multi-tenant mode
 */
export async function deleteRepositoryCase(
  caseId: number,
  tenantId?: string
): Promise<boolean> {
  const client = getElasticsearchClient();
  if (!client) return false;

  const indexName = getRepositoryCaseIndexName(tenantId);

  try {
    await client.delete({
      index: indexName,
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
