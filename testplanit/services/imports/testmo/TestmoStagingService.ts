import { Prisma, PrismaClient } from '@prisma/client';

/**
 * Service for managing Testmo import staging data in the database.
 * This service handles all database operations related to staging import data,
 * allowing the import process to work with large datasets without memory constraints.
 */
type StagingRowData = {
  jobId: string;
  datasetName: string;
  rowIndex: number;
  rowData: Prisma.InputJsonValue;
  fieldName: string | null;
  fieldValue: string | null;
  text1: string | null;
  text2: string | null;
  text3: string | null;
  text4: string | null;
  processed: boolean;
};

export class TestmoStagingService {
  constructor(private prisma: PrismaClient | Prisma.TransactionClient) {}

  private prepareStagingRow(
    jobId: string,
    datasetName: string,
    rowIndex: number,
    rowData: any
  ): StagingRowData {
    let sanitizedData: Prisma.InputJsonValue = rowData as Prisma.InputJsonValue;
    let fieldName: string | null = null;
    let fieldValue: string | null = null;
    let text1: string | null = null;
    let text2: string | null = null;
    let text3: string | null = null;
    let text4: string | null = null;

    if (
      datasetName === 'automation_run_test_fields' &&
      rowData &&
      typeof rowData === 'object' &&
      !Array.isArray(rowData)
    ) {
      const clone = { ...(rowData as Record<string, unknown>) };
      const rawValue = (clone as { value?: unknown }).value;

      if (rawValue !== undefined) {
        if (typeof rawValue === 'string') {
          fieldValue = rawValue;
        } else if (rawValue !== null) {
          try {
            fieldValue = JSON.stringify(rawValue);
          } catch {
            fieldValue = String(rawValue);
          }
        }
        delete clone.value;
      }

      const rawName = (rowData as { name?: unknown }).name;
      if (typeof rawName === 'string') {
        fieldName = rawName;
      }

      sanitizedData = clone as Prisma.InputJsonValue;
    }
    if (
      datasetName === 'run_result_steps' &&
      rowData &&
      typeof rowData === 'object' &&
      !Array.isArray(rowData)
    ) {
      const clone = { ...(rowData as Record<string, unknown>) };

      const extractText = (key: `text${1 | 2 | 3 | 4}`) => {
        const raw = clone[key];
        if (raw === undefined) {
          return null;
        }
        delete clone[key];
        if (raw === null) {
          return null;
        }
        if (typeof raw === 'string') {
          return raw;
        }
        try {
          return JSON.stringify(raw);
        } catch {
          return String(raw);
        }
      };

      text1 = extractText('text1');
      text2 = extractText('text2');
      text3 = extractText('text3');
      text4 = extractText('text4');

      sanitizedData = clone as Prisma.InputJsonValue;
    }

    return {
      jobId,
      datasetName,
      rowIndex,
      rowData: sanitizedData,
      fieldName,
      fieldValue,
      text1,
      text2,
      text3,
      text4,
      processed: false,
    };
  }

  /**
   * Stage a single dataset row for later processing
   */
  async stageDatasetRow(
    jobId: string,
    datasetName: string,
    rowIndex: number,
    rowData: any
  ) {
    return this.prisma.testmoImportStaging.create({
      data: this.prepareStagingRow(jobId, datasetName, rowIndex, rowData),
    });
  }

  /**
   * Batch stage multiple rows for better performance
   */
  async stageBatch(
    jobId: string,
    datasetName: string,
    rows: Array<{ index: number; data: any }>
  ) {
    if (rows.length === 0) return { count: 0 };

    const data = rows.map(({ index, data }) =>
      this.prepareStagingRow(jobId, datasetName, index, data)
    );

    return this.prisma.testmoImportStaging.createMany({ data });
  }

  /**
   * Store or update an entity mapping
   */
  async storeMapping(
    jobId: string,
    entityType: string,
    sourceId: number,
    targetId: string | null,
    targetType: 'map' | 'create',
    metadata?: any
  ) {
    return this.prisma.testmoImportMapping.upsert({
      where: {
        jobId_entityType_sourceId: {
          jobId,
          entityType,
          sourceId,
        },
      },
      create: {
        jobId,
        entityType,
        sourceId,
        targetId,
        targetType,
        metadata: metadata as Prisma.InputJsonValue,
      },
      update: {
        targetId,
        targetType,
        metadata: metadata as Prisma.InputJsonValue,
      },
    });
  }

