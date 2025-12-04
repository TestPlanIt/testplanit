import { Prisma } from "@prisma/client";
import { syncRepositoryCaseToElasticsearch } from "../services/repositoryCaseSync";
import { syncTestRunToElasticsearch } from "../services/testRunSearch";
import { syncSessionToElasticsearch } from "../services/sessionSearch";
import { syncSharedStepToElasticsearch } from "../services/sharedStepSearch";
import { syncIssueToElasticsearch } from "../services/issueSearch";
import { syncMilestoneToElasticsearch, syncChildMilestonesToElasticsearch } from "../services/milestoneSearch";
import { syncProjectToElasticsearch } from "../services/projectSearch";
import { encrypt } from "@/utils/encryption";

/**
 * Prisma middleware to sync repository cases with Elasticsearch
 */
export function elasticsearchSyncMiddleware() {
  return async (params: any, next: any) => {
    // Handle RepositoryCases operations
    if (params.model === "RepositoryCases") {
      const result = await next(params);

      // After successful create or update, sync to Elasticsearch
      if (params.action === "create" || params.action === "update" || params.action === "upsert") {
        const caseId = result?.id;
        if (caseId) {
          // Run sync asynchronously to avoid blocking the response
          syncRepositoryCaseToElasticsearch(caseId).catch((error: any) => {
            console.error(`Failed to sync repository case ${caseId} to Elasticsearch:`, error);
          });
        }
      }

      // After successful delete, sync to Elasticsearch (sync function will handle removal)
      if (params.action === "delete") {
        const caseId = result?.id;
        if (caseId) {
          // Run sync asynchronously - sync function will determine if item should be removed
          syncRepositoryCaseToElasticsearch(caseId).catch((error: any) => {
            console.error(`Failed to sync repository case ${caseId} to Elasticsearch after delete:`, error);
          });
        }
      }

      // Handle bulk operations
      // Note: For createMany/updateMany/deleteMany, manual sync may be required
      // as Prisma doesn't return individual records for bulk operations

      return result;
    }

    // Handle Steps operations (in case steps are updated separately)
    if (params.model === "Steps") {
      const result = await next(params);

      if (params.action === "create" || params.action === "update" || params.action === "delete") {
        const testCaseId = params.args?.where?.testCaseId || result?.testCaseId;
        if (testCaseId) {
          // Sync the parent test case when steps change
          syncRepositoryCaseToElasticsearch(testCaseId).catch((error: any) => {
            console.error(`Failed to sync repository case ${testCaseId} after step change:`, error);
          });
        }
      }

      return result;
    }

    // Handle Tags operations (when tags are added/removed from entities)
    if (params.model === "Tags" && params.action === "update") {
      const result = await next(params);
      
      // If tags are connected/disconnected from repository cases, sync those cases
      const connectCases = params.args?.data?.repositoryCases?.connect;
      const disconnectCases = params.args?.data?.repositoryCases?.disconnect;
      
      if (connectCases || disconnectCases) {
        const caseIds: number[] = [];
        
        if (Array.isArray(connectCases)) {
          caseIds.push(...connectCases.map((c: any) => c.id).filter(Boolean));
        } else if (connectCases?.id) {
          caseIds.push(connectCases.id);
        }
        
        if (Array.isArray(disconnectCases)) {
          caseIds.push(...disconnectCases.map((c: any) => c.id).filter(Boolean));
        } else if (disconnectCases?.id) {
          caseIds.push(disconnectCases.id);
        }
        
        // Sync affected cases asynchronously
        caseIds.forEach((caseId) => {
          syncRepositoryCaseToElasticsearch(caseId).catch((error) => {
            console.error(`Failed to sync repository case ${caseId} after tag change:`, error);
          });
        });
      }

      // If tags are connected/disconnected from test runs, sync those test runs
      const connectTestRuns = params.args?.data?.testRuns?.connect;
      const disconnectTestRuns = params.args?.data?.testRuns?.disconnect;
      
      if (connectTestRuns || disconnectTestRuns) {
        const testRunIds: number[] = [];
        
        if (Array.isArray(connectTestRuns)) {
          testRunIds.push(...connectTestRuns.map((tr: any) => tr.id).filter(Boolean));
        } else if (connectTestRuns?.id) {
          testRunIds.push(connectTestRuns.id);
        }
        
        if (Array.isArray(disconnectTestRuns)) {
          testRunIds.push(...disconnectTestRuns.map((tr: any) => tr.id).filter(Boolean));
        } else if (disconnectTestRuns?.id) {
          testRunIds.push(disconnectTestRuns.id);
        }
        
        // Sync affected test runs asynchronously
        testRunIds.forEach((testRunId) => {
          syncTestRunToElasticsearch(testRunId).catch((error) => {
            console.error(`Failed to sync test run ${testRunId} after tag change:`, error);
          });
        });
      }

      // If tags are connected/disconnected from sessions, sync those sessions
      const connectSessions = params.args?.data?.sessions?.connect;
      const disconnectSessions = params.args?.data?.sessions?.disconnect;
      
      if (connectSessions || disconnectSessions) {
        const sessionIds: number[] = [];
        
        if (Array.isArray(connectSessions)) {
          sessionIds.push(...connectSessions.map((s: any) => s.id).filter(Boolean));
        } else if (connectSessions?.id) {
          sessionIds.push(connectSessions.id);
        }
        
        if (Array.isArray(disconnectSessions)) {
          sessionIds.push(...disconnectSessions.map((s: any) => s.id).filter(Boolean));
        } else if (disconnectSessions?.id) {
          sessionIds.push(disconnectSessions.id);
        }
        
        // Sync affected sessions asynchronously
        sessionIds.forEach((sessionId) => {
          syncSessionToElasticsearch(sessionId).catch((error) => {
            console.error(`Failed to sync session ${sessionId} after tag change:`, error);
          });
        });
      }
      
      return result;
    }

    // Handle CaseFieldValues operations (custom field updates)
    if (params.model === "CaseFieldValues") {
      const result = await next(params);

      if (params.action === "create" || params.action === "update" || params.action === "delete") {
        const caseId = params.args?.where?.caseId || result?.caseId;
        if (caseId) {
          // Sync the parent test case when custom fields change
          syncRepositoryCaseToElasticsearch(caseId).catch((error) => {
            console.error(`Failed to sync repository case ${caseId} after custom field change:`, error);
          });
        }
      }

      return result;
    }

    // Handle TestRuns operations
    if (params.model === "TestRuns") {
      const result = await next(params);

      if (params.action === "create" || params.action === "update" || params.action === "upsert") {
        const testRunId = result?.id;
        if (testRunId) {
          syncTestRunToElasticsearch(testRunId).catch((error: any) => {
            console.error(`Failed to sync test run ${testRunId} to Elasticsearch:`, error);
          });
        }
      }

      if (params.action === "delete") {
        const testRunId = result?.id;
        if (testRunId) {
          syncTestRunToElasticsearch(testRunId).catch((error: any) => {
            console.error(`Failed to sync test run ${testRunId} to Elasticsearch:`, error);
          });
        }
      }

      return result;
    }

    // Handle Sessions operations
    if (params.model === "Sessions") {
      const result = await next(params);

      if (params.action === "create" || params.action === "update" || params.action === "upsert") {
        const sessionId = result?.id;
        if (sessionId) {
          syncSessionToElasticsearch(sessionId).catch((error: any) => {
            console.error(`Failed to sync session ${sessionId} to Elasticsearch:`, error);
          });
        }
      }

      if (params.action === "delete") {
        const sessionId = result?.id;
        if (sessionId) {
          syncSessionToElasticsearch(sessionId).catch((error: any) => {
            console.error(`Failed to sync session ${sessionId} to Elasticsearch:`, error);
          });
        }
      }

      return result;
    }

    // Handle SharedStepGroup operations
    if (params.model === "SharedStepGroup") {
      const result = await next(params);

      if (params.action === "create" || params.action === "update" || params.action === "upsert") {
        const stepGroupId = result?.id;
        if (stepGroupId) {
          syncSharedStepToElasticsearch(stepGroupId).catch((error: any) => {
            console.error(`Failed to sync shared step ${stepGroupId} to Elasticsearch:`, error);
          });
        }
      }

      if (params.action === "delete") {
        const stepGroupId = result?.id;
        if (stepGroupId) {
          syncSharedStepToElasticsearch(stepGroupId).catch((error: any) => {
            console.error(`Failed to sync shared step ${stepGroupId} to Elasticsearch:`, error);
          });
        }
      }

      return result;
    }

    // Handle SharedStepItem operations (sync parent shared step group)
    if (params.model === "SharedStepItem") {
      const result = await next(params);

      if (params.action === "create" || params.action === "update" || params.action === "delete") {
        const stepGroupId = params.args?.where?.sharedStepGroupId || result?.sharedStepGroupId;
        if (stepGroupId) {
          syncSharedStepToElasticsearch(stepGroupId).catch((error: any) => {
            console.error(`Failed to sync shared step ${stepGroupId} after item change:`, error);
          });
        }
      }

      return result;
    }

    // Handle Issues operations
    if (params.model === "Issue") {
      const result = await next(params);

      if (params.action === "create" || params.action === "update" || params.action === "upsert") {
        const issueId = result?.id;
        if (issueId) {
          syncIssueToElasticsearch(issueId).catch((error: any) => {
            console.error(`Failed to sync issue ${issueId} to Elasticsearch:`, error);
          });
        }
      }

      if (params.action === "delete") {
        const issueId = result?.id;
        if (issueId) {
          syncIssueToElasticsearch(issueId).catch((error: any) => {
            console.error(`Failed to sync issue ${issueId} to Elasticsearch:`, error);
          });
        }
      }

      return result;
    }

    // Handle Milestones operations
    if (params.model === "Milestones") {
      const result = await next(params);

      if (params.action === "create" || params.action === "update" || params.action === "upsert") {
        const milestoneId = result?.id;
        if (milestoneId) {
          syncMilestoneToElasticsearch(milestoneId).catch((error: any) => {
            console.error(`Failed to sync milestone ${milestoneId} to Elasticsearch:`, error);
          });
          
          // If parent name changed, sync children
          if (params.action === "update" && params.args?.data?.name) {
            syncChildMilestonesToElasticsearch(milestoneId).catch((error: any) => {
              console.error(`Failed to sync child milestones of ${milestoneId}:`, error);
            });
          }
        }
      }

      if (params.action === "delete") {
        const milestoneId = result?.id;
        if (milestoneId) {
          syncMilestoneToElasticsearch(milestoneId).catch((error: any) => {
            console.error(`Failed to sync milestone ${milestoneId} to Elasticsearch:`, error);
          });
        }
      }

      return result;
    }

    // Handle Projects operations
    if (params.model === "Projects") {
      const result = await next(params);

      if (params.action === "create" || params.action === "update" || params.action === "upsert") {
        const projectId = result?.id;
        if (projectId) {
          syncProjectToElasticsearch(projectId).catch((error: any) => {
            console.error(`Failed to sync project ${projectId} to Elasticsearch:`, error);
          });

          // If project name or icon changed, we need to reindex all entities in that project
          if (params.action === "update" && (params.args?.data?.name || params.args?.data?.iconUrl)) {
            reindexProjectEntities(projectId).catch((error: any) => {
              console.error(`Failed to reindex entities for project ${projectId}:`, error);
            });
          }
        }
      }

      if (params.action === "delete") {
        const projectId = result?.id;
        if (projectId) {
          syncProjectToElasticsearch(projectId).catch((error: any) => {
            console.error(`Failed to sync project ${projectId} to Elasticsearch:`, error);
          });
        }
      }

      return result;
    }

    // Handle Workflows (States) operations - reindex entities using that state
    if (params.model === "Workflows") {
      const result = await next(params);

      if (params.action === "update" && (params.args?.data?.name || params.args?.data?.icon || params.args?.data?.color)) {
        const workflowId = result?.id || params.args?.where?.id;
        if (workflowId) {
          reindexEntitiesWithWorkflow(workflowId).catch((error: any) => {
            console.error(`Failed to reindex entities with workflow ${workflowId}:`, error);
          });
        }
      }

      return result;
    }

    // Handle Configurations operations - reindex test runs and sessions using that config
    if (params.model === "Configurations") {
      const result = await next(params);

      if (params.action === "update" && params.args?.data?.name) {
        const configId = result?.id || params.args?.where?.id;
        if (configId) {
          reindexEntitiesWithConfiguration(configId).catch((error: any) => {
            console.error(`Failed to reindex entities with configuration ${configId}:`, error);
          });
        }
      }

      return result;
    }

    // Handle Templates operations - reindex entities using that template
    if (params.model === "Templates") {
      const result = await next(params);

      if (params.action === "update" && params.args?.data?.templateName) {
        const templateId = result?.id || params.args?.where?.id;
        if (templateId) {
          reindexEntitiesWithTemplate(templateId).catch((error: any) => {
            console.error(`Failed to reindex entities with template ${templateId}:`, error);
          });
        }
      }

      return result;
    }

    // Handle MilestoneTypes operations - reindex milestones of that type
    if (params.model === "MilestoneTypes") {
      const result = await next(params);

      if (params.action === "update" && (params.args?.data?.name || params.args?.data?.icon)) {
        const typeId = result?.id || params.args?.where?.id;
        if (typeId) {
          reindexMilestonesWithType(typeId).catch((error: any) => {
            console.error(`Failed to reindex milestones with type ${typeId}:`, error);
          });
        }
      }

      return result;
    }

    // Handle User operations - reindex entities created by or assigned to that user
    if (params.model === "User") {
      const result = await next(params);

      // Only reindex when name or image changes affect searchable entity data
      // Skip reindexing for profile updates that include userPreferences
      const updateData = params.args?.data;
      const isProfileUpdate = updateData?.userPreferences !== undefined;
      const hasSearchableFieldChanges = updateData?.name !== undefined || updateData?.image !== undefined;

      if (params.action === "update" && hasSearchableFieldChanges && !isProfileUpdate) {
        const userId = result?.id || params.args?.where?.id;
        if (userId) {
          reindexEntitiesWithUser(userId).catch((error: any) => {
            console.error(`Failed to reindex entities with user ${userId}:`, error);
          });
        }
      }

      return result;
    }

    // Handle RepositoryFolders operations - reindex cases in that folder
    if (params.model === "RepositoryFolders") {
      const result = await next(params);

      if (params.action === "update" && (params.args?.data?.name || params.args?.data?.fullPath)) {
        const folderId = result?.id || params.args?.where?.id;
        if (folderId) {
          reindexCasesInFolder(folderId).catch((error: any) => {
            console.error(`Failed to reindex cases in folder ${folderId}:`, error);
          });
        }
      }

      return result;
    }

    // For all other models/actions, just proceed normally
    return next(params);
  };
}

