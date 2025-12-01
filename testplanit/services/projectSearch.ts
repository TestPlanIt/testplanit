import {
  getElasticsearchClient,
  ENTITY_INDICES,
} from "./unifiedElasticsearchService";
import { SearchableEntityType } from "~/types/search";
import type { Projects, PrismaClient } from "@prisma/client";
import { prisma as defaultPrisma } from "~/lib/prismaBase";
import { extractTextFromNode } from "~/utils/extractTextFromJson";

/**
 * Type for project with all required relations for indexing
 */
type ProjectForIndexing = Projects & {
  creator: { name: string; image?: string | null };
};

/**
 * Index a single project to Elasticsearch
 */
export async function indexProject(project: ProjectForIndexing): Promise<void> {
  const client = getElasticsearchClient();
  if (!client) {
    throw new Error("Elasticsearch client not available");
  }

  const searchableContent = [
    project.name,
    project.note ? extractTextFromNode(project.note) : "",
    project.docs ? extractTextFromNode(project.docs) : "",
  ].join(" ");

  const document = {
    id: project.id,
    name: project.name,
    iconUrl: project.iconUrl,
    note: project.note,
    docs: project.docs,
    isDeleted: project.isDeleted,
    createdAt: project.createdAt,
    createdById: project.createdBy,
    createdByName: project.creator.name,
    createdByImage: project.creator.image,
    searchableContent,
  };

  await client.index({
    index: ENTITY_INDICES[SearchableEntityType.PROJECT],
    id: project.id.toString(),
    document,
    refresh: true,
  });
}

/**
 * Delete a project from Elasticsearch
 */
export async function deleteProjectFromIndex(projectId: number): Promise<void> {
  const client = getElasticsearchClient();
  if (!client) {
    console.warn("Elasticsearch client not available");
    return;
  }

  try {
    await client.delete({
      index: ENTITY_INDICES[SearchableEntityType.PROJECT],
      id: projectId.toString(),
      refresh: true,
    });
  } catch (error: any) {
    if (error.meta?.statusCode !== 404) {
      console.error("Failed to delete project from index:", error);
    }
  }
}

/**
 * Sync a single project to Elasticsearch
 */
export async function syncProjectToElasticsearch(projectId: number): Promise<boolean> {
  const client = getElasticsearchClient();
  if (!client) {
    console.warn("Elasticsearch client not available");
    return false;
  }

  try {
    const project = await defaultPrisma.projects.findUnique({
      where: { id: projectId },
      include: {
        creator: true,
      },
    });

    if (!project) {
      console.warn(`Project ${projectId} not found`);
      return false;
    }

    // Index project including deleted ones (filtering happens at search time based on admin permissions)

    // Index the project
    await indexProject(project);
    return true;
  } catch (error) {
    console.error(`Failed to sync project ${projectId}:`, error);
    return false;
  }
}

/**
 * Sync all projects to Elasticsearch
 */
export async function syncAllProjectsToElasticsearch(): Promise<void> {
  const client = getElasticsearchClient();
  if (!client) {
    console.warn("Elasticsearch client not available");
    return;
  }

  console.log("Starting project sync");

  const projects = await defaultPrisma.projects.findMany({
    where: {
      // Include deleted items (filtering happens at search time based on admin permissions)
    },
    include: {
      creator: true,
    },
  });

  if (projects.length === 0) {
    console.log("No projects to index");
    return;
  }

  const bulkBody = [];
  for (const project of projects) {
    const searchableContent = [
      project.name,
      project.note ? extractTextFromNode(project.note) : "",
      project.docs ? extractTextFromNode(project.docs) : "",
    ].join(" ");

    bulkBody.push({
      index: {
        _index: ENTITY_INDICES[SearchableEntityType.PROJECT],
        _id: project.id.toString(),
      },
    });

    bulkBody.push({
      id: project.id,
      name: project.name,
      iconUrl: project.iconUrl,
      note: project.note,
      docs: project.docs,
      isDeleted: project.isDeleted,
      createdAt: project.createdAt,
      createdById: project.createdBy,
      createdByName: project.creator.name,
      createdByImage: project.creator.image,
      searchableContent,
    });
  }

  try {
    const response = await client.bulk({ body: bulkBody, refresh: true });
    if (response.errors) {
      console.error("Bulk indexing errors:", response.errors);
    }
    console.log(`Successfully indexed ${projects.length} projects`);
  } catch (error) {
    console.error("Failed to index projects:", error);
  }
}