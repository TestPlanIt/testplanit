import { NextRequest, NextResponse } from "next/server";
import { z } from "zod/v4";
import { authorizeProjectApiRequest } from "~/lib/api/authorizeProjectApiRequest";
import { withAuditContext } from "~/lib/auditContextWrappers";
import { baseDb } from "~/lib/db";
import { loadTemplateData } from "~/lib/services/jira-panel-generation";
import {
  IssueKeyResolutionError,
  resolveIssueKeys,
  type IssueKeyResolution,
} from "~/lib/services/resolveIssueKeys";
import {
  persistGeneratedTestCases,
  type ImportCaseResult,
  type ImportInput,
} from "~/lib/services/testCaseImport";

// Bulk case-creation endpoint reached by the MCP `testplanit_cases_create_many`
// tool (and any other programmatic caller). It resolves the shared context
// (repository / template / fieldMappings) once, groups the incoming cases by
// their effective (folder, state), and hands each group to the SAME
// transactional importer the in-app generation wizard and Jira panel use
// (persistGeneratedTestCases). That importer creates each case + its steps /
// tags / custom-field values in one transaction and — because it runs against
// the hooked `lib/db` client — drives Elasticsearch sync and per-case audit
// via the existing `$extends` hooks. This route therefore adds no ES/audit of
// its own; doing so would double-count.

const stepSchema = z.object({
  text: z.string().optional(),
  expectedResult: z.string().optional(),
  order: z.number().int().nonnegative().optional(),
});

const caseSchema = z.object({
  name: z.string().min(1).max(2000),
  // Per-case overrides. When omitted the batch-level values are used; cases
  // are grouped by the resolved (folderId, stateName) so each distinct group
  // becomes one importer transaction (a single folder/state — the common
  // case — is exactly one transaction).
  folderId: z.number().int().positive().optional(),
  stateName: z.string().min(1).optional(),
  steps: z.array(stepSchema).optional(),
  tags: z
    .array(z.union([z.number().int().positive(), z.string().min(1)]))
    .optional(),
  customFields: z.record(z.string(), z.any()).optional(),
  // Tracker issue keys ("PROJ-123") to attach to this case. Resolved
  // server-side against the project's issue-tracker integration, creating the
  // local Issue row when the key has never been seen here — so a script or an
  // agent no longer needs a human to open the ticket in the UI first. A key
  // that can't be resolved fails its own case, never the batch.
  issues: z.array(z.string().min(1).max(255)).max(50).optional(),
});

const bulkCreateSchema = z.object({
  // Integration to resolve `issues` keys against. Optional — the project's
  // single active issue-tracker integration is used when it is unambiguous.
  integrationId: z.number().int().positive().optional(),
  // Batch-level template (optional — defaults to the project's first enabled
  // template, matching the single-create tool).
  templateId: z.number().int().positive().optional(),
  // Batch-level default folder + state. Each case may override either.
  folderId: z.number().int().positive(),
  stateName: z.string().min(1).optional(),
  cases: z.array(caseSchema).min(1).max(200),
});

type BulkCreateRequest = z.infer<typeof bulkCreateSchema>;
type IndexedCase = BulkCreateRequest["cases"][number] & { __id: string };