/**
 * Reindex all entities in a project when project details change
 */
async function reindexProjectEntities(projectId: number): Promise<void> {
  const { PrismaClient } = await import("@prisma/client");
  const prisma = new PrismaClient();

  try {
    // Get all repository cases in the project and sync them
    const cases = await prisma.repositoryCases.findMany({
      where: { projectId },
      select: { id: true },
    });
    
    for (const caseItem of cases) {
      await syncRepositoryCaseToElasticsearch(caseItem.id).catch(console.error);
    }

    // Get all test runs in the project and sync them
    const testRuns = await prisma.testRuns.findMany({
      where: { projectId },
      select: { id: true },
    });
    
    for (const testRun of testRuns) {
      await syncTestRunToElasticsearch(testRun.id).catch(console.error);
    }

    // Get all sessions in the project and sync them
    const sessions = await prisma.sessions.findMany({
      where: { projectId },
      select: { id: true },
    });
    
    for (const session of sessions) {
      await syncSessionToElasticsearch(session.id).catch(console.error);
    }

    // Get all shared steps in the project and sync them
    const sharedSteps = await prisma.sharedStepGroup.findMany({
      where: { projectId },
      select: { id: true },
    });
    
    for (const step of sharedSteps) {
      await syncSharedStepToElasticsearch(step.id).catch(console.error);
    }

    // Get all issues in the project and sync them (through test runs)
    const issues = await prisma.issue.findMany({
      where: {
        testRuns: {
          some: {
            projectId,
          },
        },
      },
      select: { id: true },
    });
    
    for (const issue of issues) {
      await syncIssueToElasticsearch(issue.id).catch(console.error);
    }

    // Get all milestones in the project and sync them
    const milestones = await prisma.milestones.findMany({
      where: { projectId },
      select: { id: true },
    });
    
    for (const milestone of milestones) {
      await syncMilestoneToElasticsearch(milestone.id).catch(console.error);
    }
  } finally {
    await prisma.$disconnect();
  }
}

