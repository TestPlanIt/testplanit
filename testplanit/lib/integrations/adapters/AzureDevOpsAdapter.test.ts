import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AzureDevOpsAdapter } from "./AzureDevOpsAdapter";

// Mock global fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe("AzureDevOpsAdapter", () => {
  let adapter: AzureDevOpsAdapter;

  const mockWorkItem = {
    id: 123,
    rev: 1,
    url: "https://dev.azure.com/testorg/_apis/wit/workItems/123",
    _links: {
      html: {
        href: "https://dev.azure.com/testorg/TestProject/_workitems/edit/123",
      },
    },
    fields: {
      "System.Id": 123,
      "System.Title": "Test Work Item",
      "System.Description": "Test description",
      "System.State": "Active",
      "Microsoft.VSTS.Common.Priority": 2,
      "System.AssignedTo": {
        uniqueName: "user@example.com",
        displayName: "Test User",
      },
      "System.CreatedBy": {
        uniqueName: "creator@example.com",
        displayName: "Creator User",
      },
      "System.Tags": "bug; critical",
      "System.TeamProject": "TestProject",
      "System.WorkItemType": "Bug",
      "System.CreatedDate": "2024-01-15T10:00:00.000Z",
      "System.ChangedDate": "2024-01-15T12:00:00.000Z",
      "Custom.Field": "custom value",
    },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    adapter = new AzureDevOpsAdapter({
      provider: "AZURE_DEVOPS",
      organizationUrl: "https://dev.azure.com/testorg",
      project: "TestProject",
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("getCapabilities", () => {
    it("should return correct capabilities for Azure DevOps", () => {
      const capabilities = adapter.getCapabilities();

      expect(capabilities).toEqual({
        createIssue: true,
        updateIssue: true,
        linkIssue: true,
        syncIssue: true,
        searchIssues: true,
        webhooks: true,
        customFields: true,
        attachments: true,
        linkedIssues: true,
        comments: true,
      });
    });
  });

  describe("authenticate", () => {
    it("should authenticate successfully with PAT", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ value: [] }),
      });

      await adapter.authenticate({
        type: "api_key",
        apiKey: "test-pat-token",
      });

      expect(mockFetch).toHaveBeenCalledWith(
        "https://dev.azure.com/testorg/_apis/projects?api-version=7.0",
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: expect.stringMatching(/^Basic /),
          }),
        })
      );
    });

    it("should throw error for non-API key auth type", async () => {
      await expect(
        adapter.authenticate({
          type: "oauth",
          accessToken: "token",
        })
      ).rejects.toThrow(
        "Azure DevOps adapter only supports Personal Access Token authentication"
      );
    });

    it("should throw error when PAT is missing", async () => {
      await expect(
        adapter.authenticate({
          type: "api_key",
        })
      ).rejects.toThrow(
        "Personal Access Token is required for Azure DevOps authentication"
      );
    });

    it("should throw error when organization URL is missing", async () => {
      const adapterNoOrg = new AzureDevOpsAdapter({
        provider: "AZURE_DEVOPS",
        project: "TestProject",
      });

      await expect(
        adapterNoOrg.authenticate({
          type: "api_key",
          apiKey: "test-token",
        })
      ).rejects.toThrow("Organization URL is required for Azure DevOps");
    });

    it("should throw error for invalid PAT", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        text: () => Promise.resolve("Unauthorized"),
      });

      await expect(
        adapter.authenticate({
          type: "api_key",
          apiKey: "invalid-token",
        })
      ).rejects.toThrow(
        "Invalid Azure DevOps Personal Access Token or Organization URL"
      );
    });
  });

  describe("createIssue", () => {
    beforeEach(async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ value: [] }),
      });
      await adapter.authenticate({ type: "api_key", apiKey: "test-token" });
    });

    it("should create work item with title", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockWorkItem),
      });

      const result = await adapter.createIssue({
        title: "Test Work Item",
        projectId: "TestProject",
      });

      const createCall = mockFetch.mock.calls[1];
      expect(createCall[0]).toContain("/_apis/wit/workitems/$Bug");

      const body = JSON.parse(createCall[1].body);
      expect(body).toContainEqual({
        op: "add",
        path: "/fields/System.Title",
        value: "Test Work Item",
      });

      expect(result.id).toBe("123");
      expect(result.title).toBe("Test Work Item");
    });

    it("should create work item with description", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockWorkItem),
      });

      await adapter.createIssue({
        title: "Test",
        description: "Test description",
        projectId: "TestProject",
      });

      const createCall = mockFetch.mock.calls[1];
      const body = JSON.parse(createCall[1].body);

      expect(body).toContainEqual({
        op: "add",
        path: "/fields/System.Description",
        value: "Test description",
      });
    });

    it("should create work item with TipTap description", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockWorkItem),
      });

      const tiptapDescription = {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [{ type: "text", text: "TipTap content" }],
          },
        ],
      };

      await adapter.createIssue({
        title: "Test",
        description: tiptapDescription as any,
        projectId: "TestProject",
      });

      const createCall = mockFetch.mock.calls[1];
      const body = JSON.parse(createCall[1].body);

      // Should extract text from TipTap
      const descriptionField = body.find(
        (f: any) => f.path === "/fields/System.Description"
      );
      expect(descriptionField.value).toContain("TipTap content");
    });

    it("should create work item with priority", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockWorkItem),
      });

      await adapter.createIssue({
        title: "Test",
        priority: "2",
        projectId: "TestProject",
      });

      const createCall = mockFetch.mock.calls[1];
      const body = JSON.parse(createCall[1].body);

      expect(body).toContainEqual({
        op: "add",
        path: "/fields/Microsoft.VSTS.Common.Priority",
        value: 2,
      });
    });

    it("should create work item with assignee", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockWorkItem),
      });

      await adapter.createIssue({
        title: "Test",
        assigneeId: "user@example.com",
        projectId: "TestProject",
      });

      const createCall = mockFetch.mock.calls[1];
      const body = JSON.parse(createCall[1].body);

      expect(body).toContainEqual({
        op: "add",
        path: "/fields/System.AssignedTo",
        value: "user@example.com",
      });
    });

    it("should create work item with labels/tags", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockWorkItem),
      });

      await adapter.createIssue({
        title: "Test",
        labels: ["bug", "critical"],
        projectId: "TestProject",
      });

      const createCall = mockFetch.mock.calls[1];
      const body = JSON.parse(createCall[1].body);

      expect(body).toContainEqual({
        op: "add",
        path: "/fields/System.Tags",
        value: "bug; critical",
      });
    });

    it("should create work item with custom fields", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockWorkItem),
      });

      await adapter.createIssue({
        title: "Test",
        projectId: "TestProject",
        customFields: {
          "Custom.Field": "custom value",
        },
      });

      const createCall = mockFetch.mock.calls[1];
      const body = JSON.parse(createCall[1].body);

      expect(body).toContainEqual({
        op: "add",
        path: "/fields/Custom.Field",
        value: "custom value",
      });
    });

    it("should create work item with specified issue type", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockWorkItem),
      });

      await adapter.createIssue({
        title: "Test",
        issueType: "Task",
        projectId: "TestProject",
      });

      const createCall = mockFetch.mock.calls[1];
      expect(createCall[0]).toContain("/_apis/wit/workitems/$Task");
    });

    it("should throw error when project not configured", async () => {
      const adapterNoProject = new AzureDevOpsAdapter({
        provider: "AZURE_DEVOPS",
        organizationUrl: "https://dev.azure.com/testorg",
      });

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ value: [] }),
      });
      await adapterNoProject.authenticate({
        type: "api_key",
        apiKey: "test-token",
      });

      await expect(
        adapterNoProject.createIssue({
          title: "Test",
          projectId: "",
        })
      ).rejects.toThrow("Azure DevOps project not configured");
    });
  });

  describe("updateIssue", () => {
    beforeEach(async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ value: [] }),
      });
      await adapter.authenticate({ type: "api_key", apiKey: "test-token" });
    });

    it("should update work item title", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            ...mockWorkItem,
            fields: { ...mockWorkItem.fields, "System.Title": "Updated Title" },
          }),
      });

      const _result = await adapter.updateIssue("123", {
        title: "Updated Title",
      });

      const updateCall = mockFetch.mock.calls[1];
      expect(updateCall[0]).toContain("/_apis/wit/workitems/123");
      expect(updateCall[1].method).toBe("PATCH");

      const body = JSON.parse(updateCall[1].body);
      expect(body).toContainEqual({
        op: "replace",
        path: "/fields/System.Title",
        value: "Updated Title",
      });
    });

    it("should update work item status", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockWorkItem),
      });

      await adapter.updateIssue("123", {
        status: "Resolved",
      });

      const updateCall = mockFetch.mock.calls[1];
      const body = JSON.parse(updateCall[1].body);

      expect(body).toContainEqual({
        op: "replace",
        path: "/fields/System.State",
        value: "Resolved",
      });
    });

    it("should update multiple fields", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockWorkItem),
      });

      await adapter.updateIssue("123", {
        title: "New Title",
        description: "New description",
        priority: "1",
        labels: ["updated"],
      });

      const updateCall = mockFetch.mock.calls[1];
      const body = JSON.parse(updateCall[1].body);

      expect(body.length).toBe(4);
    });
  });

  describe("getIssue", () => {
    beforeEach(async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ value: [] }),
      });
      await adapter.authenticate({ type: "api_key", apiKey: "test-token" });
    });

    it("should get work item by ID", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockWorkItem),
      });

      const result = await adapter.getIssue("123");

      expect(mockFetch).toHaveBeenLastCalledWith(
        expect.stringContaining("/_apis/wit/workitems/123"),
        expect.any(Object)
      );

      expect(result.id).toBe("123");
      expect(result.key).toBe("123");
      expect(result.title).toBe("Test Work Item");
      expect(result.description).toBe("Test description");
      expect(result.status).toBe("Active");
      expect(result.priority).toBe("2");
      expect(result.labels).toEqual(["bug", "critical"]);
    });

    it("should map assignee correctly", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockWorkItem),
      });

      const result = await adapter.getIssue("123");

      expect(result.assignee).toEqual({
        id: "user@example.com",
        name: "Test User",
        email: "user@example.com",
      });
    });

    it("should map reporter correctly", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockWorkItem),
      });

      const result = await adapter.getIssue("123");

      expect(result.reporter).toEqual({
        id: "creator@example.com",
        name: "Creator User",
        email: "creator@example.com",
      });
    });

    it("should extract custom fields", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockWorkItem),
      });

      const result = await adapter.getIssue("123");

      expect(result.customFields).toHaveProperty(
        "Custom.Field",
        "custom value"
      );
      // Should not include system fields
      expect(result.customFields).not.toHaveProperty("System.Title");
      expect(result.customFields).not.toHaveProperty("System.State");
    });

    it("should handle work item without assignee", async () => {
      const workItemNoAssignee = {
        ...mockWorkItem,
        fields: {
          ...mockWorkItem.fields,
          "System.AssignedTo": undefined,
        },
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(workItemNoAssignee),
      });

      const result = await adapter.getIssue("123");

      expect(result.assignee).toBeUndefined();
    });
  });

  describe("getLinkedIssues", () => {
    const mockWorkItemWithRelations = {
      id: 123,
      fields: { "System.Title": "Source" },
      relations: [
        {
          rel: "System.LinkTypes.Related",
          url: "https://dev.azure.com/org/proj/_apis/wit/workItems/200",
          attributes: { name: "Related" },
        },
        {
          rel: "System.LinkTypes.Hierarchy-Forward",
          url: "https://dev.azure.com/org/proj/_apis/wit/workItems/201",
          attributes: { name: "Child" },
        },
        {
          rel: "System.LinkTypes.Hierarchy-Reverse",
          url: "https://dev.azure.com/org/proj/_apis/wit/workItems/202",
          attributes: { name: "Parent" },
        },
        {
          rel: "System.LinkTypes.Successor",
          url: "https://dev.azure.com/org/proj/_apis/wit/workItems/203",
        },
        {
          rel: "System.LinkTypes.Predecessor",
          url: "https://dev.azure.com/org/proj/_apis/wit/workItems/204",
        },
        {
          rel: "System.LinkTypes.Tested-By",
          url: "https://dev.azure.com/org/proj/_apis/wit/workItems/205",
        },
        {
          rel: "System.LinkTypes.Affects-Forward",
          url: "https://dev.azure.com/org/proj/_apis/wit/workItems/206",
        },
        {
          rel: "System.LinkTypes.Duplicate-Reverse",
          url: "https://dev.azure.com/org/proj/_apis/wit/workItems/207",
        },
      ],
    };

    beforeEach(async () => {
      mockFetch.mockReset();
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ value: [] }),
      });
      await adapter.authenticate({ type: "api_key", apiKey: "test-token" });
    });

    afterEach(() => {
      mockFetch.mockReset();
    });

    it("should map every System.LinkTypes.* relation with correct direction semantics", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockWorkItemWithRelations),
      });

      const result = await adapter.getLinkedIssues!("123");

      expect(result).toHaveLength(8);
      expect(result).toEqual(
        expect.arrayContaining([
          {
            id: "200",
            key: "200",
            linkType: "Related",
            direction: "outward",
          },
          {
            id: "201",
            key: "201",
            linkType: "Hierarchy-Forward",
            direction: "outward",
          },
          {
            id: "202",
            key: "202",
            linkType: "Hierarchy-Reverse",
            direction: "inward",
          },
          {
            id: "203",
            key: "203",
            linkType: "Successor",
            direction: "outward",
          },
          {
            id: "204",
            key: "204",
            linkType: "Predecessor",
            direction: "outward",
          },
          {
            id: "205",
            key: "205",
            linkType: "Tested-By",
            direction: "outward",
          },
          {
            id: "206",
            key: "206",
            linkType: "Affects-Forward",
            direction: "outward",
          },
          {
            id: "207",
            key: "207",
            linkType: "Duplicate-Reverse",
            direction: "inward",
          },
        ])
      );
    });

    it("should filter out ArtifactLink and AttachedFile relations", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            id: 123,
            fields: { "System.Title": "Source" },
            relations: [
              {
                rel: "System.LinkTypes.Related",
                url: "https://dev.azure.com/org/proj/_apis/wit/workItems/300",
              },
              {
                rel: "System.LinkTypes.Successor",
                url: "https://dev.azure.com/org/proj/_apis/wit/workItems/301",
              },
              { rel: "ArtifactLink", url: "vstfs:///Git/Commit/abc" },
              {
                rel: "AttachedFile",
                url: "https://dev.azure.com/org/proj/_apis/wit/attachments/x",
              },
            ],
          }),
      });

      const result = await adapter.getLinkedIssues!("123");

      expect(result).toHaveLength(2);
      expect(result.every((r) => r.linkType !== "ArtifactLink")).toBe(true);
      expect(result.every((r) => r.linkType !== "AttachedFile")).toBe(true);
    });

    it("should return [] when relations field is missing", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            id: 123,
            fields: { "System.Title": "Source" },
          }),
      });

      const result = await adapter.getLinkedIssues!("123");

      expect(result).toEqual([]);
    });

    it("should return [] when relations array is empty", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            id: 123,
            fields: { "System.Title": "Source" },
            relations: [],
          }),
      });

      const result = await adapter.getLinkedIssues!("123");

      expect(result).toEqual([]);
    });

    it("should call the work-item endpoint with $expand=relations", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockWorkItemWithRelations),
      });

      await adapter.getLinkedIssues!("123");

      const lastCall = mockFetch.mock.calls[mockFetch.mock.calls.length - 1];
      const calledUrl = lastCall[0] as string;
      const decodedUrl = decodeURIComponent(calledUrl);
      expect(decodedUrl).toContain("$expand=relations");
      expect(decodedUrl).not.toContain("$expand=all");
      expect(calledUrl).toContain("/_apis/wit/workitems/123");
    });

    it("should fail soft on 403 by returning [] and logging at warn level", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 403,
        statusText: "Forbidden",
        text: () => Promise.resolve("Forbidden"),
      });
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

      const result = await adapter.getLinkedIssues!("123");

      expect(result).toEqual([]);
      expect(warnSpy).toHaveBeenCalledTimes(1);
      const firstArg = warnSpy.mock.calls[0].join(" ");
      expect(firstArg).toContain("[AzureDevOpsAdapter]");
      expect(firstArg).toContain("getLinkedIssues");
      expect(firstArg).toContain("123");
      warnSpy.mockRestore();
    });

    it("should fail soft on 404 by returning [] and logging at warn level", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        statusText: "Not Found",
        text: () => Promise.resolve("Not Found"),
      });
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

      const result = await adapter.getLinkedIssues!("123");

      expect(result).toEqual([]);
      expect(warnSpy).toHaveBeenCalledTimes(1);
      const firstArg = warnSpy.mock.calls[0].join(" ");
      expect(firstArg).toContain("[AzureDevOpsAdapter]");
      expect(firstArg).toContain("getLinkedIssues");
      expect(firstArg).toContain("123");
      warnSpy.mockRestore();
    });

    it("should fail soft on 500 by returning [] and logging at error level", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: "Internal Server Error",
        text: () => Promise.resolve("Internal Server Error"),
      });
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      const result = await adapter.getLinkedIssues!("123");

      expect(result).toEqual([]);
      expect(errorSpy).toHaveBeenCalledTimes(1);
      const firstArg = errorSpy.mock.calls[0].join(" ");
      expect(firstArg).toContain("[AzureDevOpsAdapter]");
      expect(firstArg).toContain("getLinkedIssues");
      expect(firstArg).toContain("123");
      errorSpy.mockRestore();
    });

    it("should silently drop malformed relation entries while keeping valid ones", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            id: 123,
            fields: { "System.Title": "Source" },
            relations: [
              {
                rel: "System.LinkTypes.Related",
                url: "https://dev.azure.com/org/proj/_apis/wit/workItems/400",
              },
              { rel: "System.LinkTypes.Related" },
              {
                rel: "System.LinkTypes.Related",
                url: "https://dev.azure.com/org/proj/_apis/wit/attachments/abc",
              },
            ],
          }),
      });

      const result = await adapter.getLinkedIssues!("123");

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        id: "400",
        key: "400",
        linkType: "Related",
        direction: "outward",
      });
    });

    it("should fail soft on network error by returning [] and logging at error level", async () => {
      mockFetch.mockRejectedValueOnce(new Error("network ECONNRESET"));
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      const result = await adapter.getLinkedIssues!("123");

      expect(result).toEqual([]);
      expect(errorSpy).toHaveBeenCalledTimes(1);
      const firstArg = errorSpy.mock.calls[0].join(" ");
      expect(firstArg).toContain("[AzureDevOpsAdapter]");
      expect(firstArg).toContain("getLinkedIssues");
      expect(firstArg).toContain("123");
      errorSpy.mockRestore();
    });

    it("should encode issueId path-injection chars (?, /, &) in URL", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockWorkItemWithRelations),
      });

      await adapter.getLinkedIssues!("123?api-version=evil");

      const lastCall = mockFetch.mock.calls[mockFetch.mock.calls.length - 1];
      const calledUrl = lastCall[0] as string;
      expect(calledUrl).toContain(
        "/_apis/wit/workitems/123%3Fapi-version%3Devil?"
      );
      expect(calledUrl).not.toContain(
        "/_apis/wit/workitems/123?api-version=evil?"
      );
    });
  });

  describe("getIssueComments", () => {
    const mockAdoCommentsResponse = {
      count: 2,
      comments: [
        {
          id: 10,
          text: "Reviewed",
          createdBy: { displayName: "Alice" },
          createdDate: "2026-01-01T00:00:00Z",
        },
        {
          id: 11,
          text: "LGTM",
          createdBy: { displayName: "Bob" },
          createdDate: "2026-01-02T00:00:00Z",
        },
      ],
    };

    beforeEach(async () => {
      mockFetch.mockReset();
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ value: [] }),
      });
      await adapter.authenticate({ type: "api_key", apiKey: "test-token" });
    });

    afterEach(() => {
      mockFetch.mockReset();
    });

    it("should request /_apis/wit/workitems/{id}/comments with -preview api-version suffix", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockAdoCommentsResponse),
      });

      await adapter.getIssueComments!("123");

      const lastCall = mockFetch.mock.calls[mockFetch.mock.calls.length - 1];
      const calledUrl = lastCall[0] as string;
      expect(calledUrl).toContain("/_apis/wit/workitems/123/comments");
      expect(calledUrl).toContain("api-version=");
      expect(calledUrl).toContain("-preview");
    });

    it("should map all comments to IssueComment[] on the happy path", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockAdoCommentsResponse),
      });

      const result = await adapter.getIssueComments!("123");

      expect(result).toEqual([
        {
          id: "10",
          author: "Alice",
          body: "Reviewed",
          created: "2026-01-01T00:00:00Z",
        },
        {
          id: "11",
          author: "Bob",
          body: "LGTM",
          created: "2026-01-02T00:00:00Z",
        },
      ]);
    });

    it("should fall back to 'Unknown' when createdBy is missing or displayName is absent", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            count: 2,
            comments: [
              {
                id: 20,
                text: "no createdBy",
                createdDate: "2026-01-03T00:00:00Z",
              },
              {
                id: 21,
                text: "no displayName",
                createdBy: {},
                createdDate: "2026-01-04T00:00:00Z",
              },
            ],
          }),
      });

      const result = await adapter.getIssueComments!("123");

      expect(result).toHaveLength(2);
      expect(result[0].author).toBe("Unknown");
      expect(result[1].author).toBe("Unknown");
    });

    it("should return [] when response is empty object", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({}),
      });

      const result = await adapter.getIssueComments!("123");

      expect(result).toEqual([]);
    });

    it("should return [] when comments array is empty", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ count: 0, comments: [] }),
      });

      const result = await adapter.getIssueComments!("123");

      expect(result).toEqual([]);
    });

    it("should skip malformed entries and keep valid ones", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            count: 2,
            comments: [
              null,
              {
                id: 30,
                text: "valid",
                createdBy: { displayName: "Carol" },
                createdDate: "2026-01-05T00:00:00Z",
              },
            ],
          }),
      });

      const result = await adapter.getIssueComments!("123");

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        id: "30",
        author: "Carol",
        body: "valid",
        created: "2026-01-05T00:00:00Z",
      });
    });

    it("should fail soft on 403 by returning [] and logging at warn level", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 403,
        statusText: "Forbidden",
        text: () => Promise.resolve("Forbidden"),
      });
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

      const result = await adapter.getIssueComments!("123");

      expect(result).toEqual([]);
      expect(warnSpy).toHaveBeenCalledTimes(1);
      const firstArg = warnSpy.mock.calls[0].join(" ");
      expect(firstArg).toContain("[AzureDevOpsAdapter]");
      expect(firstArg).toContain("getIssueComments");
      expect(firstArg).toContain("123");
      warnSpy.mockRestore();
    });

    it("should fail soft on 404 by returning [] and logging at warn level", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        statusText: "Not Found",
        text: () => Promise.resolve("Not Found"),
      });
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

      const result = await adapter.getIssueComments!("123");

      expect(result).toEqual([]);
      expect(warnSpy).toHaveBeenCalledTimes(1);
      const firstArg = warnSpy.mock.calls[0].join(" ");
      expect(firstArg).toContain("[AzureDevOpsAdapter]");
      expect(firstArg).toContain("getIssueComments");
      expect(firstArg).toContain("123");
      warnSpy.mockRestore();
    });

    it("should fail soft on 5xx by returning [] and logging at error level", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 503,
        statusText: "Service Unavailable",
        text: () => Promise.resolve("Service Unavailable"),
      });
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      const result = await adapter.getIssueComments!("123");

      expect(result).toEqual([]);
      expect(errorSpy).toHaveBeenCalledTimes(1);
      const firstArg = errorSpy.mock.calls[0].join(" ");
      expect(firstArg).toContain("[AzureDevOpsAdapter]");
      expect(firstArg).toContain("getIssueComments");
      expect(firstArg).toContain("123");
      errorSpy.mockRestore();
    });

    it("should fail soft on network error by returning [] and logging at error level", async () => {
      mockFetch.mockRejectedValueOnce(new Error("network ECONNRESET"));
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      const result = await adapter.getIssueComments!("123");

      expect(result).toEqual([]);
      expect(errorSpy).toHaveBeenCalledTimes(1);
      const firstArg = errorSpy.mock.calls[0].join(" ");
      expect(firstArg).toContain("[AzureDevOpsAdapter]");
      expect(firstArg).toContain("getIssueComments");
      expect(firstArg).toContain("123");
      errorSpy.mockRestore();
    });

    it("should encode issueId path-injection chars (/) in URL", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockAdoCommentsResponse),
      });

      await adapter.getIssueComments!("123/../456");

      const lastCall = mockFetch.mock.calls[mockFetch.mock.calls.length - 1];
      const calledUrl = lastCall[0] as string;
      expect(calledUrl).toContain(
        "/_apis/wit/workitems/123%2F..%2F456/comments"
      );
      expect(calledUrl).not.toContain("/_apis/wit/workitems/123/../456/");
    });

    it("should encode query-injection chars (?, &) in issueId", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockAdoCommentsResponse),
      });

      await adapter.getIssueComments!("123?evil=1");

      const lastCall = mockFetch.mock.calls[mockFetch.mock.calls.length - 1];
      const calledUrl = lastCall[0] as string;
      expect(calledUrl).toContain(
        "/_apis/wit/workitems/123%3Fevil%3D1/comments"
      );
    });
  });

  describe("searchIssues", () => {
    beforeEach(async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ value: [] }),
      });
      await adapter.authenticate({ type: "api_key", apiKey: "test-token" });
    });

    it("should search with WIQL query", async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: () =>
            Promise.resolve({
              workItems: [{ id: 123 }, { id: 456 }],
            }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () =>
            Promise.resolve({
              value: [mockWorkItem, { ...mockWorkItem, id: 456 }],
            }),
        });

      const result = await adapter.searchIssues({
        query: "test bug",
      });

      // Verify WIQL query was made
      const wiqlCall = mockFetch.mock.calls[1];
      expect(wiqlCall[0]).toContain("/_apis/wit/wiql");
      expect(wiqlCall[1].method).toBe("POST");

      const body = JSON.parse(wiqlCall[1].body);
      expect(body.query).toContain("CONTAINS 'test bug'");

      expect(result.issues).toHaveLength(2);
      expect(result.total).toBe(2);
    });

    it("should filter by project", async () => {
      // Reset mock to clear calls from beforeEach
      mockFetch.mockReset();

      // Create adapter without a default project to test projectId option
      const adapterWithoutProject = new AzureDevOpsAdapter({
        provider: "AZURE_DEVOPS",
        organizationUrl: "https://dev.azure.com/testorg",
      });

      // Authenticate first
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ value: [] }),
      });

      await adapterWithoutProject.authenticate({
        type: "api_key",
        apiKey: "test-pat-token",
      });

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ workItems: [] }),
      });

      await adapterWithoutProject.searchIssues({
        projectId: "MyProject",
      });

      // Find the WIQL call (second call: index 0 = auth, index 1 = WIQL)
      const wiqlCall = mockFetch.mock.calls[1];
      const body = JSON.parse(wiqlCall[1].body);
      expect(body.query).toContain("[System.TeamProject] = 'MyProject'");
    });

    it("should filter by status", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ workItems: [] }),
      });

      await adapter.searchIssues({
        status: ["Active", "Resolved"],
      });

      const wiqlCall = mockFetch.mock.calls[1];
      const body = JSON.parse(wiqlCall[1].body);
      expect(body.query).toContain("[System.State] = 'Active'");
      expect(body.query).toContain("[System.State] = 'Resolved'");
    });

    it("should filter by assignee", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ workItems: [] }),
      });

      await adapter.searchIssues({
        assignee: "user@example.com",
      });

      const wiqlCall = mockFetch.mock.calls[1];
      const body = JSON.parse(wiqlCall[1].body);
      expect(body.query).toContain("[System.AssignedTo] = 'user@example.com'");
    });

    it("should filter by labels/tags", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ workItems: [] }),
      });

      await adapter.searchIssues({
        labels: ["bug", "critical"],
      });

      const wiqlCall = mockFetch.mock.calls[1];
      const body = JSON.parse(wiqlCall[1].body);
      expect(body.query).toContain("[System.Tags] CONTAINS 'bug'");
      expect(body.query).toContain("[System.Tags] CONTAINS 'critical'");
    });

    it("should scope by recency window (updatedWithinDays)", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ workItems: [] }),
      });

      await adapter.searchIssues({
        updatedWithinDays: 180,
      });

      const wiqlCall = mockFetch.mock.calls[1];
      const body = JSON.parse(wiqlCall[1].body);
      expect(body.query).toContain("[System.ChangedDate] >= @Today - 180");
    });

    it("should handle pagination", async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: () =>
            Promise.resolve({
              workItems: [
                { id: 1 },
                { id: 2 },
                { id: 3 },
                { id: 4 },
                { id: 5 },
              ],
            }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () =>
            Promise.resolve({
              value: [
                { ...mockWorkItem, id: 3 },
                { ...mockWorkItem, id: 4 },
              ],
            }),
        });

      const result = await adapter.searchIssues({
        limit: 2,
        offset: 2,
      });

      // Should only request items 3 and 4 (offset 2, limit 2)
      const getItemsCall = mockFetch.mock.calls[2];
      expect(getItemsCall[0]).toContain("ids=3,4");

      expect(result.hasMore).toBe(true);
      expect(result.total).toBe(5);
    });

    it("should return empty results when no items found", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ workItems: [] }),
      });

      const result = await adapter.searchIssues({});

      expect(result.issues).toEqual([]);
      expect(result.total).toBe(0);
      expect(result.hasMore).toBe(false);
    });

    it("should use [System.Id] = N when query is a numeric ID", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ workItems: [] }),
      });

      await adapter.searchIssues({ query: "123" });

      const wiqlCall = mockFetch.mock.calls[1];
      const body = JSON.parse(wiqlCall[1].body);
      expect(body.query).toContain("[System.Id] = 123");
      expect(body.query).not.toContain("CONTAINS");
    });

    it("should use CONTAINS for non-numeric text queries", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ workItems: [] }),
      });

      await adapter.searchIssues({ query: "login bug" });

      const wiqlCall = mockFetch.mock.calls[1];
      const body = JSON.parse(wiqlCall[1].body);
      expect(body.query).toContain("CONTAINS 'login bug'");
      // [System.Id] = N should NOT appear in the WHERE conditions
      expect(body.query).not.toMatch(/\[System\.Id\]\s*=\s*\d/);
    });

    it("should use CONTAINS for alphanumeric queries that are not pure numeric", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ workItems: [] }),
      });

      await adapter.searchIssues({ query: "AB-123" });

      const wiqlCall = mockFetch.mock.calls[1];
      const body = JSON.parse(wiqlCall[1].body);
      expect(body.query).toContain("CONTAINS 'AB-123'");
    });
  });

  describe("getProjects", () => {
    beforeEach(async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ value: [] }),
      });
      await adapter.authenticate({ type: "api_key", apiKey: "test-token" });
    });

    it("should return available projects", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            value: [
              { id: "proj-1", name: "Project One" },
              { id: "proj-2", name: "Project Two" },
            ],
          }),
      });

      const result = await adapter.getProjects();

      expect(result).toEqual([
        { id: "proj-1", key: "Project One", name: "Project One" },
        { id: "proj-2", key: "Project Two", name: "Project Two" },
      ]);
    });
  });

  describe("getIssueTypes", () => {
    beforeEach(async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ value: [] }),
      });
      await adapter.authenticate({ type: "api_key", apiKey: "test-token" });
    });

    it("should return work item types for project", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            value: [{ name: "Bug" }, { name: "Task" }, { name: "User Story" }],
          }),
      });

      const result = await adapter.getIssueTypes("TestProject");

      expect(result).toEqual([
        { id: "Bug", name: "Bug" },
        { id: "Task", name: "Task" },
        { id: "User Story", name: "User Story" },
      ]);
    });

    it("should throw error when project not specified", async () => {
      const adapterNoProject = new AzureDevOpsAdapter({
        provider: "AZURE_DEVOPS",
        organizationUrl: "https://dev.azure.com/testorg",
      });

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ value: [] }),
      });
      await adapterNoProject.authenticate({
        type: "api_key",
        apiKey: "test-token",
      });

      await expect(adapterNoProject.getIssueTypes("")).rejects.toThrow(
        "Project not specified"
      );
    });
  });

  describe("getStatuses", () => {
    it("should return common Azure DevOps states", async () => {
      const result = await adapter.getStatuses();

      expect(result).toEqual([
        { id: "New", name: "New" },
        { id: "Active", name: "Active" },
        { id: "Resolved", name: "Resolved" },
        { id: "Closed", name: "Closed" },
        { id: "Removed", name: "Removed" },
      ]);
    });
  });

  describe("getPriorities", () => {
    it("should return Azure DevOps priorities", async () => {
      const result = await adapter.getPriorities();

      expect(result).toEqual([
        { id: "1", name: "1 - Critical" },
        { id: "2", name: "2 - High" },
        { id: "3", name: "3 - Medium" },
        { id: "4", name: "4 - Low" },
      ]);
    });
  });

  describe("uploadAttachment", () => {
    beforeEach(async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ value: [] }),
      });
      await adapter.authenticate({ type: "api_key", apiKey: "test-token" });
    });

    it("should upload attachment and link to work item", async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: () =>
            Promise.resolve({
              id: "attachment-123",
              url: "https://dev.azure.com/testorg/_apis/wit/attachments/attachment-123",
            }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({}),
        });

      const fileBuffer = Buffer.from("test file content");
      const result = await adapter.uploadAttachment(
        "123",
        fileBuffer,
        "test.txt"
      );

      // Verify upload call
      const uploadCall = mockFetch.mock.calls[1];
      expect(uploadCall[0]).toContain("/_apis/wit/attachments");
      expect(uploadCall[0]).toContain("fileName=test.txt");
      expect(uploadCall[1].headers["Content-Type"]).toBe(
        "application/octet-stream"
      );

      // Verify link call
      const linkCall = mockFetch.mock.calls[2];
      const body = JSON.parse(linkCall[1].body);
      expect(body).toContainEqual({
        op: "add",
        path: "/relations/-",
        value: {
          rel: "AttachedFile",
          url: "https://dev.azure.com/testorg/_apis/wit/attachments/attachment-123",
        },
      });

      expect(result.id).toBe("attachment-123");
    });
  });

  describe("linkToTestCase", () => {
    beforeEach(async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ value: [] }),
      });
      await adapter.authenticate({ type: "api_key", apiKey: "test-token" });
    });

    it("should add comment linking to test case", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ id: 1 }),
      });

      await adapter.linkToTestCase("123", "TC-001");

      const commentCall = mockFetch.mock.calls[1];
      expect(commentCall[0]).toContain("/_apis/wit/workitems/123/comments");

      const body = JSON.parse(commentCall[1].body);
      expect(body.text).toContain("Linked to test case: TC-001");
    });

    it("should include metadata in comment", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ id: 1 }),
      });

      await adapter.linkToTestCase("123", "TC-001", { testRun: "TR-100" });

      const commentCall = mockFetch.mock.calls[1];
      const body = JSON.parse(commentCall[1].body);
      expect(body.text).toContain("Metadata:");
      expect(body.text).toContain("TR-100");
    });
  });

  describe("syncIssue", () => {
    beforeEach(async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ value: [] }),
      });
      await adapter.authenticate({ type: "api_key", apiKey: "test-token" });
    });

    it("should fetch and return work item", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockWorkItem),
      });

      const result = await adapter.syncIssue("123");

      expect(result.id).toBe("123");
      expect(result.title).toBe("Test Work Item");
    });
  });
});
