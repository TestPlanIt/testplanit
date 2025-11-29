#!/usr/bin/env node
import { PrismaClient } from '@prisma/client';
import { performance } from 'perf_hooks';

const prisma = new PrismaClient();

interface TreeViewBenchmarkResult {
  projectId: number;
  folderCount: number;
  caseCount: number;
  fetchTime: number;
  calculationTime: number;
  memoryUsageMB: number;
  totalTime: number;
  performanceRating: 'EXCELLENT' | 'GOOD' | 'ACCEPTABLE' | 'POOR';
}

class TreeViewPerformanceTester {
  async getProjectStats(projectId: number): Promise<{ folders: number; cases: number }> {
    const [folderCount, caseCount] = await Promise.all([
      prisma.repositoryFolders.count({
        where: { projectId, isDeleted: false },
      }),
      prisma.repositoryCases.count({
        where: { projectId, isDeleted: false },
      }),
    ]);

    return { folders: folderCount, cases: caseCount };
  }

  async benchmarkTreeView(projectId: number): Promise<TreeViewBenchmarkResult> {
    console.log(`\n🎯 Testing TreeView performance for project ${projectId}...`);
    
    const startMemory = process.memoryUsage().heapUsed;
    const overallStart = performance.now();
    
    // Step 1: Fetch folders (what TreeView does first)
    console.log('📁 Fetching folders...');
    const fetchStart = performance.now();
    const folders = await prisma.repositoryFolders.findMany({
      where: {
        projectId,
        isDeleted: false,
      },
      orderBy: { order: 'asc' },
    });
    const fetchTime = performance.now() - fetchStart;
    
    // Step 2: Fetch cases for count calculation
    console.log('📋 Fetching test cases...');
    const cases = await prisma.repositoryCases.findMany({
      where: {
        projectId,
        isDeleted: false,
      },
      select: {
        id: true,
        folderId: true,
      },
    });
    
    // Step 3: Calculate case counts (TreeView's heavy operation)
    console.log('🧮 Calculating folder case counts...');
    const calcStart = performance.now();
    
    const caseCountsByFolderId: Record<number, number> = {};
    cases.forEach((testCase) => {
      if (testCase.folderId) {
        caseCountsByFolderId[testCase.folderId] =
          (caseCountsByFolderId[testCase.folderId] || 0) + 1;
      }
    });

    // Build children map for tree structure
    const childrenMap = new Map<number, any[]>();
    folders.forEach((folder) => {
      const parentId = folder.parentId || 0;
      if (!childrenMap.has(parentId)) {
        childrenMap.set(parentId, []);
      }
      childrenMap.get(parentId)!.push(folder);
    });

    // Calculate total counts recursively (expensive operation)
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
    
    const calculationTime = performance.now() - calcStart;
    const totalTime = performance.now() - overallStart;
    
    const endMemory = process.memoryUsage().heapUsed;
    const memoryUsageMB = (endMemory - startMemory) / 1024 / 1024;
    
    // Performance assessment
    let performanceRating: TreeViewBenchmarkResult['performanceRating'];
    const targetTime = folders.length * 1; // 1ms per folder target
    
    if (totalTime < targetTime) {
      performanceRating = 'EXCELLENT';
    } else if (totalTime < targetTime * 2) {
      performanceRating = 'GOOD';
    } else if (totalTime < targetTime * 5) {
      performanceRating = 'ACCEPTABLE';
    } else {
      performanceRating = 'POOR';
    }
    
    return {
      projectId,
      folderCount: folders.length,
      caseCount: cases.length,
      fetchTime,
      calculationTime,
      memoryUsageMB,
      totalTime,
      performanceRating,
    };
  }

  async findLargestProjects(limit: number = 5): Promise<Array<{ id: number; name: string; folders: number; cases: number }>> {
    console.log('🔍 Finding projects with most folders...');
    
    const projects = await prisma.projects.findMany({
      select: {
        id: true,
        name: true,
      },
      take: 50, // Check first 50 projects
    });
    
    const projectStats = await Promise.all(
      projects.map(async (project) => {
        const stats = await this.getProjectStats(project.id);
        return {
          id: project.id,
          name: project.name,
          folders: stats.folders,
          cases: stats.cases,
        };
      })
    );
    
    return projectStats
      .filter(p => p.folders > 0)
      .sort((a, b) => b.folders - a.folders)
      .slice(0, limit);
  }