/**
 * Reindex all entities that use a specific workflow/state
 */
async function reindexEntitiesWithWorkflow(workflowId: number): Promise<void> {
  const { PrismaClient } = await import("@prisma/client");
  const prisma = new PrismaClient();

  try {
    // Repository cases with this state
    const cases = await prisma.repositoryCases.findMany({
      where: { stateId: workflowId },
      select: { id: true },
    });
    
    for (const caseItem of cases) {
      await syncRepositoryCaseToElasticsearch(caseItem.id).catch(console.error);
    }

    // Test runs with this state
    const testRuns = await prisma.testRuns.findMany({
      where: { stateId: workflowId },
      select: { id: true },
    });
    
    for (const testRun of testRuns) {
      await syncTestRunToElasticsearch(testRun.id).catch(console.error);
    }

    // Sessions with this state
    const sessions = await prisma.sessions.findMany({
      where: { stateId: workflowId },
      select: { id: true },
    });
    
    for (const session of sessions) {
      await syncSessionToElasticsearch(session.id).catch(console.error);
    }
  } finally {
    await prisma.$disconnect();
  }
}

/**
 * Reindex all entities that use a specific configuration
 */
async function reindexEntitiesWithConfiguration(configId: number): Promise<void> {
  const { PrismaClient } = await import("@prisma/client");
  const prisma = new PrismaClient();

  try {
    // Test runs with this configuration
    const testRuns = await prisma.testRuns.findMany({
      where: { configId },
      select: { id: true },
    });
    
    for (const testRun of testRuns) {
      await syncTestRunToElasticsearch(testRun.id).catch(console.error);
    }

    // Sessions with this configuration
    const sessions = await prisma.sessions.findMany({
      where: { configId },
      select: { id: true },
    });
    
    for (const session of sessions) {
      await syncSessionToElasticsearch(session.id).catch(console.error);
    }
  } finally {
    await prisma.$disconnect();
  }
}