  /**
   * Batch store multiple mappings
   */
  async storeMappingBatch(
    jobId: string,
    mappings: Array<{
      entityType: string;
      sourceId: number;
      targetId: string | null;
      targetType: 'map' | 'create';
      metadata?: any;
    }>
  ) {
    if (mappings.length === 0) return { count: 0 };

    const operations = mappings.map(mapping =>
      this.prisma.testmoImportMapping.upsert({
        where: {
          jobId_entityType_sourceId: {
            jobId,
            entityType: mapping.entityType,
            sourceId: mapping.sourceId,
          },
        },
        create: {
          jobId,
          entityType: mapping.entityType,
          sourceId: mapping.sourceId,
          targetId: mapping.targetId,
          targetType: mapping.targetType,
          metadata: mapping.metadata as Prisma.InputJsonValue,
        },
        update: {
          targetId: mapping.targetId,
          targetType: mapping.targetType,
          metadata: mapping.metadata as Prisma.InputJsonValue,
        },
      })
    );

    const results = await Promise.all(operations);
    return { count: results.length };
  }

  /**
   * Get a specific mapping
   */
  async getMapping(jobId: string, entityType: string, sourceId: number) {
    return this.prisma.testmoImportMapping.findUnique({
      where: {
        jobId_entityType_sourceId: {
          jobId,
          entityType,
          sourceId,
        },
      },
    });
  }

  /**
   * Get all mappings for a specific entity type
   */
  async getMappingsByType(jobId: string, entityType: string) {
    return this.prisma.testmoImportMapping.findMany({
      where: {
        jobId,
        entityType,
      },
    });
  }

  /**
   * Process staged rows in batches with cursor pagination.
   * This allows processing large datasets without loading everything into memory.
   */
  async processStagedBatch<T>(
    jobId: string,
    datasetName: string,
    batchSize: number,
    processor: (
      rows: Array<{
        id: string;
        rowIndex: number;
        rowData: T;
        fieldName?: string | null;
        fieldValue?: string | null;
        text1?: string | null;
        text2?: string | null;
        text3?: string | null;
        text4?: string | null;
      }>
    ) => Promise<string[]>
  ): Promise<{ processedCount: number; errorCount: number }> {
    let cursor: string | undefined;
    let processedCount = 0;
    let errorCount = 0;

    while (true) {
      // Fetch the next batch of unprocessed rows
      const batch = await this.prisma.testmoImportStaging.findMany({
        where: {
          jobId,
          datasetName,
          processed: false,
        },
        take: batchSize,
        cursor: cursor ? { id: cursor } : undefined,
        orderBy: { rowIndex: 'asc' }, // Maintain original order
      });

      if (batch.length === 0) break;

      try {
        // Process the batch and get successfully processed IDs
        const processedIds = await processor(
          batch.map(b => ({
            id: b.id,
            rowIndex: b.rowIndex,
            rowData: b.rowData as T,
            fieldName: b.fieldName,
            fieldValue: b.fieldValue,
            text1: b.text1,
            text2: b.text2,
            text3: b.text3,
            text4: b.text4,
          }))
        );

        // Mark successfully processed rows
        if (processedIds.length > 0) {
          await this.prisma.testmoImportStaging.updateMany({
            where: { id: { in: processedIds } },
            data: { processed: true },
          });
          processedCount += processedIds.length;
        }

        // Mark failed rows (those not in processedIds)
        const failedIds = batch
          .filter(b => !processedIds.includes(b.id))
          .map(b => b.id);

        if (failedIds.length > 0) {
          await this.prisma.testmoImportStaging.updateMany({
            where: { id: { in: failedIds } },
            data: {
              processed: true,
              error: 'Processing failed',
            },
          });
          errorCount += failedIds.length;
        }
      } catch (error) {
        // If the entire batch fails, mark all as failed
        const ids = batch.map(b => b.id);
        await this.prisma.testmoImportStaging.updateMany({
          where: { id: { in: ids } },
          data: {
            processed: true,
            error: error instanceof Error ? error.message : 'Unknown error',
          },
        });
        errorCount += batch.length;
      }

      // Set cursor for next batch
      cursor = batch[batch.length - 1].id;

      // Allow garbage collection between batches
      await new Promise(resolve => setImmediate(resolve));
    }

    return { processedCount, errorCount };
  }

