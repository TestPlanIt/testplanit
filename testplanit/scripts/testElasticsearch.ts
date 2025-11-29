import {
  testElasticsearchConnection,
  createRepositoryCaseIndex,
} from "../services/elasticsearchService";
import { indexRepositoryCase } from "../services/elasticsearchIndexing";
import type { RepositoryCaseDocument } from "../services/elasticsearchService";

async function testElasticsearchIntegration() {
  console.log("Testing Elasticsearch integration...\n");

  // Test connection
  console.log("1. Testing connection...");
  const isConnected = await testElasticsearchConnection();
  if (!isConnected) {
    console.error(
      "Failed to connect to Elasticsearch. Make sure ELASTICSEARCH_NODE is set correctly."
    );
    process.exit(1);
  }

  // Create index
  console.log("\n2. Creating repository cases index...");
  const indexCreated = await createRepositoryCaseIndex();
  if (!indexCreated) {
    console.error("Failed to create Elasticsearch index.");
    process.exit(1);
  }

  // Test indexing a sample case
  console.log("\n3. Indexing a sample repository case...");
  const sampleCase: RepositoryCaseDocument = {
    id: 1,
    projectId: 1,
    projectName: "Test Project",
    repositoryId: 1,
    folderId: 1,
    folderPath: "/tests",
    templateId: 1,
    templateName: "Default Template",
    name: "Sample Test Case",
    className: "SampleTestCase",
    source: "MANUAL",
    stateId: 1,
    stateName: "Active",
    automated: false,
    isArchived: false,
    isDeleted: false,
    createdAt: new Date(),
    creatorId: "user123",
    creatorName: "Test User",
    tags: [
      { id: 1, name: "smoke" },
      { id: 2, name: "critical" },
    ],
    steps: [
      {
        id: 1,
        order: 1,
        step: "Open the application",
        expectedResult: "Application opens successfully",
      },
      {
        id: 2,
        order: 2,
        step: "Login with valid credentials",
        expectedResult: "User is logged in",
      },
    ],
  };

  const indexed = await indexRepositoryCase(sampleCase);
  if (indexed) {
    console.log("✅ Successfully indexed sample repository case!");
  } else {
    console.error("Failed to index sample repository case.");
  }

  console.log("\n✅ Elasticsearch integration test completed successfully!");
  console.log("\nTo use this in your application:");
  console.log(
    "1. Set ELASTICSEARCH_NODE environment variable (e.g., http://192.168.1.72:9201)"
  );
  console.log(
    "2. Import the functions from services/elasticsearchService.ts and services/elasticsearchIndexing.ts"
  );
  console.log("3. Call createRepositoryCaseIndex() on application startup");
  console.log("4. Use indexRepositoryCase() when creating/updating cases");
  console.log("5. Use deleteRepositoryCase() when deleting cases");
}

// Run the test
testElasticsearchIntegration().catch(console.error);