/**
 * Reindex all entities that use a specific template
 */
async function reindexEntitiesWithTemplate(templateId: number): Promise<void> {
  const { PrismaClient } = await import("@prisma/client");
  const prisma = new PrismaClient();

  try {
    // Repository cases with this template
    const cases = await prisma.repositoryCases.findMany({
      where: { templateId },
      select: { id: true },
    });
    
    for (const caseItem of cases) {
      await syncRepositoryCaseToElasticsearch(caseItem.id).catch(console.error);
    }

    // Sessions with this template
    const sessions = await prisma.sessions.findMany({
      where: { templateId },
      select: { id: true },
    });
    
    for (const session of sessions) {
      await syncSessionToElasticsearch(session.id).catch(console.error);
    }
  } finally {
    await prisma.$disconnect();
  }
}

/**
 * Reindex all milestones of a specific type
 */
async function reindexMilestonesWithType(typeId: number): Promise<void> {
  const { PrismaClient } = await import("@prisma/client");
  const prisma = new PrismaClient();

  try {
    const milestones = await prisma.milestones.findMany({
      where: { milestoneTypesId: typeId },
      select: { id: true },
    });
    
    for (const milestone of milestones) {
      await syncMilestoneToElasticsearch(milestone.id).catch(console.error);
    }
  } finally {
    await prisma.$disconnect();
  }
}

