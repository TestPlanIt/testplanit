-- Staged-case provenance.
--
-- RepositoryCases.stagedAt: when the case was staged (CaseDraft.createdAt) for a case created
-- from a staged case, null otherwise. CDC already audits this table, so the value appears in the
-- case's CREATE audit entry with no further plumbing.
--
-- CaseDraft gains the soft-delete triple. A saved draft is retired instead of deleted: creating
-- the case sets isDeleted with caseId pointing at the case (provenance, kept), deleting it from
-- the list sets isDeleted with caseId null (discarded, purged by the draft retention job). The
-- tpl_stamp_deleted_at_casedraft trigger is attached by scripts/apply-triggers.ts, not here.

-- AlterTable
ALTER TABLE "RepositoryCases" ADD COLUMN     "stagedAt" TIMESTAMPTZ(6);

-- AlterTable
ALTER TABLE "CaseDraft" ADD COLUMN     "isDeleted" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "deletedAt" TIMESTAMPTZ(6),
ADD COLUMN     "deletedById" TEXT;
