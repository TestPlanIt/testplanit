import { describe, it, expect } from "vitest";

// Test the calculation logic directly
function calculateMilestoneProgress(milestones: Array<{ isStarted: boolean; isCompleted: boolean; isDeleted: boolean }>) {
  const nonDeleted = milestones.filter(m => !m.isDeleted);
  if (nonDeleted.length === 0) return 0;
  
  const withProgress = nonDeleted.filter(m => m.isStarted || m.isCompleted).length;
  return (withProgress / nonDeleted.length) * 100;
}

function calculateCompletionRate(milestones: Array<{ isStarted: boolean; isCompleted: boolean; isDeleted: boolean }>) {
  const nonDeleted = milestones.filter(m => !m.isDeleted);
  if (nonDeleted.length === 0) return 0;
  
  const completed = nonDeleted.filter(m => m.isCompleted).length;
  return (completed / nonDeleted.length) * 100;
}

function calculateActiveMilestones(milestones: Array<{ isStarted: boolean; isCompleted: boolean; isDeleted: boolean }>) {
  return milestones.filter(m => !m.isDeleted && m.isStarted && !m.isCompleted).length;
}

describe("Milestone Calculations", () => {
  describe("Property-based tests", () => {
    it("milestone progress should never exceed 100%", () => {
      // Generate random test cases
      for (let i = 0; i < 100; i++) {
        const milestones = Array.from({ length: Math.floor(Math.random() * 20) + 1 }, () => ({
          isStarted: Math.random() > 0.5,
          isCompleted: Math.random() > 0.5,
          isDeleted: Math.random() > 0.8, // 20% chance of being deleted
        }));
        
        const progress = calculateMilestoneProgress(milestones);
        expect(progress).toBeGreaterThanOrEqual(0);
        expect(progress).toBeLessThanOrEqual(100);
      }
    });

    it("completion rate should never exceed milestone progress", () => {
      for (let i = 0; i < 100; i++) {
        const milestones = Array.from({ length: Math.floor(Math.random() * 20) + 1 }, () => ({
          isStarted: Math.random() > 0.5,
          isCompleted: Math.random() > 0.5,
          isDeleted: Math.random() > 0.8,
        }));
        
        const progress = calculateMilestoneProgress(milestones);
        const completion = calculateCompletionRate(milestones);
        
        // Completion can't be higher than progress
        expect(completion).toBeLessThanOrEqual(progress);
      }
    });

    it("active milestones should be consistent with calculations", () => {
      for (let i = 0; i < 100; i++) {
        const milestones = Array.from({ length: Math.floor(Math.random() * 20) + 1 }, () => ({
          isStarted: Math.random() > 0.5,
          isCompleted: Math.random() > 0.5,
          isDeleted: Math.random() > 0.8,
        }));
        
        const active = calculateActiveMilestones(milestones);
        const nonDeleted = milestones.filter(m => !m.isDeleted);
        const withProgress = nonDeleted.filter(m => m.isStarted || m.isCompleted).length;
        const completed = nonDeleted.filter(m => m.isCompleted).length;
        
        // Active + Completed should be <= milestones with progress
        expect(active + completed).toBeLessThanOrEqual(withProgress);
      }
    });
  });

  describe("Specific edge cases that caused bugs", () => {
    it("should handle all milestones being started and completed (200% bug)", () => {
      const milestones = [
        { isStarted: true, isCompleted: true, isDeleted: false },
        { isStarted: true, isCompleted: true, isDeleted: false },
        { isStarted: true, isCompleted: true, isDeleted: false },
      ];
      
      const progress = calculateMilestoneProgress(milestones);
      expect(progress).toBe(100); // NOT 200!
    });

    it("should handle milestone completed but not started", () => {
      const milestones = [
        { isStarted: false, isCompleted: true, isDeleted: false },
      ];
      
      const progress = calculateMilestoneProgress(milestones);
      const completion = calculateCompletionRate(milestones);
      const active = calculateActiveMilestones(milestones);
      
      expect(progress).toBe(100); // Has progress because it's completed
      expect(completion).toBe(100);
      expect(active).toBe(0); // Not active because not started
    });

    it("should handle all deleted milestones", () => {
      const milestones = [
        { isStarted: true, isCompleted: true, isDeleted: true },
        { isStarted: true, isCompleted: true, isDeleted: true },
      ];
      
      const progress = calculateMilestoneProgress(milestones);
      const completion = calculateCompletionRate(milestones);
      
      expect(progress).toBe(0); // No non-deleted milestones
      expect(completion).toBe(0);
    });

    it("should handle empty milestone array", () => {
      const milestones: any[] = [];
      
      const progress = calculateMilestoneProgress(milestones);
      const completion = calculateCompletionRate(milestones);
      const active = calculateActiveMilestones(milestones);
      
      expect(progress).toBe(0);
      expect(completion).toBe(0);
      expect(active).toBe(0);
    });
  });

  describe("Mathematical invariants", () => {
    it("should maintain mathematical relationships", () => {
      const testCases = [
        // All not started
        [
          { isStarted: false, isCompleted: false, isDeleted: false },
          { isStarted: false, isCompleted: false, isDeleted: false },
        ],
        // Mix of states
        [
          { isStarted: false, isCompleted: false, isDeleted: false },
          { isStarted: true, isCompleted: false, isDeleted: false },
          { isStarted: true, isCompleted: true, isDeleted: false },
          { isStarted: false, isCompleted: true, isDeleted: false },
        ],
        // All completed
        [
          { isStarted: true, isCompleted: true, isDeleted: false },
          { isStarted: true, isCompleted: true, isDeleted: false },
        ],
      ];

      for (const milestones of testCases) {
        const nonDeleted = milestones.filter(m => !m.isDeleted).length;
        const progress = calculateMilestoneProgress(milestones);
        const completion = calculateCompletionRate(milestones);
        const active = calculateActiveMilestones(milestones);
        
        // Convert percentages back to counts
        const progressCount = Math.round((progress / 100) * nonDeleted);
        const completedCount = Math.round((completion / 100) * nonDeleted);
        
        // Invariant: active + completed <= milestones with progress
        expect(active + completedCount).toBeLessThanOrEqual(progressCount + 1); // +1 for rounding
      }
    });
  });
});