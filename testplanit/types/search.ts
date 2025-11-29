/**
 * Unified search types for multi-entity search functionality
 */

export enum SearchableEntityType {
  REPOSITORY_CASE = 'repository_case',
  SHARED_STEP = 'shared_step',
  TEST_RUN = 'test_run',
  SESSION = 'session',
  PROJECT = 'project',
  ISSUE = 'issue',
  MILESTONE = 'milestone'
}

export type CustomFieldOperator = 
  | 'equals' 
  | 'not_equals'
  | 'contains' 
  | 'not_contains'
  | 'starts_with'
  | 'ends_with'
  | 'gt' 
  | 'lt' 
  | 'gte'
  | 'lte'
  | 'between' 
  | 'in' 
  | 'not_in'
  | 'exists'
  | 'not_exists';

export interface CustomFieldFilter {
  fieldId: number;
  fieldName: string;
  fieldType: string; // Checkbox, Date, Multi-Select, Select, Number, Text String, Text Long, Link, Steps
  operator: CustomFieldOperator;
  value: any;
  value2?: any; // For 'between' operator
}

export interface BaseEntityFilters {
  projectIds?: number[];
  creatorIds?: string[];
  tagIds?: number[];
  stateIds?: number[];
  includeDeleted?: boolean;
  dateRange?: {
    field: 'createdAt' | 'updatedAt' | 'completedAt';
    from?: Date;
    to?: Date;
  };
}

export interface RepositoryCaseFilters extends BaseEntityFilters {
  repositoryIds?: number[];
  folderIds?: number[];
  templateIds?: number[];
  automated?: boolean;
  isArchived?: boolean;
  customFields?: CustomFieldFilter[];
  source?: string[];
  estimateRange?: {
    min?: number;
    max?: number;
  };
}

export interface TestRunFilters extends BaseEntityFilters {
  configurationIds?: number[];
  milestoneIds?: number[];
  isCompleted?: boolean;
  testRunType?: 'REGULAR' | 'JUNIT';
  customFields?: CustomFieldFilter[];
  elapsedRange?: {
    min?: number;
    max?: number;
  };
}

export interface SessionFilters extends BaseEntityFilters {
  templateIds?: number[];
  assignedToIds?: string[];
  configurationIds?: number[];
  milestoneIds?: number[];
  isCompleted?: boolean;
  customFields?: CustomFieldFilter[];
  elapsedRange?: {
    min?: number;
    max?: number;
  };
  estimateRange?: {
    min?: number;
    max?: number;
  };
}

export interface SharedStepFilters extends BaseEntityFilters {
  projectIds: number[]; // Required for shared steps
}

export interface ProjectFilters {
  creatorIds?: string[];
  isDeleted?: boolean;
  dateRange?: {
    field: 'createdAt' | 'updatedAt';
    from?: Date;
    to?: Date;
  };
}

export interface IssueFilters extends BaseEntityFilters {
  externalIds?: string[];
  hasExternalId?: boolean;
}

export interface MilestoneFilters extends BaseEntityFilters {
  milestoneTypeIds?: number[];
  parentIds?: number[];
  isCompleted?: boolean;
  dueDateRange?: {
    from?: Date;
    to?: Date;
  };
  hasParent?: boolean;
}

export interface UnifiedSearchFilters {
  // Global filters
  entityTypes?: SearchableEntityType[];
  query?: string;
  includeDeleted?: boolean;
  
  // Entity-specific filters
  repositoryCase?: RepositoryCaseFilters;
  testRun?: TestRunFilters;
  session?: SessionFilters;
  sharedStep?: SharedStepFilters;
  project?: ProjectFilters;
  issue?: IssueFilters;
  milestone?: MilestoneFilters;
}

export interface SearchOptions {
  filters: UnifiedSearchFilters;
  sort?: {
    field: string;
    order: 'asc' | 'desc';
  }[];
  pagination?: {
    page: number;
    size: number;
  };
  highlight?: boolean;
  facets?: string[];
}

export interface SearchHit {
  id: string | number;
  entityType: SearchableEntityType;
  score: number;
  source: any;
  highlights?: Record<string, string[]>;
}

export interface SearchFacetBucket {
  key: any;
  count: number;
  doc_count?: number; // Elasticsearch uses doc_count
  label?: string; // Optional display label
}

export interface SearchFacet {
  field: string;
  buckets: SearchFacetBucket[];
}

export interface UnifiedSearchResult {
  total: number;
  hits: SearchHit[];
  facets?: Record<string, SearchFacet>;
  took: number;
  entityTypeCounts?: Record<SearchableEntityType, number>;
}

export interface SearchContext {
  currentEntity: SearchableEntityType | null;
  projectId: number | null;
  defaultFilters: UnifiedSearchFilters;
  availableEntities: SearchableEntityType[];
  isGlobalSearch: boolean;
}

// Custom field document structure for Elasticsearch
export interface CustomFieldDocument {
  fieldId: number;
  fieldName: string;
  fieldType: string;
  value?: string; // Text representation for full-text search
  valueKeyword?: string; // Exact match for keyword fields
  valueNumeric?: number; // For numeric fields
  valueBoolean?: boolean; // For checkbox fields
  valueDate?: string; // ISO date string
  valueArray?: (string | number)[]; // For multi-select fields
  fieldOption?: {
    id: number;
    name: string;
    icon?: { name: string };
    iconColor?: { value: string };
  };
  fieldOptions?: Array<{
    id: number;
    name: string;
    icon?: { name: string };
    iconColor?: { value: string };
  }>;
}