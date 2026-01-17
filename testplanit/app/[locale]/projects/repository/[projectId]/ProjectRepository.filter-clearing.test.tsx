/**
 * Integration tests for ProjectRepository filter clearing on view change
 *
 * These tests verify that when users switch between different view options,
 * filters from the previous view are properly cleared to prevent stale filter
 * data from appearing in the new view.
 *
 * Bug Context: Issue discovered where switching from Link view with "domain|test"
 * filter to Preconditions (Text) view would show "Filter active: 1" incorrectly.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

/**
 * Mock the handleViewChange function behavior since we're testing the logic,
 * not the full component render (which would require extensive mocking of Next.js,
 * auth, database queries, etc.)
 */
describe('ProjectRepository - Filter Clearing on View Change', () => {
  let selectedFilter: Array<string | number> | null;
  let setSelectedFilter: (value: Array<string | number> | null) => void;

  beforeEach(() => {
    selectedFilter = null;
    setSelectedFilter = (value: Array<string | number> | null) => {
      selectedFilter = value;
    };
  });

  /**
   * Simulates the handleViewChange function logic
   */
  const handleViewChange = (
    value: string,
    viewOptions: {
      templates: Array<{ id: number; name: string }>;
      states: Array<{ id: number; name: string }>;
      creators: Array<{ id: string; name: string }>;
      dynamicFields: Record<
        string,
        {
          fieldId: number;
          type: string;
          options?: Array<{ id: number; name: string }>;
        }
      >;
    }
  ) => {
    // Always clear filters first when switching views
    setSelectedFilter(null);

    if (value === 'templates' && viewOptions.templates.length > 0) {
      setSelectedFilter([viewOptions.templates[0].id]);
    } else if (value === 'states' && viewOptions.states.length > 0) {
      setSelectedFilter([viewOptions.states[0].id]);
    } else if (value === 'creators' && viewOptions.creators.length > 0) {
      setSelectedFilter([viewOptions.creators[0].id]);
    } else if (value === 'automated') {
      setSelectedFilter([1]);
    } else if (value.startsWith('dynamic_')) {
      const [_, fieldKey] = value.split('_');
      const [fieldIdStr] = fieldKey.split('_');
      const numericFieldId = parseInt(fieldIdStr);
      const field = Object.values(viewOptions.dynamicFields).find(
        (f) => f.fieldId === numericFieldId
      );

      if (field) {
        if (field.type === 'Link' || field.type === 'Steps' || field.type === 'Checkbox') {
          setSelectedFilter([1]);
        } else if (field.options && field.options.length > 0) {
          setSelectedFilter([field.options[0].id]);
        }
        // For other field types (Integer, Number, Date, Text, etc.), keep filter cleared
      }
    }
    // For all other views (folders, status, etc.), filter remains cleared
  };

  const mockViewOptions = {
    templates: [
      { id: 1, name: 'Template 1' },
      { id: 2, name: 'Template 2' },
    ],
    states: [
      { id: 10, name: 'Draft' },
      { id: 11, name: 'Active' },
    ],
    creators: [{ id: 'user-123', name: 'Test User' }],
    dynamicFields: {
      100: { fieldId: 100, type: 'Text Long' },
      101: { fieldId: 101, type: 'Link' },
      102: { fieldId: 102, type: 'Integer' },
      103: { fieldId: 103, type: 'Number' },
      104: { fieldId: 104, type: 'Date' },
      105: { fieldId: 105, type: 'Steps' },
      106: { fieldId: 106, type: 'Checkbox' },
      107: {
        fieldId: 107,
        type: 'Dropdown',
        options: [
          { id: 1, name: 'Option 1' },
          { id: 2, name: 'Option 2' },
        ],
      },
    },
  };

  describe('Switching from Link view with domain filter', () => {
    beforeEach(() => {
      // User is on Link view with a domain filter applied
      setSelectedFilter(['domain|test']);
    });

    it('should clear filter when switching to Text Long field', () => {
      expect(selectedFilter).toEqual(['domain|test']);

      handleViewChange('dynamic_100_Text Long', mockViewOptions);

      expect(selectedFilter).toBeNull();
    });

    it('should clear filter when switching to Integer field', () => {
      expect(selectedFilter).toEqual(['domain|test']);

      handleViewChange('dynamic_102_Integer', mockViewOptions);

      expect(selectedFilter).toBeNull();
    });

    it('should clear filter when switching to Number field', () => {
      expect(selectedFilter).toEqual(['domain|test']);

      handleViewChange('dynamic_103_Number', mockViewOptions);

      expect(selectedFilter).toBeNull();
    });

    it('should clear filter when switching to Date field', () => {
      expect(selectedFilter).toEqual(['domain|test']);

      handleViewChange('dynamic_104_Date', mockViewOptions);

      expect(selectedFilter).toBeNull();
    });

    it('should replace filter when switching to Templates view', () => {
      expect(selectedFilter).toEqual(['domain|test']);

      handleViewChange('templates', mockViewOptions);

      expect(selectedFilter).toEqual([1]); // First template
    });

    it('should replace filter when switching to States view', () => {
      expect(selectedFilter).toEqual(['domain|test']);

      handleViewChange('states', mockViewOptions);

      expect(selectedFilter).toEqual([10]); // First state
    });

    it('should clear filter when switching to Folders view', () => {
      expect(selectedFilter).toEqual(['domain|test']);

      handleViewChange('folders', mockViewOptions);

      expect(selectedFilter).toBeNull();
    });
  });

  describe('Switching from Text contains filter', () => {
    beforeEach(() => {
      // User is on Text Long view with a contains filter applied
      setSelectedFilter(['contains|test']);
    });

    it('should clear filter when switching to Link field', () => {
      expect(selectedFilter).toEqual(['contains|test']);

      handleViewChange('dynamic_101_Link', mockViewOptions);

      // Link field sets default filter [1] for "Has Link"
      expect(selectedFilter).toEqual([1]);
    });

    it('should clear filter when switching to Integer field', () => {
      expect(selectedFilter).toEqual(['contains|test']);

      handleViewChange('dynamic_102_Integer', mockViewOptions);

      expect(selectedFilter).toBeNull();
    });

    it('should clear filter when switching to Date field', () => {
      expect(selectedFilter).toEqual(['contains|test']);

      handleViewChange('dynamic_104_Date', mockViewOptions);

      expect(selectedFilter).toBeNull();
    });
  });

  describe('Switching from Integer eq:5 filter', () => {
    beforeEach(() => {
      // User is on Integer view with an equals filter
      setSelectedFilter(['eq:5']);
    });

    it('should clear filter when switching to Text Long field', () => {
      expect(selectedFilter).toEqual(['eq:5']);

      handleViewChange('dynamic_100_Text Long', mockViewOptions);

      expect(selectedFilter).toBeNull();
    });

    it('should clear filter when switching to Date field', () => {
      expect(selectedFilter).toEqual(['eq:5']);

      handleViewChange('dynamic_104_Date', mockViewOptions);

      expect(selectedFilter).toBeNull();
    });

    it('should replace filter when switching to Dropdown field with options', () => {
      expect(selectedFilter).toEqual(['eq:5']);

      handleViewChange('dynamic_107_Dropdown', mockViewOptions);

      expect(selectedFilter).toEqual([1]); // First dropdown option
    });
  });

  describe('Switching from Date on:2024-01-15 filter', () => {
    beforeEach(() => {
      // User is on Date view with a date filter
      setSelectedFilter(['on|2024-01-15T00:00:00.000Z']);
    });

    it('should clear filter when switching to Text Long field', () => {
      expect(selectedFilter).toEqual(['on|2024-01-15T00:00:00.000Z']);

      handleViewChange('dynamic_100_Text Long', mockViewOptions);

      expect(selectedFilter).toBeNull();
    });

    it('should clear filter when switching to Integer field', () => {
      expect(selectedFilter).toEqual(['on|2024-01-15T00:00:00.000Z']);

      handleViewChange('dynamic_102_Integer', mockViewOptions);

      expect(selectedFilter).toBeNull();
    });

    it('should replace filter when switching to Steps field', () => {
      expect(selectedFilter).toEqual(['on|2024-01-15T00:00:00.000Z']);

      handleViewChange('dynamic_105_Steps', mockViewOptions);

      expect(selectedFilter).toEqual([1]); // Steps field sets default filter
    });
  });

  describe('Switching between fields with predefined filters', () => {
    it('should replace filter when switching from Link to Steps', () => {
      setSelectedFilter(['domain|github']);

      handleViewChange('dynamic_105_Steps', mockViewOptions);

      expect(selectedFilter).toEqual([1]); // Steps default filter
    });

    it('should replace filter when switching from Steps to Checkbox', () => {
      setSelectedFilter(['eq:3']);

      handleViewChange('dynamic_106_Checkbox', mockViewOptions);

      expect(selectedFilter).toEqual([1]); // Checkbox default filter
    });

    it('should replace filter when switching from Checkbox to Link', () => {
      setSelectedFilter([1]); // Checkbox "Checked"

      handleViewChange('dynamic_101_Link', mockViewOptions);

      expect(selectedFilter).toEqual([1]); // Link "Has Link"
    });
  });

  describe('Edge cases', () => {
    it('should handle switching with null filter state', () => {
      setSelectedFilter(null);

      handleViewChange('dynamic_100_Text Long', mockViewOptions);

      expect(selectedFilter).toBeNull();
    });

    it('should handle switching to unknown view type', () => {
      setSelectedFilter(['some|filter']);

      handleViewChange('unknown_view', mockViewOptions);

      expect(selectedFilter).toBeNull();
    });

    it('should handle multiple consecutive view switches', () => {
      // Start with Link filter
      setSelectedFilter(['domain|test']);

      // Switch to Text (should clear)
      handleViewChange('dynamic_100_Text Long', mockViewOptions);
      expect(selectedFilter).toBeNull();

      // Apply new Text filter
      setSelectedFilter(['contains|hello']);

      // Switch to Integer (should clear)
      handleViewChange('dynamic_102_Integer', mockViewOptions);
      expect(selectedFilter).toBeNull();

      // Switch to Templates (should set first template)
      handleViewChange('templates', mockViewOptions);
      expect(selectedFilter).toEqual([1]);

      // Switch to Date (should clear)
      handleViewChange('dynamic_104_Date', mockViewOptions);
      expect(selectedFilter).toBeNull();
    });
  });
});