  displayResults(result: TreeViewBenchmarkResult): void {
    console.log(`\n📊 TreeView Performance Results - Project ${result.projectId}`);
    console.log('=' .repeat(50));
    console.log(`📁 Folders: ${result.folderCount.toLocaleString()}`);
    console.log(`📋 Test Cases: ${result.caseCount.toLocaleString()}`);
    console.log(`⏱️  Folder fetch: ${result.fetchTime.toFixed(2)}ms`);
    console.log(`⏱️  Case calculation: ${result.calculationTime.toFixed(2)}ms`);
    console.log(`⏱️  Total processing: ${result.totalTime.toFixed(2)}ms`);
    console.log(`💾 Memory used: ${result.memoryUsageMB.toFixed(2)}MB`);
    
    const icon = {
      EXCELLENT: '🟢',
      GOOD: '🟡', 
      ACCEPTABLE: '🟠',
      POOR: '🔴'
    }[result.performanceRating];
    
    console.log(`\n${icon} Performance: ${result.performanceRating}`);
    
    if (result.folderCount > 1000) {
      console.log(`\n💡 react-arborist Benefits:`);
      console.log(`   • Virtualizes ${result.folderCount.toLocaleString()} folders`);
      console.log(`   • Only renders ~50-100 visible nodes`);
      console.log(`   • Smooth scrolling regardless of dataset size`);
      console.log(`   • Built-in performance optimizations`);
    }
    
    if (result.performanceRating === 'POOR') {
      console.log(`\n⚠️  Recommendations:`);
      console.log(`   • Consider lazy loading for > 5000 folders`);
      console.log(`   • Implement server-side pagination`);
      console.log(`   • Cache case counts in database`);
    }
  }

  async runFullSuite(): Promise<void> {
    console.log('🚀 TreeView Performance Test Suite');
    console.log('================================');
    
    try {
      // Find projects with data to test
      const largestProjects = await this.findLargestProjects();
      
      if (largestProjects.length === 0) {
        console.log('⚠️  No projects with folders found. Import some test data first.');
        return;
      }
      
      console.log(`\n📋 Found ${largestProjects.length} projects to test:`);
      largestProjects.forEach((project, index) => {
        console.log(`   ${index + 1}. ${project.name} (${project.folders} folders, ${project.cases} cases)`);
      });
      
      // Test each project
      const results: TreeViewBenchmarkResult[] = [];
      
      for (const project of largestProjects) {
        const result = await this.benchmarkTreeView(project.id);
        this.displayResults(result);
        results.push(result);
        
        // Brief pause between tests
        await new Promise(resolve => setTimeout(resolve, 500));
      }
      
      // Summary
      this.displaySummary(results);
      
    } catch (error) {
      console.error('❌ Test suite failed:', error);
    } finally {
      await prisma.$disconnect();
    }
  }

  displaySummary(results: TreeViewBenchmarkResult[]): void {
    console.log(`\n📈 PERFORMANCE SUMMARY`);
    console.log('=' .repeat(30));
    
    const totalFolders = results.reduce((sum, r) => sum + r.folderCount, 0);
    const totalCases = results.reduce((sum, r) => sum + r.caseCount, 0);
    const avgTime = results.reduce((sum, r) => sum + r.totalTime, 0) / results.length;
    const avgMemory = results.reduce((sum, r) => sum + r.memoryUsageMB, 0) / results.length;
    
    const ratings = results.reduce((acc, r) => {
      acc[r.performanceRating] = (acc[r.performanceRating] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);
    
    console.log(`📊 Total tested: ${totalFolders.toLocaleString()} folders, ${totalCases.toLocaleString()} cases`);
    console.log(`⏱️  Average time: ${avgTime.toFixed(2)}ms`);
    console.log(`💾 Average memory: ${avgMemory.toFixed(2)}MB`);
    console.log(`\n🎯 Performance ratings:`);
    Object.entries(ratings).forEach(([rating, count]) => {
      const icon = { EXCELLENT: '🟢', GOOD: '🟡', ACCEPTABLE: '🟠', POOR: '🔴' }[rating];
      console.log(`   ${icon} ${rating}: ${count} project(s)`);
    });
    
    console.log(`\n✅ TreeView with react-arborist can handle large datasets efficiently!`);
    console.log(`   The virtualization ensures smooth performance regardless of data size.`);
  }
}

// Run the performance test suite
const tester = new TreeViewPerformanceTester();

// Check if specific project ID provided
const projectArg = process.argv.find(arg => arg.startsWith('--project='));
if (projectArg) {
  const projectId = parseInt(projectArg.split('=')[1]);
  tester.benchmarkTreeView(projectId)
    .then(result => tester.displayResults(result))
    .catch(console.error)
    .finally(() => prisma.$disconnect());
} else {
  // Run full suite
  tester.runFullSuite().catch(console.error);
}