  /**
   * Get count of unprocessed rows for progress tracking
   */
  async getUnprocessedCount(jobId: string, datasetName?: string) {
    return this.prisma.testmoImportStaging.count({
      where: {
        jobId,
        ...(datasetName && { datasetName }),
        processed: false,
      },
    });
  }

  /**
   * Get total count of rows for a dataset
   */
  async getTotalCount(jobId: string, datasetName?: string) {
    return this.prisma.testmoImportStaging.count({
      where: {
        jobId,
        ...(datasetName && { datasetName }),
      },
    });
  }

  /**
   * Get processing statistics
   */
  async getProcessingStats(jobId: string, datasetName?: string) {
    const where = {
      jobId,
      ...(datasetName && { datasetName }),
    };

    const [total, processed, errors] = await Promise.all([
      this.prisma.testmoImportStaging.count({ where }),
      this.prisma.testmoImportStaging.count({
        where: { ...where, processed: true, error: null },
      }),
      this.prisma.testmoImportStaging.count({
        where: { ...where, processed: true, error: { not: null } },
      }),
    ]);

    return {
      total,
      processed,
      errors,
      pending: total - processed - errors,
      percentComplete: total > 0 ? Math.round(((processed + errors) / total) * 100) : 0,
    };
  }

  /**
   * Get failed rows with error details
   */
  async getFailedRows(jobId: string, datasetName?: string, limit = 100) {
    return this.prisma.testmoImportStaging.findMany({
      where: {
        jobId,
        ...(datasetName && { datasetName }),
        processed: true,
        error: { not: null },
      },
      take: limit,
      orderBy: { rowIndex: 'asc' },
      select: {
        id: true,
        rowIndex: true,
        datasetName: true,
        error: true,
        rowData: true,
      },
    });
  }

  /**
   * Reset processing status for failed rows (for retry)
   */
  async resetFailedRows(jobId: string, datasetName?: string) {
    return this.prisma.testmoImportStaging.updateMany({
      where: {
        jobId,
        ...(datasetName && { datasetName }),
        processed: true,
        error: { not: null },
      },
      data: {
        processed: false,
        error: null,
      },
    });
  }

  /**
   * Mark specific rows as failed with an error message
   */
  async markFailed(ids: string[], error: string) {
    return this.prisma.testmoImportStaging.updateMany({
      where: { id: { in: ids } },
      data: {
        processed: true,
        error,
      },
    });
  }

  /**
   * Clean up all staging data for a job
   */
  async cleanup(jobId: string) {
    await Promise.all([
      this.prisma.testmoImportStaging.deleteMany({ where: { jobId } }),
      this.prisma.testmoImportMapping.deleteMany({ where: { jobId } }),
    ]);
  }

  /**
   * Clean up only processed staging data (keep mappings)
   */
  async cleanupProcessedStaging(jobId: string) {
    return this.prisma.testmoImportStaging.deleteMany({
      where: {
        jobId,
        processed: true,
      },
    });
  }

  /**
   * Check if a job has staging data
   */
  async hasStagingData(jobId: string): Promise<boolean> {
    const count = await this.prisma.testmoImportStaging.count({
      where: { jobId },
      take: 1,
    });
    return count > 0;
  }

  /**
   * Get distinct dataset names for a job
   */
  async getDatasetNames(jobId: string): Promise<string[]> {
    const results = await this.prisma.testmoImportStaging.findMany({
      where: { jobId },
      distinct: ['datasetName'],
      select: { datasetName: true },
    });
    return results.map(r => r.datasetName);
  }
}
