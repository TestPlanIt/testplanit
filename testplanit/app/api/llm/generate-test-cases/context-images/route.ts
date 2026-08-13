import { LLM_FEATURES } from "@/lib/llm/constants";
import { LlmManager } from "@/lib/llm/services/llm-manager.service";
import { PromptResolver } from "@/lib/llm/services/prompt-resolver.service";
import { baseDb } from "@/lib/db";
import { ProjectAccessType } from "~/zenstack/models";
import { getServerSession } from "next-auth";
import { NextRequest, NextResponse } from "next/server";
import { IntegrationManager } from "~/lib/integrations/IntegrationManager";
import { authOptions } from "~/server/auth";
import { MAX_CONTEXT_IMAGES, MAX_IMAGE_BYTES } from "~/lib/llm/context-images";
import { resolveAttachmentImageMime } from "../context-image-sources";

/**
 * List the image attachments of an external issue, for the Generate wizard's
 * context-image picker. Metadata only — bytes are fetched at generation
 * time by the outline route.
 *
 * The tracker read uses the integration's borrowed token (the blessed
 * read-path posture — see IntegrationManager.getAdapter), so TestPlanIt-side
 * authorization is enforced here: the caller must have project access and
 * the integration must belong to that project.
 */
export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = (await request.json()) as {
      projectId?: number;
      integrationId?: number;
      issueKey?: string;
    };
    const { projectId, integrationId, issueKey } = body;

    if (!projectId || !issueKey) {
      return NextResponse.json(
        { error: "Missing required parameters" },
        { status: 400 }
      );
    }

    const isAdmin = session.user.access === "ADMIN";
    const isProjectAdmin = session.user.access === "PROJECTADMIN";

    const projectAccessWhere = isAdmin
      ? { id: projectId, isDeleted: false }
      : {
          id: projectId,
          isDeleted: false,
          OR: [
            {
              userPermissions: {
                some: {
                  userId: session.user.id,
                  accessType: { not: ProjectAccessType.NO_ACCESS },
                },
              },
            },
            {
              groupPermissions: {
                some: {
                  group: {
                    assignedUsers: { some: { userId: session.user.id } },
                  },
                  accessType: { not: ProjectAccessType.NO_ACCESS },
                },
              },
            },
            { defaultAccessType: ProjectAccessType.GLOBAL_ROLE },
            ...(isProjectAdmin
              ? [{ assignedUsers: { some: { userId: session.user.id } } }]
              : []),
          ],
        };

    const project = await baseDb.projects.findFirst({
      where: projectAccessWhere,
      include: {
        projectIntegrations: {
          where: { isActive: true },
          select: { integrationId: true },
        },
      },
    });

    if (!project) {
      return NextResponse.json(
        { error: "Project not found or access denied" },
        { status: 404 }
      );
    }

    const allowedIntegrationIds = new Set(
      project.projectIntegrations.map((pi) => pi.integrationId)
    );
    const targetIntegrationId =
      integrationId && allowedIntegrationIds.has(integrationId)
        ? integrationId
        : project.projectIntegrations[0]?.integrationId;
    if (!targetIntegrationId) {
      return NextResponse.json({ attachments: [], visionSupported: false });
    }

    let attachments: Array<{
      id: string;
      filename: string;
      byteSize?: number;
      /** Over the per-image cap — render disabled in the picker. */
      tooLarge: boolean;
    }> = [];
    try {
      const adapter = await IntegrationManager.getInstance().getAdapter(
        String(targetIntegrationId)
      );
      if (adapter?.listAttachments) {
        const listed = await adapter.listAttachments(issueKey);
        attachments = listed
          .filter((meta) => !!resolveAttachmentImageMime(meta))
          .map((meta) => ({
            id: meta.id,
            filename: meta.filename,
            byteSize: meta.byteSize,
            tooLarge: !!meta.byteSize && meta.byteSize > MAX_IMAGE_BYTES,
          }));
      }
    } catch (err) {
      console.warn(
        `[context-images] Failed to list attachments for %s:`,
        issueKey,
        err
      );
      // Fail soft: the picker simply shows no images.
      attachments = [];
    }

    // Whether the project's resolved generation model takes image input —
    // lets the wizard warn before generating rather than after.
    let visionSupported = false;
    try {
      const manager = LlmManager.getInstance(baseDb);
      const resolver = new PromptResolver(baseDb);
      const resolvedPrompt = await resolver.resolve(
        LLM_FEATURES.TEST_CASE_GENERATION,
        projectId
      );
      const resolved = await manager.resolveIntegration(
        LLM_FEATURES.TEST_CASE_GENERATION,
        projectId,
        resolvedPrompt
      );
      if (resolved) {
        visionSupported = await manager.supportsVision(
          resolved.integrationId,
          resolved.model
        );
      }
    } catch (err) {
      console.warn(`[context-images] Failed to resolve vision support:`, err);
    }

    return NextResponse.json({
      attachments,
      visionSupported,
      maxImages: MAX_CONTEXT_IMAGES,
      maxImageBytes: MAX_IMAGE_BYTES,
    });
  } catch (error) {
    console.error(
      "Error in POST /api/llm/generate-test-cases/context-images:",
      error
    );
    return NextResponse.json(
      { error: "Failed to list issue images" },
      { status: 500 }
    );
  }
}
