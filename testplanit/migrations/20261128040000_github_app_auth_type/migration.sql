-- A GitHub integration can authenticate as a GitHub App installation.

-- AlterEnum
ALTER TYPE "IntegrationAuthType" ADD VALUE 'GITHUB_APP';
