-- Saved repository views are stored as ShareLink rows: the filter predicates,
-- grouping axis and search live in `entityConfig`, the same way saved unified
-- searches use the SEARCH type.
ALTER TYPE "ShareLinkEntityType" ADD VALUE 'REPOSITORY_VIEW';
