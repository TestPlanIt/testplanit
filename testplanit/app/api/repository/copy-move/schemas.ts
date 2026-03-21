import { z } from "zod";

export const preflightSchema = z.object({
  operation: z.enum(["copy", "move"]),
  caseIds: z.array(z.number().int().positive()).min(1).max(500),
  sourceProjectId: z.number().int().positive(),
  targetProjectId: z.number().int().positive(),
});

export const submitSchema = z.object({
  operation: z.enum(["copy", "move"]),
  caseIds: z.array(z.number().int().positive()).min(1).max(500),
  sourceProjectId: z.number().int().positive(),
  targetProjectId: z.number().int().positive(),
  targetFolderId: z.number().int().positive(),
  conflictResolution: z.enum(["skip", "rename"]),
  sharedStepGroupResolution: z.enum(["reuse", "create_new"]),
  autoAssignTemplates: z.boolean().optional().default(false),
  targetRepositoryId: z.number().int().positive().optional(),
  targetDefaultWorkflowStateId: z.number().int().positive().optional(),
  targetTemplateId: z.number().int().positive().optional(),
  folderTree: z.array(z.object({
    localKey: z.string(),
    sourceFolderId: z.number().int().positive(),
    name: z.string().min(1),
    parentLocalKey: z.string().nullable(),
    caseIds: z.array(z.number().int().positive()),
  })).optional(),
});

export interface PreflightResponse {
  hasSourceReadAccess: boolean;
  hasTargetWriteAccess: boolean;
  hasSourceUpdateAccess: boolean;
  templateMismatch: boolean;
  missingTemplates: Array<{ id: number; name: string }>;
  canAutoAssignTemplates: boolean;
  workflowMappings: Array<{
    sourceStateId: number;
    sourceStateName: string;
    targetStateId: number;
    targetStateName: string;
    isDefaultFallback: boolean;
  }>;
  unmappedStates: Array<{ id: number; name: string }>;
  collisions: Array<{
    caseId: number;
    caseName: string;
    className: string | null;
    source: string;
  }>;
  targetRepositoryId: number;
  targetDefaultWorkflowStateId: number;
  targetTemplateId: number;
}
