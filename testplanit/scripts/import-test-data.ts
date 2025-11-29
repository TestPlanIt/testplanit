#!/usr/bin/env node
import { PrismaClient } from '@prisma/client';
import { readFileSync } from 'fs';
import { parse } from 'csv-parse/sync';
import { performance } from 'perf_hooks';

const prisma = new PrismaClient();

interface TestFolderData {
  folder_id: number;
  folder_name: string;
  parent_id?: number;
  depth: number;
  case_count: number;
  description: string;
}

const PERFORMANCE_TEST_PROJECT_ID = 999997;
const TEST_USER_ID = 'csv-test-user';

class CSVTestDataImporter {
  async setup(): Promise<void> {
    console.log('🔧 Setting up test environment...');
    
    // Create test user
    await prisma.user.upsert({
      where: { id: TEST_USER_ID },
      create: {
        id: TEST_USER_ID,
        email: 'csv-test@example.com',
        name: 'CSV Test User',
        password: 'test-password',
      },
      update: {},
    });

    // Create test project
    await prisma.projects.upsert({
      where: { id: PERFORMANCE_TEST_PROJECT_ID },
      create: {
        id: PERFORMANCE_TEST_PROJECT_ID,
        name: 'CSV Performance Test Project',
        createdBy: TEST_USER_ID,
      },
      update: {},
    });

    // Create test repository  
    await prisma.repositories.upsert({
      where: { id: 1 },
      create: {
        id: 1,
        projectId: PERFORMANCE_TEST_PROJECT_ID,
      },
      update: {},
    });

    console.log('✅ Environment ready');
  }

  async cleanup(): Promise<void> {
    console.log('🧹 Cleaning up existing test data...');
    
    await prisma.repositoryCases.deleteMany({
      where: { projectId: PERFORMANCE_TEST_PROJECT_ID },
    });
    
    await prisma.repositoryFolders.deleteMany({
      where: { projectId: PERFORMANCE_TEST_PROJECT_ID },
    });
    
    console.log('✅ Cleanup complete');
  }

  async importCSVData(): Promise<{ folders: number; cases: number }> {
    const csvPath = '/Users/bdermanouelian/git/testplanit/testplanit/test/massive_performance_test_cases.csv';
    console.log(`📊 Reading CSV data from ${csvPath}...`);
    
    const csvContent = readFileSync(csvPath, 'utf-8');
    const records: TestFolderData[] = parse(csvContent, {
      columns: true,
      skip_empty_lines: true,
      cast: (value, { column }) => {
        if (['folder_id', 'parent_id', 'depth', 'case_count'].includes(column as string)) {
          return value === '' ? undefined : parseInt(value);
        }
        return value;
      }
    });
    
    console.log(`📁 Found ${records.length} folders in CSV`);
    
    // Create folders
    const folders: any[] = [];
    records.forEach((record, index) => {
      folders.push({
        id: record.folder_id,
        projectId: PERFORMANCE_TEST_PROJECT_ID,
        repositoryId: 1,
        parentId: record.parent_id || null,
        name: record.folder_name,
        order: index,
        creatorId: TEST_USER_ID,
        isDeleted: false,
      });
    });
    
    // Insert folders in batches
    console.log('📁 Inserting folders...');
    const folderBatchSize = 100;
    for (let i = 0; i < folders.length; i += folderBatchSize) {
      const batch = folders.slice(i, i + folderBatchSize);
      await prisma.repositoryFolders.createMany({
        data: batch,
        skipDuplicates: true,
      });
    }
    
    // Create test cases
    const cases: any[] = [];
    let caseId = 1;
    
    console.log('📋 Generating test cases...');
    records.forEach((record) => {
      for (let i = 0; i < record.case_count; i++) {
        cases.push({
          id: caseId,
          projectId: PERFORMANCE_TEST_PROJECT_ID,
          repositoryId: 1,
          folderId: record.folder_id,
          templateId: 22, // Default template
          stateId: 20, // Default state
          name: `${record.folder_name} - Test Case ${i + 1}`,
          order: i,
          creatorId: TEST_USER_ID,
          isDeleted: false,
        });
        caseId++;
      }
    });
    
    // Insert cases in batches
    console.log(`📋 Inserting ${cases.length} test cases...`);
    const caseBatchSize = 500;
    for (let i = 0; i < cases.length; i += caseBatchSize) {
      const batch = cases.slice(i, i + caseBatchSize);
      await prisma.repositoryCases.createMany({
        data: batch,
        skipDuplicates: true,
      });
      
      if (i % 2000 === 0) {
        console.log(`  Progress: ${Math.min(i + caseBatchSize, cases.length)}/${cases.length} cases`);
      }
    }
    
    console.log(`✅ Imported ${folders.length} folders and ${cases.length} test cases`);
    
    return {
      folders: folders.length,
      cases: cases.length,
    };
  }

