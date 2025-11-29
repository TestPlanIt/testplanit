import { describe, it, expect } from "vitest";
import { repositoryCaseMapping, REPOSITORY_CASE_INDEX } from "./elasticsearchService";

describe("elasticsearchService", () => {
  describe("repositoryCaseMapping", () => {
    it("should have correct mapping structure", () => {
      expect(repositoryCaseMapping.properties).toBeDefined();
      
      // Check basic fields
      expect(repositoryCaseMapping.properties.id).toEqual({ type: "integer" });
      expect(repositoryCaseMapping.properties.projectId).toEqual({ type: "integer" });
      expect(repositoryCaseMapping.properties.projectName).toEqual({ type: "keyword" });
      
      // Check text field with analyzer
      expect(repositoryCaseMapping.properties.name).toEqual({
        type: "text",
        analyzer: "standard",
        fields: {
          keyword: { type: "keyword" },
          suggest: { type: "completion" },
        },
      });
      
      // Check nested fields
      expect(repositoryCaseMapping.properties.tags).toEqual({
        type: "nested",
        properties: {
          id: { type: "integer" },
          name: { type: "keyword" },
        },
      });
      
      expect(repositoryCaseMapping.properties.customFields).toEqual({
        type: "nested",
        properties: {
          fieldId: { type: "integer" },
          fieldName: { type: "keyword" },
          fieldType: { type: "keyword" },
          value: { type: "text" },
        },
      });
      
      // Check steps with shared step fields
      expect(repositoryCaseMapping.properties.steps).toEqual({
        type: "nested",
        properties: {
          id: { type: "integer" },
          order: { type: "integer" },
          step: { type: "text" },
          expectedResult: { type: "text" },
          isSharedStep: { type: "boolean" },
          sharedStepGroupId: { type: "integer" },
          sharedStepGroupName: { type: "text" },
        },
      });
      
      // Check searchable content field
      expect(repositoryCaseMapping.properties.searchableContent).toEqual({ type: "text" });
      
      // Check that folderPath is keyword (not text) to match unified service
      expect(repositoryCaseMapping.properties.folderPath).toEqual({ type: "keyword" });
    });
  });

  describe("constants", () => {
    it("should export correct index name", () => {
      expect(REPOSITORY_CASE_INDEX).toBe("testplanit-repository-cases");
    });
  });

});