/**
 * Reindex all entities created by or assigned to a specific user
 */
async function reindexEntitiesWithUser(userId: string): Promise<void> {
  const { PrismaClient } = await import("@prisma/client");
  const prisma = new PrismaClient();

  try {
    // Repository cases created by this user
    const cases = await prisma.repositoryCases.findMany({
      where: { creatorId: userId },
      select: { id: true },
    });
    
    for (const caseItem of cases) {
      await syncRepositoryCaseToElasticsearch(caseItem.id).catch(console.error);
    }

    // Test runs created by this user
    const testRuns = await prisma.testRuns.findMany({
      where: { createdById: userId },
      select: { id: true },
    });
    
    for (const testRun of testRuns) {
      await syncTestRunToElasticsearch(testRun.id).catch(console.error);
    }

    // Sessions created by or assigned to this user
    const sessions = await prisma.sessions.findMany({
      where: {
        OR: [
          { createdById: userId },
          { assignedToId: userId },
        ],
      },
      select: { id: true },
    });
    
    for (const session of sessions) {
      await syncSessionToElasticsearch(session.id).catch(console.error);
    }

    // Shared steps created by this user
    const sharedSteps = await prisma.sharedStepGroup.findMany({
      where: { createdById: userId },
      select: { id: true },
    });
    
    for (const step of sharedSteps) {
      await syncSharedStepToElasticsearch(step.id).catch(console.error);
    }

    // Projects created by this user
    const projects = await prisma.projects.findMany({
      where: { createdBy: userId },
      select: { id: true },
    });
    
    for (const project of projects) {
      await syncProjectToElasticsearch(project.id).catch(console.error);
    }

    // Issues created by this user
    const issues = await prisma.issue.findMany({
      where: { createdById: userId },
      select: { id: true },
    });
    
    for (const issue of issues) {
      await syncIssueToElasticsearch(issue.id).catch(console.error);
    }

    // Milestones created by this user
    const milestones = await prisma.milestones.findMany({
      where: { createdBy: userId },
      select: { id: true },
    });
    
    for (const milestone of milestones) {
      await syncMilestoneToElasticsearch(milestone.id).catch(console.error);
    }
  } finally {
    await prisma.$disconnect();
  }
}