  async generateAdditionalData(multiplier: number = 10): Promise<{ folders: number; cases: number }> {
    console.log(`🚀 Generating ${multiplier}x additional test data...`);
    
    const baseData = await this.getExistingData();
    
    const additionalFolders: any[] = [];
    const additionalCases: any[] = [];
    
    let nextFolderId = Math.max(...baseData.folders.map(f => f.id)) + 1;
    let nextCaseId = Math.max(...baseData.cases.map(c => c.id)) + 1;
    
    // For each existing folder, create multiple copies with variations
    baseData.folders.forEach((folder, folderIndex) => {
      for (let i = 0; i < multiplier; i++) {
        const newFolder = {
          id: nextFolderId,
          projectId: PERFORMANCE_TEST_PROJECT_ID,
          repositoryId: 1,
          parentId: folder.parentId,
          name: `${folder.name} - Copy ${i + 1}`,
          order: folderIndex * multiplier + i,
          creatorId: TEST_USER_ID,
          isDeleted: false,
        };
        additionalFolders.push(newFolder);
        
        // Create cases for this folder copy
        const originalCases = baseData.cases.filter(c => c.folderId === folder.id);
        originalCases.forEach((originalCase, caseIndex) => {
          additionalCases.push({
            id: nextCaseId,
            projectId: PERFORMANCE_TEST_PROJECT_ID,
            repositoryId: 1,
            folderId: nextFolderId,
            templateId: 22, // Default template
            stateId: 20, // Default state
            name: `${originalCase.name} - Copy ${i + 1}`,
            order: caseIndex,
            creatorId: TEST_USER_ID,
            isDeleted: false,
          });
          nextCaseId++;
        });
        
        nextFolderId++;
      }
    });
    
    console.log(`📁 Creating ${additionalFolders.length} additional folders...`);
    const folderBatchSize = 500;
    for (let i = 0; i < additionalFolders.length; i += folderBatchSize) {
      const batch = additionalFolders.slice(i, i + folderBatchSize);
      await prisma.repositoryFolders.createMany({
        data: batch,
        skipDuplicates: true,
      });
      
      if (i % 2500 === 0) {
        console.log(`  Folder progress: ${Math.min(i + folderBatchSize, additionalFolders.length)}/${additionalFolders.length}`);
      }
    }
    
    console.log(`📋 Creating ${additionalCases.length} additional test cases...`);
    const caseBatchSize = 1000;
    for (let i = 0; i < additionalCases.length; i += caseBatchSize) {
      const batch = additionalCases.slice(i, i + caseBatchSize);
      await prisma.repositoryCases.createMany({
        data: batch,
        skipDuplicates: true,
      });
      
      if (i % 5000 === 0) {
        console.log(`  Case progress: ${Math.min(i + caseBatchSize, additionalCases.length)}/${additionalCases.length}`);
      }
    }
    
    console.log(`✅ Generated ${additionalFolders.length} additional folders and ${additionalCases.length} additional cases`);
    
    return {
      folders: additionalFolders.length,
      cases: additionalCases.length,
    };
  }

  private async getExistingData(): Promise<{
    folders: Array<{ id: number; parentId: number | null; name: string }>;
    cases: Array<{ id: number; folderId: number; name: string }>;
  }> {
    const folders = await prisma.repositoryFolders.findMany({
      where: { projectId: PERFORMANCE_TEST_PROJECT_ID },
      select: { id: true, parentId: true, name: true },
    });
    
    const cases = await prisma.repositoryCases.findMany({
      where: { projectId: PERFORMANCE_TEST_PROJECT_ID },
      select: { id: true, folderId: true, name: true },
    });
    
    return { folders, cases };
  }

