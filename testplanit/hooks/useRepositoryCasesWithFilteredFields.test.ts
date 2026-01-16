import { describe, it, expect } from 'vitest';
import {
  filterOrphanedFieldValues,
  matchesTextOperator,
  matchesLinkOperator,
  matchesStepsOperator,
} from './useRepositoryCasesWithFilteredFields';

describe('useRepositoryCasesWithFilteredFields', () => {
  describe('filterOrphanedFieldValues', () => {
    it('should filter out field values not in template', () => {
      const testCase = {
        template: {
          caseFields: [
            { caseField: { id: 1 } },
            { caseField: { id: 2 } },
          ],
        },
        caseFieldValues: [
          { fieldId: 1, value: 'value1' },
          { fieldId: 2, value: 'value2' },
          { fieldId: 3, value: 'orphaned' }, // This should be filtered out
        ],
      };

      const result = filterOrphanedFieldValues(testCase);

      expect(result.caseFieldValues).toHaveLength(2);
      expect(result.caseFieldValues?.map((cfv: any) => cfv.fieldId)).toEqual([1, 2]);
    });

    it('should return unchanged if no template', () => {
      const testCase = {
        caseFieldValues: [
          { fieldId: 1, value: 'value1' },
        ],
      };

      const result = filterOrphanedFieldValues(testCase);

      expect(result).toEqual(testCase);
    });

    it('should return unchanged if no caseFieldValues', () => {
      const testCase = {
        template: {
          caseFields: [
            { caseField: { id: 1 } },
          ],
        },
      };

      const result = filterOrphanedFieldValues(testCase);

      expect(result).toEqual(testCase);
    });
  });

  describe('matchesTextOperator', () => {
    describe('plain text values', () => {
      it('should match with contains operator', () => {
        expect(matchesTextOperator('Hello World', 'contains', 'world')).toBe(true);
        expect(matchesTextOperator('Hello World', 'contains', 'foo')).toBe(false);
      });

      it('should match with startsWith operator', () => {
        expect(matchesTextOperator('Hello World', 'startsWith', 'hello')).toBe(true);
        expect(matchesTextOperator('Hello World', 'startsWith', 'world')).toBe(false);
      });

      it('should match with endsWith operator', () => {
        expect(matchesTextOperator('Hello World', 'endsWith', 'world')).toBe(true);
        expect(matchesTextOperator('Hello World', 'endsWith', 'hello')).toBe(false);
      });

      it('should match with equals operator', () => {
        expect(matchesTextOperator('Hello World', 'equals', 'hello world')).toBe(true);
        expect(matchesTextOperator('Hello World', 'equals', 'Hello')).toBe(false);
      });

      it('should match with notContains operator', () => {
        expect(matchesTextOperator('Hello World', 'notContains', 'foo')).toBe(true);
        expect(matchesTextOperator('Hello World', 'notContains', 'world')).toBe(false);
      });

      it('should be case insensitive', () => {
        expect(matchesTextOperator('HELLO WORLD', 'contains', 'world')).toBe(true);
        expect(matchesTextOperator('hello world', 'contains', 'WORLD')).toBe(true);
      });
    });

    describe('TipTap JSON documents', () => {
      it('should extract and match text from TipTap document', () => {
        const tiptapDoc = {
          type: 'doc',
          content: [
            {
              type: 'paragraph',
              content: [{ type: 'text', text: 'Hello World' }],
            },
          ],
        };

        expect(matchesTextOperator(tiptapDoc, 'contains', 'world')).toBe(true);
        expect(matchesTextOperator(tiptapDoc, 'contains', 'foo')).toBe(false);
      });

      it('should handle empty TipTap documents', () => {
        const emptyDoc = {
          type: 'doc',
          content: [],
        };

        expect(matchesTextOperator(emptyDoc, 'contains', 'test')).toBe(false);
      });
    });

    describe('edge cases', () => {
      it('should return false for null/undefined values', () => {
        expect(matchesTextOperator(null, 'contains', 'test')).toBe(false);
        expect(matchesTextOperator(undefined, 'contains', 'test')).toBe(false);
      });

      it('should return false for non-string/non-object values', () => {
        expect(matchesTextOperator(123, 'contains', 'test')).toBe(false);
        expect(matchesTextOperator(true, 'contains', 'test')).toBe(false);
      });

      it('should return false for unknown operators', () => {
        expect(matchesTextOperator('Hello', 'unknownOp', 'test')).toBe(false);
      });
    });
  });

  describe('matchesLinkOperator', () => {
    it('should match with contains operator', () => {
      expect(matchesLinkOperator('https://github.com/user/repo', 'contains', 'github')).toBe(true);
      expect(matchesLinkOperator('https://github.com/user/repo', 'contains', 'gitlab')).toBe(false);
    });

    it('should match with startsWith operator', () => {
      expect(matchesLinkOperator('https://github.com/user/repo', 'startsWith', 'https')).toBe(true);
      expect(matchesLinkOperator('https://github.com/user/repo', 'startsWith', 'http://')).toBe(false);
    });

    it('should match with endsWith operator', () => {
      expect(matchesLinkOperator('https://github.com/user/repo', 'endsWith', 'repo')).toBe(true);
      expect(matchesLinkOperator('https://github.com/user/repo', 'endsWith', 'user')).toBe(false);
    });

    it('should match with equals operator', () => {
      expect(matchesLinkOperator('https://github.com', 'equals', 'https://github.com')).toBe(true);
      expect(matchesLinkOperator('https://github.com', 'equals', 'https://gitlab.com')).toBe(false);
    });

    it('should match domain with valid URLs', () => {
      expect(matchesLinkOperator('https://github.com/user/repo', 'domain', 'github.com')).toBe(true);
      expect(matchesLinkOperator('https://api.github.com/repos', 'domain', 'github.com')).toBe(true);
      expect(matchesLinkOperator('https://github.com', 'domain', 'gitlab.com')).toBe(false);
    });

    it('should match domain with URLs without protocol', () => {
      expect(matchesLinkOperator('github.com/user/repo', 'domain', 'github.com')).toBe(true);
    });

    it('should be case insensitive', () => {
      expect(matchesLinkOperator('HTTPS://GITHUB.COM', 'contains', 'github')).toBe(true);
      expect(matchesLinkOperator('https://github.com', 'contains', 'GITHUB')).toBe(true);
    });

    describe('edge cases', () => {
      it('should return false for null/undefined values', () => {
        expect(matchesLinkOperator(null, 'contains', 'test')).toBe(false);
        expect(matchesLinkOperator(undefined, 'contains', 'test')).toBe(false);
      });

      it('should return false for non-string values', () => {
        expect(matchesLinkOperator(123, 'contains', 'test')).toBe(false);
        expect(matchesLinkOperator({}, 'contains', 'test')).toBe(false);
      });

      it('should return false for unknown operators', () => {
        expect(matchesLinkOperator('https://github.com', 'unknownOp', 'test')).toBe(false);
      });
    });
  });

  describe('matchesStepsOperator', () => {
    const createTestCaseWithSteps = (stepCount: number) => ({
      steps: Array.from({ length: stepCount }, (_, i) => ({ id: i + 1, order: i + 1 })),
    });

    describe('eq operator', () => {
      it('should match when step count equals target', () => {
        expect(matchesStepsOperator(createTestCaseWithSteps(5), 'eq', 5)).toBe(true);
        expect(matchesStepsOperator(createTestCaseWithSteps(5), 'eq', 3)).toBe(false);
      });
    });

    describe('lt operator', () => {
      it('should match when step count is less than target', () => {
        expect(matchesStepsOperator(createTestCaseWithSteps(3), 'lt', 5)).toBe(true);
        expect(matchesStepsOperator(createTestCaseWithSteps(5), 'lt', 5)).toBe(false);
        expect(matchesStepsOperator(createTestCaseWithSteps(7), 'lt', 5)).toBe(false);
      });
    });

    describe('lte operator', () => {
      it('should match when step count is less than or equal to target', () => {
        expect(matchesStepsOperator(createTestCaseWithSteps(3), 'lte', 5)).toBe(true);
        expect(matchesStepsOperator(createTestCaseWithSteps(5), 'lte', 5)).toBe(true);
        expect(matchesStepsOperator(createTestCaseWithSteps(7), 'lte', 5)).toBe(false);
      });
    });

    describe('gt operator', () => {
      it('should match when step count is greater than target', () => {
        expect(matchesStepsOperator(createTestCaseWithSteps(7), 'gt', 5)).toBe(true);
        expect(matchesStepsOperator(createTestCaseWithSteps(5), 'gt', 5)).toBe(false);
        expect(matchesStepsOperator(createTestCaseWithSteps(3), 'gt', 5)).toBe(false);
      });
    });

    describe('gte operator', () => {
      it('should match when step count is greater than or equal to target', () => {
        expect(matchesStepsOperator(createTestCaseWithSteps(7), 'gte', 5)).toBe(true);
        expect(matchesStepsOperator(createTestCaseWithSteps(5), 'gte', 5)).toBe(true);
        expect(matchesStepsOperator(createTestCaseWithSteps(3), 'gte', 5)).toBe(false);
      });
    });

    describe('between operator', () => {
      it('should match when step count is within range', () => {
        expect(matchesStepsOperator(createTestCaseWithSteps(5), 'between', 3, 7)).toBe(true);
        expect(matchesStepsOperator(createTestCaseWithSteps(3), 'between', 3, 7)).toBe(true);
        expect(matchesStepsOperator(createTestCaseWithSteps(7), 'between', 3, 7)).toBe(true);
        expect(matchesStepsOperator(createTestCaseWithSteps(2), 'between', 3, 7)).toBe(false);
        expect(matchesStepsOperator(createTestCaseWithSteps(8), 'between', 3, 7)).toBe(false);
      });

      it('should return false if count2 is undefined', () => {
        expect(matchesStepsOperator(createTestCaseWithSteps(5), 'between', 3, undefined)).toBe(false);
      });
    });

    describe('edge cases', () => {
      it('should return false for test cases without steps array', () => {
        expect(matchesStepsOperator({}, 'eq', 5)).toBe(false);
        expect(matchesStepsOperator({ steps: null }, 'eq', 5)).toBe(false);
        expect(matchesStepsOperator({ steps: 'not-an-array' }, 'eq', 5)).toBe(false);
      });

      it('should handle zero steps', () => {
        expect(matchesStepsOperator(createTestCaseWithSteps(0), 'eq', 0)).toBe(true);
        expect(matchesStepsOperator(createTestCaseWithSteps(0), 'gt', 0)).toBe(false);
        expect(matchesStepsOperator(createTestCaseWithSteps(0), 'lt', 1)).toBe(true);
      });

      it('should return false for unknown operators', () => {
        expect(matchesStepsOperator(createTestCaseWithSteps(5), 'unknownOp', 5)).toBe(false);
      });
    });
  });
});