/**
 * Reindex all test cases in a specific folder
 */
async function reindexCasesInFolder(folderId: number): Promise<void> {
  const { PrismaClient } = await import("@prisma/client");
  const prisma = new PrismaClient();

  try {
    const cases = await prisma.repositoryCases.findMany({
      where: { folderId },
      select: { id: true },
    });
    
    for (const caseItem of cases) {
      await syncRepositoryCaseToElasticsearch(caseItem.id).catch(console.error);
    }
  } finally {
    await prisma.$disconnect();
  }
}

/**
 * Prisma middleware to encrypt integration credentials before saving
 */
export function integrationEncryptionMiddleware() {
  return async (params: any, next: any) => {
    // Handle Integration model
    if (params.model === "Integration") {
      // Encrypt credentials on create
      if (params.action === "create" && params.args?.data?.credentials) {
        const credentials = params.args.data.credentials;
        if (typeof credentials === "object" && !("encrypted" in credentials)) {
          // Encrypt the entire credentials object
          const encryptedCredentials = await encrypt(JSON.stringify(credentials));
          params.args.data.credentials = { encrypted: encryptedCredentials };
        }
      }

      // Encrypt credentials on update
      if ((params.action === "update" || params.action === "updateMany") && params.args?.data?.credentials) {
        const credentials = params.args.data.credentials;
        if (typeof credentials === "object" && !("encrypted" in credentials)) {
          // Encrypt the entire credentials object
          const encryptedCredentials = await encrypt(JSON.stringify(credentials));
          params.args.data.credentials = { encrypted: encryptedCredentials };
        }
      }

      // Encrypt credentials on upsert
      if (params.action === "upsert") {
        if (params.args?.create?.credentials) {
          const credentials = params.args.create.credentials;
          if (typeof credentials === "object" && !("encrypted" in credentials)) {
            const encryptedCredentials = await encrypt(JSON.stringify(credentials));
            params.args.create.credentials = { encrypted: encryptedCredentials };
          }
        }
        if (params.args?.update?.credentials) {
          const credentials = params.args.update.credentials;
          if (typeof credentials === "object" && !("encrypted" in credentials)) {
            const encryptedCredentials = await encrypt(JSON.stringify(credentials));
            params.args.update.credentials = { encrypted: encryptedCredentials };
          }
        }
      }
    }

    return next(params);
  };
}