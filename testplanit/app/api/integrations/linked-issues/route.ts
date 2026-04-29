import { getEnhancedDb } from "@/lib/auth/utils";
import { IntegrationManager } from "@/lib/integrations/IntegrationManager";
import type { LinkedIssueRef } from "@/lib/integrations/adapters/IssueAdapter";
import { getServerSession } from "next-auth";
import { NextRequest } from "next/server";
import { authOptions } from "~/server/auth";

export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const projectIdParam = searchParams.get("projectId");
  const issueKey = searchParams.get("issueKey");

  if (!projectIdParam || !/^\d+$/.test(projectIdParam)) {
    return Response.json(
      { error: "Missing or invalid projectId" },
      { status: 400 }
    );
  }
  if (!issueKey) {
    return Response.json({ error: "Missing issueKey" }, { status: 400 });
  }
  if (issueKey.length > 200 || /[?#&\s]/.test(issueKey)) {
    return Response.json({ error: "Invalid issueKey format" }, { status: 400 });
  }
  const projectId = parseInt(projectIdParam, 10);

  const db = await getEnhancedDb(session);

  // ZenStack policy enforcement on getEnhancedDb makes this 404 cover both
  // "project doesn't exist" and "user can't read project" — no info leak.
  const projectIntegration = await db.projectIntegration.findFirst({
    where: { projectId, isActive: true },
  });
  if (!projectIntegration) {
    return Response.json(
      { error: "No active issue integration found for project" },
      { status: 404 }
    );
  }

  const adapter = await IntegrationManager.getInstance().getAdapter(
    String(projectIntegration.integrationId)
  );
  if (!adapter) {
    return Response.json({ error: "Adapter not found" }, { status: 404 });
  }

  let refs: LinkedIssueRef[] = [];
  if (typeof adapter.getLinkedIssues === "function") {
    try {
      refs = await adapter.getLinkedIssues(issueKey);
    } catch (err) {
      console.warn(
        `[linked-issues route] adapter.getLinkedIssues threw for project %s key %s:`,
        projectId,
        issueKey,
        err
      );
      refs = [];
    }
  }

  return Response.json({ refs });
}