  async runTreeViewBenchmark(): Promise<void> {
    console.log('\n🎯 Running TreeView Performance Benchmark...');
    
    const startTime = performance.now();
    const startMemory = process.memoryUsage().heapUsed;
    
    // Simulate TreeView data loading
    console.log('📊 Fetching folders...');
    const fetchStart = performance.now();
    const folders = await prisma.repositoryFolders.findMany({
      where: {
        projectId: PERFORMANCE_TEST_PROJECT_ID,
        isDeleted: false,
      },
      orderBy: { order: 'asc' },
    });
    const fetchTime = performance.now() - fetchStart;
    
    console.log('📊 Fetching test cases...');
    const caseStart = performance.now();
    const cases = await prisma.repositoryCases.findMany({
      where: {
        projectId: PERFORMANCE_TEST_PROJECT_ID,
        isDeleted: false,
      },
      select: { id: true, folderId: true },
    });
    const caseTime = performance.now() - caseStart;
    
    console.log('🧮 Calculating case counts...');
    const calcStart = performance.now();
    
    // Simulate TreeView case count calculation
    const caseCountsByFolderId: Record<number, number> = {};
    cases.forEach((testCase) => {
      if (testCase.folderId) {
        caseCountsByFolderId[testCase.folderId] =
          (caseCountsByFolderId[testCase.folderId] || 0) + 1;
      }
    });
    
    // Simulate tree building
    const childrenMap = new Map<number, any[]>();
    folders.forEach((folder) => {
      const parentId = folder.parentId || 0;
      if (!childrenMap.has(parentId)) {
        childrenMap.set(parentId, []);
      }
      childrenMap.get(parentId)!.push(folder);
    });
    
    // Simulate total count calculation
    const totalCounts = new Map<number, number>();
    function calculateTotal(folderId: number): number {
      if (totalCounts.has(folderId)) {
        return totalCounts.get(folderId)!;
      }
      
      let total = caseCountsByFolderId[folderId] || 0;
      const children = childrenMap.get(folderId) || [];
      for (const child of children) {
        total += calculateTotal(child.id);
      }
      
      totalCounts.set(folderId, total);
      return total;
    }
    
    folders.forEach(folder => calculateTotal(folder.id));
    const calcTime = performance.now() - calcStart;
    
    const totalTime = performance.now() - startTime;
    const endMemory = process.memoryUsage().heapUsed;
    const memoryUsed = (endMemory - startMemory) / 1024 / 1024;
    
    console.log('\n📈 BENCHMARK RESULTS');
    console.log('===================');
    console.log(`📁 Folders: ${folders.length.toLocaleString()}`);
    console.log(`📋 Test Cases: ${cases.length.toLocaleString()}`);
    console.log(`⏱️  Folder fetch time: ${fetchTime.toFixed(2)}ms`);
    console.log(`⏱️  Case fetch time: ${caseTime.toFixed(2)}ms`);
    console.log(`⏱️  Calculation time: ${calcTime.toFixed(2)}ms`);
    console.log(`⏱️  Total time: ${totalTime.toFixed(2)}ms`);
    console.log(`💾 Memory used: ${memoryUsed.toFixed(2)}MB`);
    
    // Performance assessment
    const targetTimePerFolder = 1; // 1ms per folder as excellent
    const targetTime = folders.length * targetTimePerFolder;
    const processingTime = fetchTime + caseTime + calcTime;
    
    console.log(`\n🎯 Performance Assessment:`);
    console.log(`   Target: ${targetTime.toFixed(2)}ms (${targetTimePerFolder}ms per folder)`);
    console.log(`   Actual: ${processingTime.toFixed(2)}ms`);
    
    if (processingTime < targetTime) {
      const speedup = ((targetTime / processingTime) * 100).toFixed(0);
      console.log(`   ✅ EXCELLENT - ${speedup}% faster than target!`);
    } else if (processingTime < targetTime * 2) {
      const slowdown = ((processingTime / targetTime) * 100 - 100).toFixed(0);
      console.log(`   ⚠️  GOOD - ${slowdown}% slower than target`);
    } else if (processingTime < targetTime * 5) {
      const slowdown = ((processingTime / targetTime) * 100 - 100).toFixed(0);
      console.log(`   ⚠️  ACCEPTABLE - ${slowdown}% slower than target`);
    } else {
      const slowdown = ((processingTime / targetTime) * 100 - 100).toFixed(0);
      console.log(`   ❌ POOR - ${slowdown}% slower than target`);
    }
    
    // TreeView specific recommendations
    if (folders.length > 1000) {
      console.log(`\n💡 TreeView Recommendations:`);
      console.log(`   • react-arborist virtualization is handling ${folders.length.toLocaleString()} folders`);
      console.log(`   • Initial render should only show ~100-200 visible nodes`);
      console.log(`   • Lazy loading is recommended for depths > 3`);
      console.log(`   • Consider pagination for > 10,000 folders`);
    }
  }

  async run(): Promise<void> {
    try {
      await this.setup();
      await this.cleanup();
      
      const imported = await this.importCSVData();
      console.log(`\n✅ Base import complete: ${imported.folders} folders, ${imported.cases} cases`);
      
      // Ask user if they want to generate more data
      const multiplier = process.argv.includes('--multiplier') 
        ? parseInt(process.argv[process.argv.indexOf('--multiplier') + 1]) || 10
        : 1;
      
      if (multiplier > 1) {
        const additional = await this.generateAdditionalData(multiplier);
        console.log(`✅ Additional data generated: ${additional.folders} folders, ${additional.cases} cases`);
      }
      
      await this.runTreeViewBenchmark();
      
    } catch (error) {
      console.error('❌ Import failed:', error);
    } finally {
      await prisma.$disconnect();
    }
  }
}

// Run with: pnpm tsx scripts/import-test-data.ts [--multiplier 10]
const importer = new CSVTestDataImporter();
importer.run().catch(console.error);