export const POST = withAuditContext(
  async (
    request: NextRequest,
    { params }: { params: Promise<{ projectId: string }> }
  ) => {
    try {
      const { projectId: projectIdParam } = await params;
      const projectId = parseInt(projectIdParam);
      if (isNaN(projectId)) {
        return NextResponse.json(
          { error: "Invalid project ID" },
          { status: 400 }
        );
      }

      // ── Authentication + project access ───────────────────────────────────
      const auth = await authorizeProjectApiRequest(request, projectId);
      if (!auth.ok) {
        return NextResponse.json(auth.body, { status: auth.status });
      }
      const { userId, userName } = auth.actor;
      const project = auth.project;

      // ── Parse + validate body ─────────────────────────────────────────────
      const body = await request.json();
      const data: BulkCreateRequest = bulkCreateSchema.parse(body);

      // ── Resolve template once ─────────────────────────────────────────────
      let templateId = data.templateId;
      if (templateId != null) {
        const assigned = await baseDb.templates.findFirst({
          where: {
            id: templateId,
            isDeleted: false,
            isEnabled: true,
            projects: { some: { projectId } },
          },
          select: { id: true },
        });
        if (!assigned) {
          return NextResponse.json(
            {
              error: `Template ${templateId} is not an enabled template assigned to project ${projectId}.`,
            },
            { status: 400 }
          );
        }
      } else {
        const def = await baseDb.templates.findFirst({
          where: {
            isDeleted: false,
            isEnabled: true,
            projects: { some: { projectId } },
          },
          orderBy: { id: "asc" },
          select: { id: true },
        });
        if (!def) {
          return NextResponse.json(
            {
              error: `No enabled template assigned to project ${projectId}. Assign a template to the project first.`,
            },
            { status: 422 }
          );
        }
        templateId = def.id;
      }

      const loaded = await loadTemplateData(templateId);
      if (!loaded) {
        return NextResponse.json(
          { error: `Template ${templateId} not found.` },
          { status: 400 }
        );
      }
      const templateName = loaded.template.name;
      const fieldMappings = loaded.fieldMappings;
      // Custom fields the agent may set: every mapped (non-Steps) field name.
      const validFieldNames = new Set(fieldMappings.map((m) => m.fieldName));

      // ── Index cases + validate custom fields against the template ─────────
      const indexed: IndexedCase[] = data.cases.map((c, i) => ({
        ...c,
        __id: String(i),
      }));
      const resultsById = new Map<string, ImportCaseResult>();
      const valid: IndexedCase[] = [];
      for (const c of indexed) {
        const unknownFields = Object.keys(c.customFields ?? {}).filter(
          (k) => !validFieldNames.has(k)
        );
        if (unknownFields.length > 0) {
          resultsById.set(c.__id, {
            id: c.__id,
            name: c.name,
            status: "error",
            error: `Custom field(s) not part of template "${templateName}": ${unknownFields.join(", ")}.`,
          });
        } else {
          valid.push(c);
        }
      }

      // ── Pre-resolve all string tags to ids once (mixed ids+names per case
      // are supported by collapsing everything to numeric ids before import).
      const tagNameToId = new Map<string, number>();
      const allTagNames = new Set<string>();
      for (const c of valid) {
        for (const t of c.tags ?? []) {
          if (typeof t === "string") allTagNames.add(t.trim());
        }
      }
      for (const name of allTagNames) {
        if (!name) continue;
        const tag = await baseDb.tags.upsert({
          where: { name },
          create: { name, isDeleted: false },
          update: {},
          select: { id: true },
        });
        tagNameToId.set(name, tag.id);
      }

      // ── Pre-resolve all issue keys to ids once ───────────────────────────
      // Deduplicated across the batch, so fifty cases citing one ticket cost
      // one tracker lookup. A key that fails resolution takes only the cases
      // that cite it out of the batch — the rest still import.
      const issueKeyResults = new Map<string, IssueKeyResolution>();
      const allIssueKeys = valid.flatMap((c) => c.issues ?? []);
      if (allIssueKeys.length > 0) {
        try {
          const resolvedKeys = await resolveIssueKeys({
            projectId,
            keys: allIssueKeys,
            integrationId: data.integrationId,
          });
          for (const [key, resolution] of resolvedKeys) {
            issueKeyResults.set(key, resolution);
          }
        } catch (error) {
          // Integration-level failures (none configured, or ambiguous) doom
          // every key, so report them once per citing case rather than
          // failing cases that named no issue at all.
          const message =
            error instanceof IssueKeyResolutionError
              ? error.message
              : "Failed to resolve issue keys.";
          for (const key of allIssueKeys) {
            issueKeyResults.set(key, { key, error: message });
          }
        }
      }

      const withResolvableIssues: IndexedCase[] = [];
      const issueIdsByCase = new Map<string, number[]>();
      for (const c of valid) {
        const keys = c.issues ?? [];
        const failures: string[] = [];
        const issueIds: number[] = [];
        for (const key of keys) {
          const resolution = issueKeyResults.get(key);
          if (resolution?.issueId != null) {
            issueIds.push(resolution.issueId);
          } else {
            failures.push(
              `${key}: ${resolution?.error ?? "could not be resolved."}`
            );
          }
        }
        if (failures.length > 0) {
          resultsById.set(c.__id, {
            id: c.__id,
            name: c.name,
            status: "error",
            error: `Issue key(s) could not be linked — ${failures.join("; ")}`,
          });
          continue;
        }
        if (issueIds.length > 0) {
          issueIdsByCase.set(c.__id, [...new Set(issueIds)]);
        }
        withResolvableIssues.push(c);
      }

      // ── Group valid cases by effective (folderId, stateName) ──────────────
      const groups = new Map<string, IndexedCase[]>();
      for (const c of withResolvableIssues) {
        const folderId = c.folderId ?? data.folderId;
        const stateName = c.stateName ?? data.stateName ?? "";
        const key = `${folderId}::${stateName}`;
        const arr = groups.get(key) ?? [];
        arr.push(c);
        groups.set(key, arr);
      }

      for (const groupCases of groups.values()) {
        const first = groupCases[0];
        const folderId = first.folderId ?? data.folderId;
        const stateName = first.stateName ?? data.stateName;

        const failGroup = (error: string) => {
          for (const c of groupCases) {
            resultsById.set(c.__id, {
              id: c.__id,
              name: c.name,
              status: "error",
              error,
            });
          }
        };

        // Folder: must belong to this project (carries its own repositoryId).
        const folder = await baseDb.repositoryFolders.findFirst({
          where: { id: folderId, projectId, isDeleted: false },
          select: { id: true, name: true, repositoryId: true },
        });
        if (!folder) {
          failGroup(`Folder ${folderId} not found in project ${projectId}.`);
          continue;
        }

        // CASES-scope workflow state: named one, else first by order.
        const state = await baseDb.workflows.findFirst({
          where: {
            projects: { some: { projectId } },
            isEnabled: true,
            isDeleted: false,
            scope: "CASES",
            ...(stateName ? { name: stateName } : {}),
          },
          orderBy: { order: "asc" },
          select: { id: true, name: true },
        });
        if (!state) {
          failGroup(
            stateName
              ? `No CASES-scope workflow state named "${stateName}" for project ${projectId}.`
              : `No CASES-scope workflow state found for project ${projectId}.`
          );
          continue;
        }

        const maxOrderRow = await baseDb.repositoryCases.findFirst({
          where: {
            projectId,
            folderId: folder.id,
            isDeleted: false,
            isArchived: false,
          },
          orderBy: { order: "desc" },
          select: { order: true },
        });

        const importCases: ImportInput["testCases"] = groupCases.map((c) => {
          const tagIds: number[] = [];
          for (const t of c.tags ?? []) {
            if (typeof t === "number") {
              tagIds.push(t);
            } else {
              const id = tagNameToId.get(t.trim());
              if (id != null) tagIds.push(id);
            }
          }
          const steps = c.steps?.map((s) => ({
            step: s.text,
            expectedResult: s.expectedResult,
          }));
          const issueIds = issueIdsByCase.get(c.__id);
          return {
            id: c.__id,
            name: c.name,
            fieldValues: c.customFields ?? {},
            ...(tagIds.length > 0 ? { tagIds } : {}),
            ...(steps ? { steps } : {}),
            ...(issueIds?.length ? { issueIds } : {}),
          };
        });

        const importInput: ImportInput = {
          projectId,
          projectName: project.name,
          repositoryId: folder.repositoryId,
          folderId: folder.id,
          folderName: folder.name,
          templateId,
          templateName,
          stateId: state.id,
          stateName: state.name,
          maxOrder: maxOrderRow?.order ?? 0,
          autoGenerateTags: false,
          testCases: importCases,
          fieldMappings,
          source: "MANUAL",
        };

        const res = await persistGeneratedTestCases(importInput, {
          userId,
          userName: userName || "Unknown User",
        });

        if (res.status === "error") {
          // A top-level transaction failure rolls back the whole group, so even
          // cases the importer's per-case loop marked "success" never landed.
          failGroup(res.message ?? "Bulk create transaction failed.");
          continue;
        }

        for (const r of res.results) {
          resultsById.set(r.id, r);
        }
        // Safety net: any case the importer didn't report on.
        for (const c of groupCases) {
          if (!resultsById.has(c.__id)) {
            resultsById.set(c.__id, {
              id: c.__id,
              name: c.name,
              status: "error",
              error: "Case was not processed by the importer.",
            });
          }
        }
      }

      const results = indexed.map(
        (c) =>
          resultsById.get(c.__id) ?? {
            id: c.__id,
            name: c.name,
            status: "error" as const,
            error: "Case was not processed.",
          }
      );
      const importedCount = results.filter(
        (r) => r.status === "success"
      ).length;

      return NextResponse.json({
        success: true,
        importedCount,
        failedCount: results.length - importedCount,
        results,
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return NextResponse.json(
          { error: "Invalid request data", details: error.issues },
          { status: 400 }
        );
      }
      console.error("Error performing bulk create:", error);
      return NextResponse.json(
        { error: "Failed to perform bulk create" },
        { status: 500 }
      );
    }
  }
);
