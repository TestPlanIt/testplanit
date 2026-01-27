import {
  getElasticsearchClient,
  getRepositoryCaseIndexName,
  RepositoryCaseDocument,
} from "./elasticsearchService";

/**
 * Extract human-readable text from custom fields for searchable content
 */
function buildCustomFieldSearchableText(customFields?: RepositoryCaseDocument['customFields']): string {
  if (!customFields || customFields.length === 0) return "";

  return customFields
    .map((cf) => {
      switch (cf.fieldType) {
        case "Select":
        case "Dropdown":
          // Use the selected option's name instead of ID
          return cf.fieldOption?.name || "";

        case "Multi-Select":
          // Use the selected options' names instead of IDs
          if (cf.valueArray && cf.fieldOptions) {
            return cf.fieldOptions
              .filter((opt) => cf.valueArray?.includes(opt.id.toString()) || cf.valueArray?.includes(opt.id))
              .map((opt) => opt.name)
              .join(" ");
          }
          return "";

        case "Checkbox":
          // Include field name if checked
          return cf.valueBoolean ? cf.fieldName : "";

        case "Number":
        case "Integer":
          // Include numeric value
          return cf.valueNumeric !== null && cf.valueNumeric !== undefined
            ? cf.valueNumeric.toString()
            : "";

        case "Text String":
        case "Text Long":
        case "Link":
          // Include text value
          return cf.value || cf.valueKeyword || "";

        case "Date":
          // Include date value
          return cf.valueDate || "";

        default:
          // For unknown types, try to use value if it's a string
          return typeof cf.value === "string" ? cf.value : "";
      }
    })
    .filter(Boolean)
    .join(" ");
}

/**
 * Extract searchable text from test case steps
 */
function buildStepsSearchableText(steps?: RepositoryCaseDocument['steps']): string {
  if (!steps || steps.length === 0) return "";

  return steps
    .map((step) => {
      // Include step description, expected result, and shared step group name
      return [
        step.step,
        step.expectedResult,
        step.sharedStepGroupName
      ].filter(Boolean).join(" ");
    })
    .filter(Boolean)
    .join(" ");
}

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
    // Build searchable content from various fields including steps
    const searchableContent = [
      caseData.name,
      caseData.className,
      caseData.tags?.map((t) => t.name).join(" "),
      buildCustomFieldSearchableText(caseData.customFields),
      buildStepsSearchableText(caseData.steps),
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
      refresh: true, // Make document immediately searchable
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
      // Build searchable content including steps
      const searchableContent = [
        caseData.name,
        caseData.className,
        caseData.tags?.map((t) => t.name).join(" "),
        buildCustomFieldSearchableText(caseData.customFields),
        buildStepsSearchableText(caseData.steps),
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
      refresh: true, // Make deletion immediately visible in search
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
