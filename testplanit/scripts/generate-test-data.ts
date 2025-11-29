#!/usr/bin/env node
import { PrismaClient } from '@prisma/client';
import { performance } from 'perf_hooks';

const prisma = new PrismaClient();

interface TestDataConfig {
  name: string;
  folders: number;
  maxDepth: number;
  branchingFactor: number;
  casesPerFolder: number;
}

const TEST_CONFIGS: TestDataConfig[] = [
  {
    name: 'Small Dataset',
    folders: 100,
    maxDepth: 4,
    branchingFactor: 5,
    casesPerFolder: 10,
  },
  {
    name: 'Medium Dataset', 
    folders: 1000,
    maxDepth: 5,
    branchingFactor: 7,
    casesPerFolder: 5,
  },
  {
    name: 'Large Dataset',
    folders: 5000,
    maxDepth: 6,
    branchingFactor: 10,
    casesPerFolder: 2,
  },
  {
    name: 'Massive Dataset',
    folders: 20000,
    maxDepth: 8,
    branchingFactor: 15,
    casesPerFolder: 1,
  }
];

const PERFORMANCE_TEST_PROJECT_ID = 999998;
const TEST_USER_ID = 'perf-test-user';

class TestDataGenerator {
  async setup(): Promise<void> {
    console.log('Setting up test environment...');
    
    // Create test user
    await prisma.user.upsert({
      where: { id: TEST_USER_ID },
      create: {
        id: TEST_USER_ID,
        email: 'perf-test@example.com',
        name: 'Performance Test User',
        password: 'test-password',
      },
      update: {},
    });

    // Create test project
    await prisma.projects.upsert({
      where: { id: PERFORMANCE_TEST_PROJECT_ID },
      create: {
        id: PERFORMANCE_TEST_PROJECT_ID,
        name: 'TreeView Performance Test Project',
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

    console.log('✅ Test environment ready');
  }

  async cleanup(): Promise<void> {
    console.log('Cleaning up test data...');
    
    await prisma.repositoryCases.deleteMany({
      where: { projectId: PERFORMANCE_TEST_PROJECT_ID },
    });
    
    await prisma.repositoryFolders.deleteMany({
      where: { projectId: PERFORMANCE_TEST_PROJECT_ID },
    });
    
    console.log('✅ Cleanup complete');
  }

  async generateData(config: TestDataConfig): Promise<{ folders: number; cases: number; timeMs: number }> {
    const startTime = performance.now();
    console.log(`\n📊 Generating ${config.name}...`);
    console.log(`Target: ${config.folders} folders, depth: ${config.maxDepth}, cases: ${config.casesPerFolder} per folder`);
    
    const folders: any[] = [];
    let folderId = 1;
    let currentLevel: number[] = [];
    let nextLevel: number[] = [];
    
    // Generate root folders
    const rootCount = Math.min(config.branchingFactor, config.folders);
    for (let i = 0; i < rootCount && folderId <= config.folders; i++) {
      folders.push({
        id: folderId,
        projectId: PERFORMANCE_TEST_PROJECT_ID,
        repositoryId: 1,
        parentId: null,
        name: `Folder-${folderId}`,
        order: i,
        creatorId: TEST_USER_ID,
        isDeleted: false,
      });
      currentLevel.push(folderId);
      folderId++;
    }
    
    // Generate child folders level by level
    let depth = 1;
    while (depth < config.maxDepth && folderId <= config.folders && currentLevel.length > 0) {
      for (const parentId of currentLevel) {
        const childCount = Math.min(
          config.branchingFactor,
          config.folders - folderId + 1
        );
        
        for (let i = 0; i < childCount && folderId <= config.folders; i++) {
          folders.push({
            id: folderId,
            projectId: PERFORMANCE_TEST_PROJECT_ID,
            repositoryId: 1,
            parentId: parentId,
            name: `Folder-${folderId}`,
            order: i,
            creatorId: TEST_USER_ID,
            isDeleted: false,
          });
          nextLevel.push(folderId);
          folderId++;
        }
      }
      
      currentLevel = nextLevel;
      nextLevel = [];
      depth++;
    }
    
    // Insert folders in batches
    const folderBatchSize = 1000;
    for (let i = 0; i < folders.length; i += folderBatchSize) {
      const batch = folders.slice(i, i + folderBatchSize);
      await prisma.repositoryFolders.createMany({
        data: batch,
        skipDuplicates: true,
      });
      
      if (i % 5000 === 0) {
        console.log(`  📁 Created ${Math.min(i + folderBatchSize, folders.length)}/${folders.length} folders`);
      }
    }
    
    // Generate test cases
    const cases: any[] = [];
    let caseId = 1;
    
    if (config.casesPerFolder > 0) {
      for (const folder of folders) {
        for (let i = 0; i < config.casesPerFolder; i++) {
          cases.push({
            id: caseId,
            projectId: PERFORMANCE_TEST_PROJECT_ID,
            repositoryId: 1,
            folderId: folder.id,
            templateId: 22, // Default template
            stateId: 20, // Default state
            name: `Test Case ${caseId}`,
            order: i,
            creatorId: TEST_USER_ID,
            isDeleted: false,
          });
          caseId++;
        }
      }
      
      // Insert cases in batches
      const caseBatchSize = 2000;
      for (let i = 0; i < cases.length; i += caseBatchSize) {
        const batch = cases.slice(i, i + caseBatchSize);
        await prisma.repositoryCases.createMany({
          data: batch,
          skipDuplicates: true,
        });
        
        if (i % 10000 === 0) {
          console.log(`  📋 Created ${Math.min(i + caseBatchSize, cases.length)}/${cases.length} test cases`);
        }
      }
    }
    
    const timeMs = performance.now() - startTime;
    
    console.log(`✅ Generated ${folders.length} folders and ${cases.length} test cases in ${(timeMs / 1000).toFixed(2)}s`);
    
    return {
      folders: folders.length,
      cases: cases.length,
      timeMs,
    };
  }

  async benchmarkTreeViewPerformance(config: TestDataConfig): Promise<{
    fetchTime: number;
    renderTime: number;
    memoryMB: number;
  }> {
    console.log(`\n🚀 Benchmarking TreeView with ${config.name}...`);
    
    const startMemory = process.memoryUsage().heapUsed;
    
    // Benchmark folder fetching (simulates what TreeView does)
    const fetchStart = performance.now();
    const folders = await prisma.repositoryFolders.findMany({
      where: {
        projectId: PERFORMANCE_TEST_PROJECT_ID,
        isDeleted: false,
      },
      orderBy: { order: 'asc' },
    });
    const fetchTime = performance.now() - fetchStart;
    
    // Benchmark case counting (simulates case count calculation)
    const renderStart = performance.now();
    const cases = await prisma.repositoryCases.findMany({
      where: {
        projectId: PERFORMANCE_TEST_PROJECT_ID,
        isDeleted: false,
      },
      select: {
        id: true,
        folderId: true,
      },
    });
    
    // Simulate tree building and case count calculations
    const caseCountsByFolderId: Record<number, number> = {};
    cases.forEach((testCase) => {
      if (testCase.folderId) {
        caseCountsByFolderId[testCase.folderId] =
          (caseCountsByFolderId[testCase.folderId] || 0) + 1;
      }
    });
    
    // Simulate tree structure building
    const childrenMap = new Map<number, any[]>();
    folders.forEach((folder) => {
      const parentId = folder.parentId || 0;
      if (!childrenMap.has(parentId)) {
        childrenMap.set(parentId, []);
      }
      childrenMap.get(parentId)!.push(folder);
    });
    
    // Simulate recursive total calculation
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
    
    const renderTime = performance.now() - renderStart;
    
    const endMemory = process.memoryUsage().heapUsed;
    const memoryMB = (endMemory - startMemory) / 1024 / 1024;
    
    console.log(`  📊 Results:`);
    console.log(`    Fetch time: ${fetchTime.toFixed(2)}ms`);
    console.log(`    Render calculation: ${renderTime.toFixed(2)}ms`);
    console.log(`    Memory used: ${memoryMB.toFixed(2)}MB`);
    console.log(`    Total time: ${(fetchTime + renderTime).toFixed(2)}ms`);
    
    // Performance assessment
    const totalTime = fetchTime + renderTime;
    const targetTime = folders.length * 2; // 2ms per folder as acceptable
    
    if (totalTime < targetTime) {
      console.log(`    ✅ EXCELLENT performance (${((targetTime / totalTime) * 100).toFixed(0)}% faster than target)`);
    } else if (totalTime < targetTime * 1.5) {
      console.log(`    ⚠️  ACCEPTABLE performance (${((totalTime / targetTime) * 100 - 100).toFixed(0)}% slower than target)`);
    } else {
      console.log(`    ❌ POOR performance (${((totalTime / targetTime) * 100 - 100).toFixed(0)}% slower than target)`);
    }
    
    return {
      fetchTime,
      renderTime,
      memoryMB,
    };
  }

  async runFullBenchmark(): Promise<void> {
    await this.setup();
    
    console.log('\n🎯 TreeView Performance Benchmark Suite');
    console.log('========================================');
    
    const results: Array<{
      config: TestDataConfig;
      generation: { folders: number; cases: number; timeMs: number };
      performance: { fetchTime: number; renderTime: number; memoryMB: number };
    }> = [];
    
    for (const config of TEST_CONFIGS) {
      await this.cleanup(); // Clean between tests
      
      const generation = await this.generateData(config);
      const performance = await this.benchmarkTreeViewPerformance(config);
      
      results.push({ config, generation, performance });
      
      // Brief pause between tests
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    
    console.log('\n📈 BENCHMARK SUMMARY');
    console.log('===================');
    
    results.forEach(({ config, generation, performance }, index) => {
      console.log(`\n${index + 1}. ${config.name}:`);
      console.log(`   Folders: ${generation.folders.toLocaleString()}`);
      console.log(`   Test Cases: ${generation.cases.toLocaleString()}`);
      console.log(`   Generation Time: ${(generation.timeMs / 1000).toFixed(2)}s`);
      console.log(`   TreeView Fetch: ${performance.fetchTime.toFixed(2)}ms`);
      console.log(`   TreeView Render: ${performance.renderTime.toFixed(2)}ms`);
      console.log(`   Memory Usage: ${performance.memoryMB.toFixed(2)}MB`);
      console.log(`   Total TreeView Time: ${(performance.fetchTime + performance.renderTime).toFixed(2)}ms`);
    });
    
    await this.cleanup();
    await prisma.$disconnect();
    
    console.log('\n✨ Benchmark complete!');
  }
}

// Run the benchmark
const generator = new TestDataGenerator();
generator.runFullBenchmark().catch(console.error);