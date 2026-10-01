-- schema.zmodel has carried the cs_CZ locale and the 8192 default for
-- LlmProviderConfig.defaultMaxTokens since the 1.0 graduation, but no
-- migration on the 1.0 line created either: a database built from these
-- migrations rejected the Czech locale and kept the old 2048 default.
--
-- Both statements are safe to re-run. The 1.1 line already ships them in
-- 20260822141712_requirements_hierarchy_and_optionality, so on a database
-- that has run that migration this one changes nothing.

-- AlterEnum
ALTER TYPE "Locale" ADD VALUE IF NOT EXISTS 'cs_CZ';

-- AlterTable
ALTER TABLE "LlmProviderConfig" ALTER COLUMN "defaultMaxTokens" SET DEFAULT 8192;
