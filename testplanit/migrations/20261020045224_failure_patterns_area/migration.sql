-- Failure Patterns gets its own permission area (root cause, status,
-- notes, issue links and quarantine on failure patterns).

-- AlterEnum
ALTER TYPE "ApplicationArea" ADD VALUE 'FailurePatterns';
