-- CreateEnum
CREATE TYPE "IdpName" AS ENUM ('OKTA', 'ENTRA', 'ONELOGIN', 'OTHER');

-- CreateEnum
CREATE TYPE "Theme" AS ENUM ('Light', 'Dark', 'System', 'Green', 'Orange', 'Purple', 'Accessible');

-- CreateEnum
CREATE TYPE "ItemsPerPage" AS ENUM ('10', '25', '50', '100', '250');

-- CreateEnum
CREATE TYPE "Locale" AS ENUM ('en_US', 'es_ES', 'de_DE', 'fr_FR', 'it_IT', 'nl_NL', 'pl_PL', 'pt_BR', 'tr_TR', 'vi_VN', 'ru_RU', 'zh_CN', 'zh_TW', 'ja_JP', 'ko_KR');

-- CreateEnum
CREATE TYPE "DateFormat" AS ENUM ('MM_DD_YYYY_SLASH', 'MM_DD_YYYY_DASH', 'DD_MM_YYYY_SLASH', 'DD_MM_YYYY_DASH', 'YYYY_MM_DD', 'MMM_D_YYYY', 'D_MMM_YYYY');

-- CreateEnum
CREATE TYPE "TimeFormat" AS ENUM ('HH_MM', 'HH_MM_A', 'HH_MM_Z', 'HH_MM_Z_A');

-- CreateEnum
CREATE TYPE "Access" AS ENUM ('NONE', 'USER', 'PROJECTADMIN', 'ADMIN');

-- CreateEnum
CREATE TYPE "AccessSource" AS ENUM ('MANUAL', 'GROUP_MAPPING');

-- CreateEnum
CREATE TYPE "NotificationMode" AS ENUM ('NONE', 'IN_APP', 'IN_APP_EMAIL_IMMEDIATE', 'IN_APP_EMAIL_DAILY', 'USE_GLOBAL');

-- CreateEnum
CREATE TYPE "NotificationType" AS ENUM ('WORK_ASSIGNED', 'SESSION_ASSIGNED', 'SYSTEM_ANNOUNCEMENT', 'USER_REGISTERED', 'COMMENT_MENTION', 'MILESTONE_DUE_REMINDER', 'SHARE_LINK_ACCESSED', 'LLM_BUDGET_ALERT', 'COPY_MOVE_COMPLETE', 'GENERATE_FROM_URL_COMPLETE', 'REVIEW_REQUESTED', 'REVIEW_APPROVED', 'REVIEW_CHANGES_REQUESTED', 'REVIEW_REJECTED', 'REVIEW_CANCELLED', 'REVIEW_REMINDER', 'AI_STEPS_DERIVED');

-- CreateEnum
CREATE TYPE "WorkflowType" AS ENUM ('NOT_STARTED', 'IN_PROGRESS', 'DONE');

-- CreateEnum
CREATE TYPE "WorkflowScope" AS ENUM ('CASES', 'RUNS', 'SESSIONS');

-- CreateEnum
CREATE TYPE "RepositoryCaseSource" AS ENUM ('MANUAL', 'JUNIT', 'TESTNG', 'XUNIT', 'NUNIT', 'MSTEST', 'MOCHA', 'CUCUMBER', 'API');

-- CreateEnum
CREATE TYPE "LinkType" AS ENUM ('SAME_TEST_DIFFERENT_SOURCE', 'DEPENDS_ON', 'DUPLICATED_FROM');

-- CreateEnum
CREATE TYPE "DuplicateScanResultStatus" AS ENUM ('PENDING', 'MERGED', 'LINKED', 'DISMISSED');

-- CreateEnum
CREATE TYPE "StepSequenceMatchStatus" AS ENUM ('PENDING', 'CONVERTED', 'DISMISSED');

-- CreateEnum
CREATE TYPE "ParameterType" AS ENUM ('STRING', 'INTEGER', 'BOOLEAN', 'SELECT');

-- CreateEnum
CREATE TYPE "TestRunType" AS ENUM ('REGULAR', 'JUNIT', 'TESTNG', 'XUNIT', 'NUNIT', 'MSTEST', 'MOCHA', 'CUCUMBER');

-- CreateEnum
CREATE TYPE "IntegrationProvider" AS ENUM ('JIRA', 'GITHUB', 'AZURE_DEVOPS', 'SIMPLE_URL', 'GITLAB', 'GITEA', 'REDMINE', 'MANTISBT');

-- CreateEnum
CREATE TYPE "AdapterType" AS ENUM ('JIRA', 'GITHUB', 'AZURE_DEVOPS', 'SLACK', 'GENERIC_HMAC', 'GITLAB', 'GITEA', 'REDMINE', 'MANTISBT');

-- CreateEnum
CREATE TYPE "WebhookDirection" AS ENUM ('INBOUND', 'OUTBOUND');

-- CreateEnum
CREATE TYPE "EndpointHealth" AS ENUM ('HEALTHY', 'DEGRADED', 'DISABLED');

-- CreateEnum
CREATE TYPE "LlmProvider" AS ENUM ('OPENAI', 'ANTHROPIC', 'AZURE_OPENAI', 'GEMINI', 'OLLAMA', 'CUSTOM_LLM');

-- CreateEnum
CREATE TYPE "IntegrationAuthType" AS ENUM ('NONE', 'OAUTH2', 'PERSONAL_ACCESS_TOKEN', 'API_KEY');

-- CreateEnum
CREATE TYPE "IntegrationStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'ERROR');

-- CreateEnum
CREATE TYPE "CodeRepositoryProvider" AS ENUM ('GITHUB', 'GITLAB', 'BITBUCKET', 'AZURE_DEVOPS', 'GITEA');

-- CreateEnum
CREATE TYPE "ApplicationArea" AS ENUM ('Documentation', 'Milestones', 'TestCaseRepository', 'TestCaseRestrictedFields', 'TestRuns', 'ClosedTestRuns', 'TestRunResults', 'TestRunResultRestrictedFields', 'Sessions', 'SessionsRestrictedFields', 'ClosedSessions', 'SessionResults', 'Tags', 'SharedSteps', 'Issues', 'IssueIntegration', 'Forecasting', 'Reporting', 'Settings');

-- CreateEnum
CREATE TYPE "ProjectAccessType" AS ENUM ('DEFAULT', 'NO_ACCESS', 'GLOBAL_ROLE', 'SPECIFIC_ROLE');

-- CreateEnum
CREATE TYPE "JUnitResultType" AS ENUM ('PASSED', 'FAILURE', 'ERROR', 'SKIPPED');

-- CreateEnum
CREATE TYPE "JUnitAttachmentType" AS ENUM ('FILE', 'URL', 'INLINE');

-- CreateEnum
CREATE TYPE "ReviewStatus" AS ENUM ('PENDING', 'APPROVED', 'CHANGES_REQUESTED', 'REJECTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ReviewEntityType" AS ENUM ('CASE', 'RUN', 'SESSION');

-- CreateEnum
CREATE TYPE "CommentType" AS ENUM ('GENERAL', 'REVIEW_REQUEST', 'REVIEW_DECISION');

-- CreateEnum
CREATE TYPE "ShareLinkMode" AS ENUM ('AUTHENTICATED', 'PUBLIC', 'PASSWORD_PROTECTED');

-- CreateEnum
CREATE TYPE "ShareLinkEntityType" AS ENUM ('REPORT', 'TEST_CASE', 'TEST_RUN', 'SESSION', 'DASHBOARD', 'SEARCH');

-- CreateEnum
CREATE TYPE "SsoProviderType" AS ENUM ('GOOGLE', 'SAML', 'APPLE', 'MAGIC_LINK', 'MICROSOFT');

-- CreateEnum
CREATE TYPE "AuthMethod" AS ENUM ('INTERNAL', 'SSO', 'BOTH', 'SCIM');

-- CreateEnum
CREATE TYPE "TestmoImportStatus" AS ENUM ('QUEUED', 'RUNNING', 'READY', 'COMPLETED', 'FAILED', 'CANCELED');

-- CreateEnum
CREATE TYPE "TestmoImportPhase" AS ENUM ('UPLOADING', 'ANALYZING', 'CONFIGURING', 'IMPORTING', 'FINALIZING');

-- CreateEnum
CREATE TYPE "AuditAction" AS ENUM ('CREATE', 'UPDATE', 'DELETE', 'BULK_CREATE', 'BULK_UPDATE', 'BULK_DELETE', 'LOGIN', 'LOGOUT', 'LOGIN_FAILED', 'SESSION_INVALIDATED', 'PASSWORD_CHANGED', 'PASSWORD_RESET', 'PERMISSION_GRANT', 'PERMISSION_REVOKE', 'ROLE_CHANGED', 'API_KEY_CREATED', 'API_KEY_DELETED', 'API_KEY_REGENERATED', 'API_KEY_REVOKED', 'DATA_EXPORTED', 'SSO_CONFIG_CHANGED', 'SYSTEM_CONFIG_CHANGED', 'SHARE_LINK_CREATED', 'SHARE_LINK_ACCESSED', 'SHARE_LINK_REVOKED', 'DUPLICATE_RESOLVED', 'IMPORT_STARTED', 'MAGIC_LINK_REQUESTED', 'SHARE_LINK_PASSWORD_VERIFY', 'TWO_FACTOR_CODES_REGENERATED', 'TWO_FACTOR_ENABLED', 'TWO_FACTOR_SETUP_REQUIRED', 'TWO_FACTOR_VERIFIED', 'ACCOUNT_LOCKED', 'ACCOUNT_UNLOCKED', 'PASSWORD_POLICY_CHANGED', 'FORCE_PASSWORD_CHANGE', 'PASSWORD_REVOKED', 'WEBHOOK_RECEIVED', 'WEBHOOK_DISPATCHED', 'WEBHOOK_REPLAYED', 'WEBHOOK_HEALTH_CHANGED', 'WEBHOOK_RETENTION_PURGED', 'DCL_RETENTION_PURGED', 'DUPLICATED', 'ITERATION_VALUES_OVERRIDDEN', 'ITERATION_BULK_SKIPPED', 'ITERATION_RESULT_RECORDED', 'REVIEW_REQUESTED', 'REVIEW_APPROVED', 'REVIEW_CHANGES_REQUESTED', 'REVIEW_REJECTED', 'REVIEW_CANCELLED', 'REVIEW_REMINDED');

-- CreateTable
CREATE TABLE "AppConfig" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,

    CONSTRAINT "AppConfig_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "Account" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "providerAccountId" TEXT NOT NULL,
    "refresh_token" TEXT,
    "access_token" TEXT,
    "expires_at" INTEGER,
    "token_type" TEXT,
    "scope" TEXT,
    "id_token" TEXT,
    "session_state" TEXT,

    CONSTRAINT "Account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VerificationToken" (
    "identifier" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "expires" TIMESTAMP(3) NOT NULL
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "emailVerified" TIMESTAMP(3),
    "emailVerifToken" TEXT,
    "emailTokenExpires" TIMESTAMP(3),
    "password" TEXT,
    "image" TEXT,
    "authMethod" "AuthMethod" NOT NULL DEFAULT 'INTERNAL',
    "externalId" TEXT,
    "scimUserName" TEXT,
    "scimExternalId" TEXT,
    "scimExtensions" JSONB,
    "scimGivenName" TEXT,
    "scimFamilyName" TEXT,
    "access" "Access" NOT NULL DEFAULT 'NONE',
    "accessSource" "AccessSource" NOT NULL DEFAULT 'MANUAL',
    "roleId" INTEGER NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,
    "isApi" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "lastActiveAt" TIMESTAMP(3),
    "lastSeenVersion" TEXT,
    "twoFactorEnabled" BOOLEAN NOT NULL DEFAULT false,
    "twoFactorSecret" TEXT,
    "twoFactorBackupCodes" TEXT,
    "failedLoginAttempts" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" TIMESTAMPTZ(6),
    "passwordChangedAt" TIMESTAMPTZ(6),
    "mustChangePassword" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PasswordHistory" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "hash" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PasswordHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserPreferences" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "theme" "Theme" NOT NULL DEFAULT 'Purple',
    "itemsPerPage" "ItemsPerPage" NOT NULL DEFAULT '10',
    "locale" "Locale" NOT NULL DEFAULT 'en_US',
    "dateFormat" "DateFormat" NOT NULL DEFAULT 'MM_DD_YYYY_DASH',
    "timeFormat" "TimeFormat" NOT NULL DEFAULT 'HH_MM_A',
    "timezone" TEXT NOT NULL DEFAULT 'Etc/UTC',
    "notificationMode" "NotificationMode" NOT NULL DEFAULT 'USE_GLOBAL',
    "emailNotifications" BOOLEAN NOT NULL DEFAULT true,
    "inAppNotifications" BOOLEAN NOT NULL DEFAULT true,
    "hasCompletedWelcomeTour" BOOLEAN NOT NULL DEFAULT false,
    "hasCompletedInitialPreferencesSetup" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "UserPreferences_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApiToken" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "tokenPrefix" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "scopes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "expiresAt" TIMESTAMP(3),
    "lastUsedAt" TIMESTAMP(3),
    "lastUsedIp" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "ApiToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScimToken" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "idpName" "IdpName" NOT NULL,
    "token" TEXT NOT NULL,
    "tokenPrefix" TEXT NOT NULL,
    "secret" TEXT NOT NULL,
    "systemUserId" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "revokedById" TEXT,
    "expiresAt" TIMESTAMP(3),
    "lastUsedAt" TIMESTAMP(3),
    "lastUsedIp" TEXT,
    "lastSyncAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "ScimToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Groups" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "externalId" TEXT,
    "url" TEXT,
    "note" TEXT,
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" TIMESTAMP(3),
    "scimDisplayName" TEXT,
    "scimExtensions" JSONB,
    "mappedAccess" "Access",

    CONSTRAINT "Groups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GroupAssignment" (
    "userId" TEXT NOT NULL,
    "groupId" INTEGER NOT NULL,

    CONSTRAINT "GroupAssignment_pkey" PRIMARY KEY ("userId","groupId")
);

-- CreateTable
CREATE TABLE "Roles" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "Roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Projects" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "iconUrl" TEXT,
    "note" TEXT,
    "docs" TEXT,
    "isCompleted" BOOLEAN NOT NULL DEFAULT false,
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,
    "completedAt" DATE,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT NOT NULL,
    "defaultAccessType" "ProjectAccessType" NOT NULL DEFAULT 'GLOBAL_ROLE',
    "defaultRoleId" INTEGER,
    "promptConfigId" TEXT,
    "defaultCaseExportTemplateId" INTEGER,
    "quickScriptEnabled" BOOLEAN NOT NULL DEFAULT false,
    "junitIterationPropertyNames" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "reviewWorkflowEnabled" BOOLEAN NOT NULL DEFAULT false,
    "requireResultFlipJustification" BOOLEAN NOT NULL DEFAULT false,
    "editResultsDurationSeconds" INTEGER,
    "requireIssueOnFailure" BOOLEAN NOT NULL DEFAULT false,
    "excludeNotStartedFromRuns" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "Projects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectAssignment" (
    "userId" TEXT NOT NULL,
    "projectId" INTEGER NOT NULL,

    CONSTRAINT "ProjectAssignment_pkey" PRIMARY KEY ("userId","projectId")
);

-- CreateTable
CREATE TABLE "ProjectStatusAssignment" (
    "statusId" INTEGER NOT NULL,
    "projectId" INTEGER NOT NULL,

    CONSTRAINT "ProjectStatusAssignment_pkey" PRIMARY KEY ("statusId","projectId")
);

-- CreateTable
CREATE TABLE "ProjectConfigurationAssignment" (
    "configurationId" INTEGER NOT NULL,
    "projectId" INTEGER NOT NULL,

    CONSTRAINT "ProjectConfigurationAssignment_pkey" PRIMARY KEY ("configurationId","projectId")
);

-- CreateTable
CREATE TABLE "ProjectWorkflowAssignment" (
    "workflowId" INTEGER NOT NULL,
    "projectId" INTEGER NOT NULL,

    CONSTRAINT "ProjectWorkflowAssignment_pkey" PRIMARY KEY ("workflowId","projectId")
);

-- CreateTable
CREATE TABLE "Milestones" (
    "id" SERIAL NOT NULL,
    "projectId" INTEGER NOT NULL,
    "rootId" INTEGER,
    "parentId" INTEGER,
    "milestoneTypesId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "note" JSONB,
    "docs" JSONB,
    "isStarted" BOOLEAN NOT NULL DEFAULT false,
    "isCompleted" BOOLEAN NOT NULL DEFAULT false,
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,
    "automaticCompletion" BOOLEAN NOT NULL DEFAULT false,
    "notifyDaysBefore" INTEGER NOT NULL DEFAULT 0,
    "startedAt" TIMESTAMPTZ(6),
    "completedAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT NOT NULL,

    CONSTRAINT "Milestones_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MilestoneTypes" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "iconId" INTEGER,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "MilestoneTypes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MilestoneTypesAssignment" (
    "projectId" INTEGER NOT NULL,
    "milestoneTypeId" INTEGER NOT NULL,

    CONSTRAINT "MilestoneTypesAssignment_pkey" PRIMARY KEY ("projectId","milestoneTypeId")
);

-- CreateTable
CREATE TABLE "FieldIcon" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "FieldIcon_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ColorFamily" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "ColorFamily_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Color" (
    "id" SERIAL NOT NULL,
    "colorFamilyId" INTEGER NOT NULL,
    "value" TEXT NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "Color_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CaseFields" (
    "id" SERIAL NOT NULL,
    "displayName" TEXT NOT NULL,
    "systemName" TEXT NOT NULL,
    "hint" TEXT,
    "typeId" INTEGER NOT NULL,
    "isEnabled" BOOLEAN NOT NULL DEFAULT true,
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,
    "isRequired" BOOLEAN NOT NULL DEFAULT false,
    "isRestricted" BOOLEAN NOT NULL DEFAULT false,
    "defaultValue" TEXT,
    "isChecked" BOOLEAN,
    "minValue" DOUBLE PRECISION,
    "maxValue" DOUBLE PRECISION,
    "initialHeight" INTEGER,

    CONSTRAINT "CaseFields_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ResultFields" (
    "id" SERIAL NOT NULL,
    "displayName" TEXT NOT NULL,
    "systemName" TEXT NOT NULL,
    "hint" TEXT,
    "typeId" INTEGER NOT NULL,
    "isEnabled" BOOLEAN NOT NULL DEFAULT true,
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,
    "isRequired" BOOLEAN NOT NULL DEFAULT false,
    "isRestricted" BOOLEAN NOT NULL DEFAULT false,
    "defaultValue" TEXT,
    "isChecked" BOOLEAN,
    "minValue" DOUBLE PRECISION,
    "maxValue" DOUBLE PRECISION,
    "initialHeight" INTEGER,

    CONSTRAINT "ResultFields_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FieldOptions" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "iconId" INTEGER,
    "isEnabled" BOOLEAN NOT NULL DEFAULT true,
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,
    "iconColorId" INTEGER,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "FieldOptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CaseFieldTypes" (
    "id" SERIAL NOT NULL,
    "type" TEXT NOT NULL,
    "options" JSONB,

    CONSTRAINT "CaseFieldTypes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Templates" (
    "id" SERIAL NOT NULL,
    "templateName" TEXT NOT NULL,
    "isEnabled" BOOLEAN NOT NULL,
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,
    "isDefault" BOOLEAN NOT NULL,

    CONSTRAINT "Templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TemplateProjectAssignment" (
    "templateId" INTEGER NOT NULL,
    "projectId" INTEGER NOT NULL,

    CONSTRAINT "TemplateProjectAssignment_pkey" PRIMARY KEY ("templateId","projectId")
);

-- CreateTable
CREATE TABLE "TemplateCaseAssignment" (
    "caseFieldId" INTEGER NOT NULL,
    "templateId" INTEGER NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "TemplateCaseAssignment_pkey" PRIMARY KEY ("caseFieldId","templateId")
);

-- CreateTable
CREATE TABLE "TemplateResultAssignment" (
    "resultFieldId" INTEGER NOT NULL,
    "templateId" INTEGER NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "TemplateResultAssignment_pkey" PRIMARY KEY ("resultFieldId","templateId")
);

-- CreateTable
CREATE TABLE "CaseExportTemplate" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "category" TEXT NOT NULL,
    "framework" TEXT NOT NULL DEFAULT '',
    "headerBody" TEXT,
    "templateBody" TEXT NOT NULL,
    "footerBody" TEXT,
    "fileExtension" TEXT NOT NULL,
    "language" TEXT NOT NULL,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "isEnabled" BOOLEAN NOT NULL DEFAULT true,
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CaseExportTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CaseExportTemplateProjectAssignment" (
    "templateId" INTEGER NOT NULL,
    "projectId" INTEGER NOT NULL,

    CONSTRAINT "CaseExportTemplateProjectAssignment_pkey" PRIMARY KEY ("templateId","projectId")
);

-- CreateTable
CREATE TABLE "CaseFieldAssignment" (
    "fieldOptionId" SERIAL NOT NULL,
    "caseFieldId" INTEGER NOT NULL,

    CONSTRAINT "CaseFieldAssignment_pkey" PRIMARY KEY ("fieldOptionId","caseFieldId")
);

-- CreateTable
CREATE TABLE "ResultFieldAssignment" (
    "fieldOptionId" SERIAL NOT NULL,
    "resultFieldId" INTEGER NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "ResultFieldAssignment_pkey" PRIMARY KEY ("fieldOptionId","resultFieldId")
);

-- CreateTable
CREATE TABLE "Status" (
    "id" SERIAL NOT NULL,
    "order" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "systemName" TEXT NOT NULL,
    "aliases" TEXT,
    "colorId" INTEGER NOT NULL,
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,
    "isEnabled" BOOLEAN NOT NULL,
    "isSuccess" BOOLEAN NOT NULL,
    "isFailure" BOOLEAN NOT NULL,
    "isCompleted" BOOLEAN NOT NULL,

    CONSTRAINT "Status_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StatusScope" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "icon" TEXT,

    CONSTRAINT "StatusScope_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StatusScopeAssignment" (
    "statusId" INTEGER NOT NULL,
    "scopeId" INTEGER NOT NULL,

    CONSTRAINT "StatusScopeAssignment_pkey" PRIMARY KEY ("statusId","scopeId")
);

-- CreateTable
CREATE TABLE "Workflows" (
    "id" SERIAL NOT NULL,
    "order" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "iconId" INTEGER NOT NULL,
    "colorId" INTEGER NOT NULL,
    "isEnabled" BOOLEAN NOT NULL DEFAULT true,
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "workflowType" "WorkflowType" NOT NULL DEFAULT 'NOT_STARTED',
    "scope" "WorkflowScope" NOT NULL,
    "requiresReview" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "Workflows_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConfigCategories" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "ConfigCategories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConfigVariants" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "isEnabled" BOOLEAN NOT NULL DEFAULT true,
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,
    "categoryId" INTEGER NOT NULL,

    CONSTRAINT "ConfigVariants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Configurations" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "isEnabled" BOOLEAN NOT NULL DEFAULT true,
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "Configurations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConfigurationConfigVariant" (
    "configurationId" INTEGER NOT NULL,
    "variantId" INTEGER NOT NULL,

    CONSTRAINT "ConfigurationConfigVariant_pkey" PRIMARY KEY ("configurationId","variantId")
);

-- CreateTable
CREATE TABLE "Tags" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "Tags_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Repositories" (
    "id" SERIAL NOT NULL,
    "projectId" INTEGER NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "isArchived" BOOLEAN NOT NULL DEFAULT false,
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "Repositories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RepositoryFolders" (
    "id" SERIAL NOT NULL,
    "projectId" INTEGER NOT NULL,
    "repositoryId" INTEGER NOT NULL,
    "parentId" INTEGER,
    "name" TEXT NOT NULL,
    "docs" JSONB,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "creatorId" TEXT NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "RepositoryFolders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RepositoryCaseLink" (
    "id" SERIAL NOT NULL,
    "caseAId" INTEGER NOT NULL,
    "caseBId" INTEGER NOT NULL,
    "type" "LinkType" NOT NULL,
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" TEXT NOT NULL,

    CONSTRAINT "RepositoryCaseLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DuplicateScanResult" (
    "id" SERIAL NOT NULL,
    "projectId" INTEGER NOT NULL,
    "caseAId" INTEGER NOT NULL,
    "caseBId" INTEGER NOT NULL,
    "score" DOUBLE PRECISION NOT NULL,
    "matchedFields" TEXT[],
    "detectionMethod" TEXT NOT NULL DEFAULT 'fuzzy',
    "status" "DuplicateScanResultStatus" NOT NULL DEFAULT 'PENDING',
    "scanJobId" TEXT,
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DuplicateScanResult_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StepSequenceMatch" (
    "id" SERIAL NOT NULL,
    "projectId" INTEGER NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "stepCount" INTEGER NOT NULL,
    "status" "StepSequenceMatchStatus" NOT NULL DEFAULT 'PENDING',
    "scanJobId" TEXT,
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StepSequenceMatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StepSequenceMatchCase" (
    "id" SERIAL NOT NULL,
    "matchId" INTEGER NOT NULL,
    "caseId" INTEGER NOT NULL,
    "startStepId" INTEGER NOT NULL,
    "endStepId" INTEGER NOT NULL,
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "StepSequenceMatchCase_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RepositoryCases" (
    "id" SERIAL NOT NULL,
    "projectId" INTEGER NOT NULL,
    "repositoryId" INTEGER NOT NULL,
    "folderId" INTEGER NOT NULL,
    "templateId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "className" TEXT,
    "source" "RepositoryCaseSource" NOT NULL DEFAULT 'MANUAL',
    "stateId" INTEGER NOT NULL,
    "estimate" INTEGER,
    "forecastManual" INTEGER,
    "forecastAutomated" DOUBLE PRECISION,
    "order" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "creatorId" TEXT NOT NULL,
    "automated" BOOLEAN NOT NULL DEFAULT false,
    "isArchived" BOOLEAN NOT NULL DEFAULT false,
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,
    "currentVersion" INTEGER NOT NULL DEFAULT 1,
    "hasParameters" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "RepositoryCases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RepositoryCaseVersions" (
    "id" SERIAL NOT NULL,
    "repositoryCaseId" INTEGER NOT NULL,
    "staticProjectId" INTEGER NOT NULL,
    "staticProjectName" TEXT NOT NULL,
    "projectId" INTEGER NOT NULL,
    "repositoryId" INTEGER NOT NULL,
    "folderId" INTEGER NOT NULL,
    "folderName" TEXT NOT NULL,
    "templateId" INTEGER NOT NULL,
    "templateName" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "stateId" INTEGER NOT NULL,
    "stateName" TEXT NOT NULL,
    "estimate" INTEGER,
    "forecastManual" INTEGER,
    "forecastAutomated" DOUBLE PRECISION,
    "order" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "creatorId" TEXT NOT NULL,
    "creatorName" TEXT NOT NULL,
    "automated" BOOLEAN NOT NULL DEFAULT false,
    "isArchived" BOOLEAN NOT NULL DEFAULT false,
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,
    "version" INTEGER NOT NULL,
    "steps" JSONB,
    "tags" JSONB,
    "issues" JSONB,
    "links" JSONB,
    "attachments" JSONB,
    "parameters" JSONB,

    CONSTRAINT "RepositoryCaseVersions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CaseFieldValues" (
    "id" SERIAL NOT NULL,
    "testCaseId" INTEGER NOT NULL,
    "fieldId" INTEGER NOT NULL,
    "value" JSONB,

    CONSTRAINT "CaseFieldValues_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CaseFieldVersionValues" (
    "id" SERIAL NOT NULL,
    "versionId" INTEGER NOT NULL,
    "field" TEXT NOT NULL,
    "value" JSONB,

    CONSTRAINT "CaseFieldVersionValues_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ResultFieldValues" (
    "id" SERIAL NOT NULL,
    "testCaseId" INTEGER,
    "fieldId" INTEGER NOT NULL,
    "value" JSONB,
    "sessionResultsId" INTEGER,
    "testRunResultsId" INTEGER,

    CONSTRAINT "ResultFieldValues_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Attachments" (
    "id" SERIAL NOT NULL,
    "testCaseId" INTEGER,
    "url" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "note" TEXT,
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,
    "mimeType" TEXT NOT NULL,
    "size" BIGINT NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" TEXT NOT NULL,
    "sessionId" INTEGER,
    "sessionResultsId" INTEGER,
    "testRunsId" INTEGER,
    "testRunResultsId" INTEGER,
    "testRunStepResultId" INTEGER,
    "junitTestResultId" INTEGER,

    CONSTRAINT "Attachments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Steps" (
    "id" SERIAL NOT NULL,
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,
    "step" JSONB,
    "expectedResult" JSONB,
    "testCaseId" INTEGER NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,
    "sharedStepGroupId" INTEGER,

    CONSTRAINT "Steps_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TestCaseParameter" (
    "id" SERIAL NOT NULL,
    "testCaseId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "type" "ParameterType" NOT NULL,
    "defaultValue" JSONB,
    "order" INTEGER NOT NULL DEFAULT 0,
    "required" BOOLEAN NOT NULL DEFAULT false,
    "sensitive" BOOLEAN NOT NULL DEFAULT false,
    "allowedValuesJson" JSONB,
    "lookupDataSetId" INTEGER,
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "TestCaseParameter_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Sessions" (
    "id" SERIAL NOT NULL,
    "projectId" INTEGER NOT NULL,
    "templateId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "note" JSONB,
    "mission" JSONB,
    "configId" INTEGER,
    "milestoneId" INTEGER,
    "stateId" INTEGER NOT NULL,
    "assignedToId" TEXT,
    "estimate" INTEGER,
    "forecastManual" INTEGER,
    "forecastAutomated" DOUBLE PRECISION,
    "elapsed" INTEGER,
    "isCompleted" BOOLEAN NOT NULL DEFAULT false,
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" TEXT NOT NULL,
    "currentVersion" INTEGER NOT NULL DEFAULT 1,
    "configurationGroupId" TEXT,

    CONSTRAINT "Sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SessionResults" (
    "id" SERIAL NOT NULL,
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,
    "sessionId" INTEGER NOT NULL,
    "resultData" JSONB,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" TEXT NOT NULL,
    "statusId" INTEGER NOT NULL,
    "elapsed" INTEGER,

    CONSTRAINT "SessionResults_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SessionVersions" (
    "id" SERIAL NOT NULL,
    "sessionId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "staticProjectId" INTEGER NOT NULL,
    "staticProjectName" TEXT NOT NULL,
    "projectId" INTEGER NOT NULL,
    "templateId" INTEGER NOT NULL,
    "templateName" TEXT NOT NULL,
    "configId" INTEGER,
    "configurationName" TEXT,
    "milestoneId" INTEGER,
    "milestoneName" TEXT,
    "stateId" INTEGER NOT NULL,
    "stateName" TEXT NOT NULL,
    "assignedToId" TEXT,
    "assignedToName" TEXT,
    "createdById" TEXT NOT NULL,
    "createdByName" TEXT NOT NULL,
    "estimate" INTEGER,
    "forecastManual" INTEGER,
    "forecastAutomated" DOUBLE PRECISION,
    "elapsed" INTEGER,
    "note" JSONB,
    "mission" JSONB,
    "isCompleted" BOOLEAN NOT NULL,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "version" INTEGER NOT NULL,
    "tags" JSONB,
    "attachments" JSONB,
    "issues" JSONB,

    CONSTRAINT "SessionVersions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SessionFieldValues" (
    "id" SERIAL NOT NULL,
    "sessionId" INTEGER NOT NULL,
    "fieldId" INTEGER NOT NULL,
    "value" JSONB,

    CONSTRAINT "SessionFieldValues_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TestRuns" (
    "id" SERIAL NOT NULL,
    "projectId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "note" JSONB,
    "docs" JSONB,
    "configId" INTEGER,
    "milestoneId" INTEGER,
    "stateId" INTEGER NOT NULL,
    "forecastManual" INTEGER,
    "forecastAutomated" DOUBLE PRECISION,
    "elapsed" INTEGER,
    "isCompleted" BOOLEAN NOT NULL DEFAULT false,
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" TEXT NOT NULL,
    "testRunType" "TestRunType" NOT NULL DEFAULT 'REGULAR',
    "configurationGroupId" TEXT,

    CONSTRAINT "TestRuns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TestRunCases" (
    "id" SERIAL NOT NULL,
    "testRunId" INTEGER NOT NULL,
    "repositoryCaseId" INTEGER NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,
    "statusId" INTEGER,
    "assignedToId" TEXT,
    "isCompleted" BOOLEAN NOT NULL DEFAULT false,
    "notes" JSONB,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "elapsed" INTEGER,
    "passedIterations" INTEGER NOT NULL DEFAULT 0,
    "failedIterations" INTEGER NOT NULL DEFAULT 0,
    "skippedIterations" INTEGER NOT NULL DEFAULT 0,
    "totalIterations" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "TestRunCases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TestRunResults" (
    "id" SERIAL NOT NULL,
    "testRunId" INTEGER NOT NULL,
    "testRunCaseId" INTEGER NOT NULL,
    "testRunCaseVersion" INTEGER NOT NULL DEFAULT 1,
    "statusId" INTEGER NOT NULL,
    "executedById" TEXT NOT NULL,
    "executedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "editedById" TEXT,
    "editedAt" TIMESTAMP(3),
    "elapsed" INTEGER,
    "notes" JSONB,
    "evidence" JSONB,
    "attempt" INTEGER NOT NULL DEFAULT 1,
    "iterationId" INTEGER,
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "TestRunResults_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TestRunStepResults" (
    "id" SERIAL NOT NULL,
    "testRunResultId" INTEGER NOT NULL,
    "stepId" INTEGER NOT NULL,
    "sharedStepItemId" INTEGER,
    "statusId" INTEGER NOT NULL,
    "notes" JSONB,
    "evidence" JSONB,
    "executedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "elapsed" INTEGER,
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "TestRunStepResults_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TestRunCaseIteration" (
    "id" SERIAL NOT NULL,
    "testRunCaseId" INTEGER NOT NULL,
    "rowIndex" INTEGER NOT NULL,
    "label" TEXT,
    "valuesJson" JSONB NOT NULL,
    "ciExtended" BOOLEAN NOT NULL DEFAULT false,
    "statusId" INTEGER,
    "assignedToId" TEXT,
    "isCompleted" BOOLEAN NOT NULL DEFAULT false,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "elapsed" INTEGER,
    "notes" JSONB,
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,
    "dataSetSnapshotId" INTEGER,

    CONSTRAINT "TestRunCaseIteration_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TestRunCaseDataSetSnapshot" (
    "id" SERIAL NOT NULL,
    "testRunCaseId" INTEGER NOT NULL,
    "sourceDataSetId" INTEGER,
    "sourceDataSetName" TEXT NOT NULL,
    "sourceVersionId" INTEGER,
    "parametersJson" JSONB NOT NULL,
    "rowsJson" JSONB NOT NULL,
    "snapshotAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "TestRunCaseDataSetSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Issue" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "status" TEXT,
    "priority" TEXT DEFAULT 'medium',
    "externalId" TEXT,
    "externalKey" TEXT,
    "externalUrl" TEXT,
    "externalStatus" TEXT,
    "externalData" JSONB,
    "issueTypeId" TEXT,
    "issueTypeName" TEXT,
    "issueTypeIconUrl" TEXT,
    "lastSyncedAt" TIMESTAMPTZ(6),
    "data" JSONB,
    "note" JSONB,
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" TEXT NOT NULL,
    "projectId" INTEGER,
    "integrationId" INTEGER,

    CONSTRAINT "Issue_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Integration" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "provider" "IntegrationProvider" NOT NULL,
    "authType" "IntegrationAuthType" NOT NULL,
    "status" "IntegrationStatus" NOT NULL DEFAULT 'INACTIVE',
    "credentials" JSONB NOT NULL,
    "settings" JSONB,
    "lastSyncAt" TIMESTAMP(3),
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Integration_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CodeRepository" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "provider" "CodeRepositoryProvider" NOT NULL,
    "credentials" JSONB NOT NULL,
    "settings" JSONB,
    "status" "IntegrationStatus" NOT NULL DEFAULT 'ACTIVE',
    "lastTestedAt" TIMESTAMP(3),
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CodeRepository_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectCodeRepositoryConfig" (
    "id" SERIAL NOT NULL,
    "projectId" INTEGER NOT NULL,
    "repositoryId" INTEGER NOT NULL,
    "branch" TEXT,
    "pathPatterns" JSONB NOT NULL,
    "cacheEnabled" BOOLEAN NOT NULL DEFAULT true,
    "cacheTtlDays" INTEGER NOT NULL DEFAULT 7,
    "cacheStatus" TEXT,
    "cacheLastFetchedAt" TIMESTAMP(3),
    "cacheFileCount" INTEGER,
    "cacheTotalSize" BIGINT,
    "cacheError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProjectCodeRepositoryConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LlmIntegration" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "provider" "LlmProvider" NOT NULL,
    "status" "IntegrationStatus" NOT NULL DEFAULT 'INACTIVE',
    "credentials" JSONB NOT NULL,
    "settings" JSONB,
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LlmIntegration_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectLlmIntegration" (
    "id" TEXT NOT NULL,
    "projectId" INTEGER NOT NULL,
    "llmIntegrationId" INTEGER NOT NULL,
    "config" JSONB,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProjectLlmIntegration_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserIntegrationAuth" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "integrationId" INTEGER NOT NULL,
    "accessToken" TEXT NOT NULL,
    "refreshToken" TEXT,
    "tokenExpiresAt" TIMESTAMP(3),
    "additionalData" JSONB,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastUsedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserIntegrationAuth_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RolePermission" (
    "roleId" INTEGER NOT NULL,
    "area" "ApplicationArea" NOT NULL,
    "canAddEdit" BOOLEAN NOT NULL DEFAULT false,
    "canDelete" BOOLEAN NOT NULL DEFAULT false,
    "canClose" BOOLEAN NOT NULL DEFAULT false,
    "canReadSensitive" BOOLEAN NOT NULL DEFAULT false,
    "canApprove" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "RolePermission_pkey" PRIMARY KEY ("roleId","area")
);

-- CreateTable
CREATE TABLE "UserProjectPermission" (
    "userId" TEXT NOT NULL,
    "projectId" INTEGER NOT NULL,
    "accessType" "ProjectAccessType" NOT NULL DEFAULT 'DEFAULT',
    "roleId" INTEGER,

    CONSTRAINT "UserProjectPermission_pkey" PRIMARY KEY ("userId","projectId")
);

-- CreateTable
CREATE TABLE "GroupProjectPermission" (
    "groupId" INTEGER NOT NULL,
    "projectId" INTEGER NOT NULL,
    "accessType" "ProjectAccessType" NOT NULL DEFAULT 'DEFAULT',
    "roleId" INTEGER,

    CONSTRAINT "GroupProjectPermission_pkey" PRIMARY KEY ("groupId","projectId")
);

-- CreateTable
CREATE TABLE "JUnitTestSuite" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "time" DOUBLE PRECISION,
    "tests" INTEGER,
    "failures" INTEGER,
    "errors" INTEGER,
    "skipped" INTEGER,
    "assertions" INTEGER,
    "timestamp" TIMESTAMP(3),
    "file" TEXT,
    "systemOut" TEXT,
    "systemErr" TEXT,
    "parentId" INTEGER,
    "testRunId" INTEGER NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" TEXT NOT NULL,

    CONSTRAINT "JUnitTestSuite_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JUnitTestResult" (
    "id" SERIAL NOT NULL,
    "type" "JUnitResultType" NOT NULL,
    "message" TEXT,
    "content" TEXT,
    "repositoryCaseId" INTEGER NOT NULL,
    "executedAt" TIMESTAMPTZ(6),
    "time" DOUBLE PRECISION,
    "assertions" INTEGER,
    "file" TEXT,
    "line" INTEGER,
    "systemOut" TEXT,
    "systemErr" TEXT,
    "testSuiteId" INTEGER NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" TEXT NOT NULL,
    "statusId" INTEGER,

    CONSTRAINT "JUnitTestResult_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JUnitProperty" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "value" TEXT,
    "testSuiteId" INTEGER,
    "repositoryCaseId" INTEGER,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" TEXT NOT NULL,

    CONSTRAINT "JUnitProperty_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JUnitAttachment" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "type" "JUnitAttachmentType" NOT NULL,
    "repositoryCaseId" INTEGER NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" TEXT NOT NULL,

    CONSTRAINT "JUnitAttachment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JUnitTestStep" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "content" TEXT,
    "statusId" INTEGER,
    "repositoryCaseId" INTEGER NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" TEXT NOT NULL,

    CONSTRAINT "JUnitTestStep_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SharedStepGroup" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "projectId" INTEGER NOT NULL,
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,
    "deletedAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    "createdById" TEXT NOT NULL,

    CONSTRAINT "SharedStepGroup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SharedStepItem" (
    "id" SERIAL NOT NULL,
    "sharedStepGroupId" INTEGER NOT NULL,
    "order" INTEGER NOT NULL,
    "step" JSONB NOT NULL,
    "expectedResult" JSONB NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "SharedStepItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DataSet" (
    "id" SERIAL NOT NULL,
    "projectId" INTEGER NOT NULL,
    "ownerCaseId" INTEGER,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "isShared" BOOLEAN NOT NULL DEFAULT false,
    "version" INTEGER NOT NULL DEFAULT 1,
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" TEXT NOT NULL,

    CONSTRAINT "DataSet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DataSetRow" (
    "id" SERIAL NOT NULL,
    "dataSetId" INTEGER NOT NULL,
    "rowIndex" INTEGER NOT NULL DEFAULT 0,
    "label" TEXT,
    "valuesJson" JSONB NOT NULL,
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "DataSetRow_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DataSetVersion" (
    "id" SERIAL NOT NULL,
    "dataSetId" INTEGER NOT NULL,
    "version" INTEGER NOT NULL,
    "parametersJson" JSONB,
    "rowsJson" JSONB NOT NULL,
    "rowCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" TEXT NOT NULL,

    CONSTRAINT "DataSetVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CaseSharedDataSetAssignment" (
    "id" SERIAL NOT NULL,
    "caseId" INTEGER NOT NULL,
    "sharedDataSetId" INTEGER NOT NULL,
    "pinnedVersionId" INTEGER,
    "mappingJson" JSONB NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CaseSharedDataSetAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" "NotificationType" NOT NULL,
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "data" JSONB,
    "isRead" BOOLEAN NOT NULL DEFAULT false,
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,
    "relatedEntityId" TEXT,
    "relatedEntityType" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReviewRequest" (
    "id" TEXT NOT NULL,
    "projectId" INTEGER NOT NULL,
    "entityType" "ReviewEntityType" NOT NULL,
    "entityId" INTEGER NOT NULL,
    "requestedByUserId" TEXT NOT NULL,
    "assigneeUserId" TEXT,
    "assigneeRoleId" INTEGER,
    "fromStateId" INTEGER NOT NULL,
    "toStateId" INTEGER NOT NULL,
    "status" "ReviewStatus" NOT NULL DEFAULT 'PENDING',
    "decisionComment" TEXT,
    "decidedByUserId" TEXT,
    "decidedAt" TIMESTAMP(3),
    "consumedAt" TIMESTAMP(3),
    "lastRemindedAt" TIMESTAMPTZ(6),
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReviewRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShareLink" (
    "id" TEXT NOT NULL,
    "shareKey" TEXT NOT NULL,
    "entityType" "ShareLinkEntityType" NOT NULL,
    "entityId" TEXT,
    "entityConfig" JSONB,
    "projectId" INTEGER,
    "createdById" TEXT NOT NULL,
    "mode" "ShareLinkMode" NOT NULL DEFAULT 'PUBLIC',
    "passwordHash" TEXT,
    "expiresAt" TIMESTAMPTZ(6),
    "notifyOnView" BOOLEAN NOT NULL DEFAULT false,
    "title" TEXT,
    "description" TEXT,
    "isRevoked" BOOLEAN NOT NULL DEFAULT false,
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,
    "viewCount" INTEGER NOT NULL DEFAULT 0,
    "lastViewedAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ShareLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShareLinkAccessLog" (
    "id" TEXT NOT NULL,
    "shareLinkId" TEXT NOT NULL,
    "accessedById" TEXT,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "wasAuthenticated" BOOLEAN NOT NULL DEFAULT false,
    "accessedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ShareLinkAccessLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectIntegration" (
    "id" TEXT NOT NULL,
    "projectId" INTEGER NOT NULL,
    "integrationId" INTEGER NOT NULL,
    "config" JSONB,
    "fieldMappings" JSONB,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastSyncAt" TIMESTAMPTZ(6),
    "syncStatus" TEXT,
    "syncError" TEXT,
    "issueCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProjectIntegration_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IntegrationProject" (
    "id" TEXT NOT NULL,
    "projectIntegrationId" TEXT NOT NULL,
    "externalProjectId" TEXT NOT NULL,
    "externalProjectKey" TEXT NOT NULL,
    "externalProjectName" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "defaultIssueType" TEXT,
    "defaultIssueTypeName" TEXT,
    "lastSyncAt" TIMESTAMPTZ(6),
    "syncStatus" TEXT,
    "syncError" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IntegrationProject_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WebhookConfig" (
    "id" TEXT NOT NULL,
    "projectId" INTEGER NOT NULL,
    "adapterType" "AdapterType" NOT NULL,
    "direction" "WebhookDirection" NOT NULL,
    "token" TEXT NOT NULL,
    "secret" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "subscribedEvents" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "endpointHealth" "EndpointHealth" NOT NULL DEFAULT 'HEALTHY',
    "url" TEXT,
    "name" TEXT,
    "lastReceivedAt" TIMESTAMPTZ(6),
    "lastDispatchedAt" TIMESTAMPTZ(6),
    "lastSuccessAt" TIMESTAMPTZ(6),
    "lastFailureAt" TIMESTAMPTZ(6),
    "consecutiveFailureCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WebhookConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WebhookDelivery" (
    "id" TEXT NOT NULL,
    "webhookConfigId" TEXT,
    "direction" "WebhookDirection" NOT NULL,
    "adapterType" "AdapterType" NOT NULL,
    "eventType" TEXT,
    "eventId" TEXT,
    "statusCode" INTEGER,
    "latencyMs" INTEGER,
    "payloadDigest" TEXT NOT NULL,
    "error" TEXT,
    "attempt" INTEGER NOT NULL DEFAULT 1,
    "replayedFromDeliveryId" TEXT,
    "receivedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WebhookDelivery_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WebhookEventDedup" (
    "id" TEXT NOT NULL,
    "webhookConfigId" TEXT NOT NULL,
    "payloadDigest" TEXT NOT NULL,
    "processedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WebhookEventDedup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WebhookConfigSecret" (
    "id" TEXT NOT NULL,
    "webhookConfigId" TEXT NOT NULL,
    "secret" TEXT NOT NULL,
    "activatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "retiredAt" TIMESTAMPTZ(6),
    "autoRetireAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WebhookConfigSecret_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WebhookOutboxEvent" (
    "id" TEXT NOT NULL,
    "projectId" INTEGER NOT NULL,
    "eventName" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "eventTimestamp" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actorUserId" TEXT,
    "payload" JSONB NOT NULL,
    "dispatchedAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WebhookOutboxEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LlmProviderConfig" (
    "id" SERIAL NOT NULL,
    "llmIntegrationId" INTEGER,
    "defaultModel" TEXT NOT NULL,
    "availableModels" JSONB NOT NULL,
    "maxTokensPerRequest" INTEGER NOT NULL DEFAULT 4096,
    "maxRequestsPerMinute" INTEGER NOT NULL DEFAULT 60,
    "maxRequestsPerDay" INTEGER,
    "costPerInputToken" DECIMAL(10,8) NOT NULL,
    "costPerOutputToken" DECIMAL(10,8) NOT NULL,
    "monthlyBudget" DECIMAL(10,2),
    "billingPeriodStartDay" INTEGER NOT NULL DEFAULT 1,
    "defaultTemperature" DOUBLE PRECISION NOT NULL DEFAULT 0.7,
    "defaultMaxTokens" INTEGER NOT NULL DEFAULT 2048,
    "timeout" INTEGER NOT NULL DEFAULT 30000,
    "retryAttempts" INTEGER NOT NULL DEFAULT 3,
    "streamingEnabled" BOOLEAN NOT NULL DEFAULT false,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "settings" JSONB,
    "alertThresholdsFired" JSONB,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LlmProviderConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PromptConfig" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PromptConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PromptConfigPrompt" (
    "id" TEXT NOT NULL,
    "promptConfigId" TEXT NOT NULL,
    "feature" TEXT NOT NULL,
    "systemPrompt" TEXT NOT NULL,
    "userPrompt" TEXT NOT NULL,
    "temperature" DOUBLE PRECISION NOT NULL DEFAULT 0.7,
    "maxOutputTokens" INTEGER NOT NULL DEFAULT 2048,
    "variables" JSONB NOT NULL DEFAULT '[]',
    "llmIntegrationId" INTEGER,
    "modelOverride" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PromptConfigPrompt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OllamaModelRegistry" (
    "id" TEXT NOT NULL,
    "llmIntegrationId" INTEGER NOT NULL,
    "modelName" TEXT NOT NULL,
    "modelTag" TEXT NOT NULL DEFAULT 'latest',
    "modelSize" BIGINT,
    "digest" TEXT,
    "contextWindow" INTEGER NOT NULL DEFAULT 2048,
    "capabilities" JSONB NOT NULL,
    "quantization" TEXT,
    "isInstalled" BOOLEAN NOT NULL DEFAULT false,
    "isPulling" BOOLEAN NOT NULL DEFAULT false,
    "pullProgress" DOUBLE PRECISION,
    "lastUsedAt" TIMESTAMP(3),
    "installedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OllamaModelRegistry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LlmUsage" (
    "id" TEXT NOT NULL,
    "llmIntegrationId" INTEGER,
    "projectId" INTEGER,
    "userId" TEXT NOT NULL,
    "feature" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "promptTokens" INTEGER NOT NULL,
    "completionTokens" INTEGER NOT NULL,
    "totalTokens" INTEGER NOT NULL,
    "inputCost" DECIMAL(10,6) NOT NULL,
    "outputCost" DECIMAL(10,6) NOT NULL,
    "totalCost" DECIMAL(10,6) NOT NULL,
    "latency" INTEGER NOT NULL,
    "success" BOOLEAN NOT NULL,
    "error" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LlmUsage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LlmFeatureConfig" (
    "id" TEXT NOT NULL,
    "projectId" INTEGER NOT NULL,
    "feature" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "llmIntegrationId" INTEGER,
    "model" TEXT,
    "temperature" DOUBLE PRECISION,
    "maxTokens" INTEGER,
    "autoTrigger" BOOLEAN NOT NULL DEFAULT false,
    "triggerConditions" JSONB,
    "outputFormat" TEXT,
    "postProcessing" JSONB,
    "dailyLimit" INTEGER,
    "monthlyLimit" INTEGER,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LlmFeatureConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LlmResponseCache" (
    "id" TEXT NOT NULL,
    "feature" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "promptHash" TEXT NOT NULL,
    "contextHash" TEXT,
    "response" JSONB NOT NULL,
    "promptTokens" INTEGER NOT NULL,
    "completionTokens" INTEGER NOT NULL,
    "projectId" INTEGER,
    "llmIntegrationId" INTEGER NOT NULL,
    "hits" INTEGER NOT NULL DEFAULT 0,
    "lastAccessedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMPTZ(6) NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LlmResponseCache_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LlmRateLimit" (
    "id" TEXT NOT NULL,
    "llmIntegrationId" INTEGER,
    "scope" TEXT NOT NULL,
    "scopeId" TEXT,
    "feature" TEXT,
    "windowType" TEXT NOT NULL,
    "windowSize" INTEGER NOT NULL,
    "maxRequests" INTEGER NOT NULL,
    "maxTokens" INTEGER,
    "currentRequests" INTEGER NOT NULL DEFAULT 0,
    "currentTokens" INTEGER NOT NULL DEFAULT 0,
    "windowStart" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "blockOnExceed" BOOLEAN NOT NULL DEFAULT true,
    "queueOnExceed" BOOLEAN NOT NULL DEFAULT false,
    "alertOnExceed" BOOLEAN NOT NULL DEFAULT false,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LlmRateLimit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LlmReportSnapshot" (
    "id" SERIAL NOT NULL,
    "projectId" INTEGER NOT NULL,
    "reportType" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "llmIntegrationId" INTEGER,
    "generatedById" TEXT NOT NULL,
    "output" JSONB,
    "errorMessage" TEXT,
    "startedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMPTZ(6),
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LlmReportSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SsoProvider" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "SsoProviderType" NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "forceSso" BOOLEAN NOT NULL DEFAULT false,
    "config" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SsoProvider_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AllowedEmailDomain" (
    "id" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdBy" TEXT,

    CONSTRAINT "AllowedEmailDomain_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RegistrationSettings" (
    "id" TEXT NOT NULL,
    "restrictEmailDomains" BOOLEAN NOT NULL DEFAULT false,
    "allowOpenRegistration" BOOLEAN NOT NULL DEFAULT true,
    "defaultAccess" "Access" NOT NULL DEFAULT 'NONE',
    "force2FANonSSO" BOOLEAN NOT NULL DEFAULT false,
    "force2FAAllLogins" BOOLEAN NOT NULL DEFAULT false,
    "requireEmailVerification" BOOLEAN NOT NULL DEFAULT true,
    "minPasswordLength" INTEGER NOT NULL DEFAULT 12,
    "requireUppercase" BOOLEAN NOT NULL DEFAULT false,
    "requireLowercase" BOOLEAN NOT NULL DEFAULT false,
    "requireNumbers" BOOLEAN NOT NULL DEFAULT false,
    "requiredSpecialChars" TEXT,
    "passwordHistoryDepth" INTEGER NOT NULL DEFAULT 0,
    "passwordExpirationDays" INTEGER NOT NULL DEFAULT 0,
    "lockoutThreshold" INTEGER NOT NULL DEFAULT 5,
    "lockoutDurationMinutes" INTEGER NOT NULL DEFAULT 15,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RegistrationSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SamlConfiguration" (
    "id" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "entryPoint" TEXT NOT NULL,
    "issuer" TEXT NOT NULL,
    "cert" TEXT NOT NULL,
    "callbackUrl" TEXT NOT NULL,
    "logoutUrl" TEXT,
    "wantAssertionsSigned" BOOLEAN NOT NULL DEFAULT true,
    "wantAuthnResponseSigned" BOOLEAN NOT NULL DEFAULT false,
    "attributeMapping" JSONB NOT NULL,
    "autoProvisionUsers" BOOLEAN NOT NULL DEFAULT false,
    "defaultAccess" "Access" NOT NULL DEFAULT 'USER',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SamlConfiguration_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TestmoImportJob" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT NOT NULL,
    "status" "TestmoImportStatus" NOT NULL DEFAULT 'QUEUED',
    "statusMessage" TEXT,
    "phase" "TestmoImportPhase",
    "storageKey" TEXT NOT NULL,
    "storageBucket" TEXT,
    "originalFileName" TEXT NOT NULL,
    "originalFileSize" BIGINT,
    "totalDatasets" INTEGER,
    "processedDatasets" INTEGER NOT NULL DEFAULT 0,
    "totalRows" BIGINT,
    "processedRows" BIGINT NOT NULL DEFAULT 0,
    "durationMs" INTEGER,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "canceledAt" TIMESTAMP(3),
    "cancelRequested" BOOLEAN NOT NULL DEFAULT false,
    "error" TEXT,
    "processedCount" INTEGER NOT NULL DEFAULT 0,
    "errorCount" INTEGER NOT NULL DEFAULT 0,
    "skippedCount" INTEGER NOT NULL DEFAULT 0,
    "totalCount" INTEGER NOT NULL DEFAULT 0,
    "currentEntity" TEXT,
    "estimatedTimeRemaining" TEXT,
    "processingRate" TEXT,
    "activityLog" JSONB,
    "entityProgress" JSONB,
    "options" JSONB,
    "configuration" JSONB,
    "analysis" JSONB,
    "analysisGeneratedAt" TIMESTAMP(3),
    "lastImportStartedAt" TIMESTAMP(3),

    CONSTRAINT "TestmoImportJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TestmoImportDataset" (
    "id" SERIAL NOT NULL,
    "jobId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "rowCount" INTEGER NOT NULL,
    "sampleRowCount" INTEGER NOT NULL,
    "truncated" BOOLEAN NOT NULL,
    "schema" JSONB,
    "sampleRows" JSONB,
    "allRows" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TestmoImportDataset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TestmoImportStaging" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "datasetName" TEXT NOT NULL,
    "rowIndex" INTEGER NOT NULL,
    "rowData" JSONB NOT NULL,
    "fieldName" TEXT,
    "fieldValue" TEXT,
    "text1" TEXT,
    "text2" TEXT,
    "text3" TEXT,
    "text4" TEXT,
    "processed" BOOLEAN NOT NULL DEFAULT false,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TestmoImportStaging_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TestmoImportMapping" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "sourceId" INTEGER NOT NULL,
    "targetId" TEXT,
    "targetType" TEXT NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TestmoImportMapping_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Comment" (
    "id" TEXT NOT NULL,
    "content" JSONB NOT NULL,
    "projectId" INTEGER NOT NULL,
    "repositoryCaseId" INTEGER,
    "testRunId" INTEGER,
    "sessionId" INTEGER,
    "milestoneId" INTEGER,
    "type" "CommentType" NOT NULL DEFAULT 'GENERAL',
    "reviewRequestId" TEXT,
    "creatorId" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "isEdited" BOOLEAN NOT NULL DEFAULT false,
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "Comment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommentMention" (
    "id" TEXT NOT NULL,
    "commentId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CommentMention_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "userEmail" TEXT,
    "userName" TEXT,
    "action" "AuditAction" NOT NULL,
    "entityType" VARCHAR(100) NOT NULL,
    "entityId" TEXT NOT NULL,
    "entityName" TEXT,
    "changes" JSONB,
    "metadata" JSONB,
    "timestamp" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "projectId" INTEGER,
    "operationId" TEXT,
    "sourceTable" VARCHAR(100),

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DataChangeLog" (
    "id" BIGSERIAL NOT NULL,
    "seq" BIGSERIAL NOT NULL,
    "table" VARCHAR(100) NOT NULL,
    "op" CHAR(1) NOT NULL,
    "pk" TEXT NOT NULL,
    "changed_cols" JSONB,
    "actor" TEXT,
    "operation_id" TEXT,
    "tenant" TEXT,
    "actor_name" TEXT,
    "actor_email" TEXT,
    "entity_name" TEXT,
    "project_id" TEXT,
    "txid" BIGINT NOT NULL,
    "ts" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processed" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "DataChangeLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "_TagsToTestRuns" (
    "A" INTEGER NOT NULL,
    "B" INTEGER NOT NULL,

    CONSTRAINT "_TagsToTestRuns_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateTable
CREATE TABLE "_RepositoryCasesToTags" (
    "A" INTEGER NOT NULL,
    "B" INTEGER NOT NULL,

    CONSTRAINT "_RepositoryCasesToTags_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateTable
CREATE TABLE "_SessionsToTags" (
    "A" INTEGER NOT NULL,
    "B" INTEGER NOT NULL,

    CONSTRAINT "_SessionsToTags_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateTable
CREATE TABLE "_IssueToRepositoryCases" (
    "A" INTEGER NOT NULL,
    "B" INTEGER NOT NULL,

    CONSTRAINT "_IssueToRepositoryCases_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateTable
CREATE TABLE "_IssueToSessions" (
    "A" INTEGER NOT NULL,
    "B" INTEGER NOT NULL,

    CONSTRAINT "_IssueToSessions_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateTable
CREATE TABLE "_IssueToSessionResults" (
    "A" INTEGER NOT NULL,
    "B" INTEGER NOT NULL,

    CONSTRAINT "_IssueToSessionResults_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateTable
CREATE TABLE "_IssueToTestRuns" (
    "A" INTEGER NOT NULL,
    "B" INTEGER NOT NULL,

    CONSTRAINT "_IssueToTestRuns_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateTable
CREATE TABLE "_IssueToTestRunResults" (
    "A" INTEGER NOT NULL,
    "B" INTEGER NOT NULL,

    CONSTRAINT "_IssueToTestRunResults_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateTable
CREATE TABLE "_IssueToTestRunStepResults" (
    "A" INTEGER NOT NULL,
    "B" INTEGER NOT NULL,

    CONSTRAINT "_IssueToTestRunStepResults_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateIndex
CREATE INDEX "Account_userId_idx" ON "Account"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Account_provider_providerAccountId_key" ON "Account"("provider", "providerAccountId");

-- CreateIndex
CREATE UNIQUE INDEX "VerificationToken_token_key" ON "VerificationToken"("token");

-- CreateIndex
CREATE UNIQUE INDEX "VerificationToken_identifier_token_key" ON "VerificationToken"("identifier", "token");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "User_scimUserName_key" ON "User"("scimUserName");

-- CreateIndex
CREATE UNIQUE INDEX "User_scimExternalId_key" ON "User"("scimExternalId");

-- CreateIndex
CREATE INDEX "User_isActive_isDeleted_idx" ON "User"("isActive", "isDeleted");

-- CreateIndex
CREATE INDEX "User_access_idx" ON "User"("access");

-- CreateIndex
CREATE INDEX "User_accessSource_idx" ON "User"("accessSource");

-- CreateIndex
CREATE INDEX "PasswordHistory_userId_createdAt_idx" ON "PasswordHistory"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "UserPreferences_userId_key" ON "UserPreferences"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "ApiToken_token_key" ON "ApiToken"("token");

-- CreateIndex
CREATE INDEX "ApiToken_userId_idx" ON "ApiToken"("userId");

-- CreateIndex
CREATE INDEX "ApiToken_token_idx" ON "ApiToken"("token");

-- CreateIndex
CREATE INDEX "ApiToken_isActive_expiresAt_idx" ON "ApiToken"("isActive", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "ScimToken_token_key" ON "ScimToken"("token");

-- CreateIndex
CREATE INDEX "ScimToken_token_idx" ON "ScimToken"("token");

-- CreateIndex
CREATE INDEX "ScimToken_isActive_expiresAt_idx" ON "ScimToken"("isActive", "expiresAt");

-- CreateIndex
CREATE INDEX "ScimToken_createdById_idx" ON "ScimToken"("createdById");

-- CreateIndex
CREATE UNIQUE INDEX "Groups_name_key" ON "Groups"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Groups_externalId_key" ON "Groups"("externalId");

-- CreateIndex
CREATE UNIQUE INDEX "Roles_name_key" ON "Roles"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Projects_name_key" ON "Projects"("name");

-- CreateIndex
CREATE INDEX "Projects_isDeleted_isCompleted_idx" ON "Projects"("isDeleted", "isCompleted");

-- CreateIndex
CREATE INDEX "Projects_createdBy_idx" ON "Projects"("createdBy");

-- CreateIndex
CREATE INDEX "ProjectAssignment_projectId_idx" ON "ProjectAssignment"("projectId");

-- CreateIndex
CREATE INDEX "ProjectAssignment_userId_idx" ON "ProjectAssignment"("userId");

-- CreateIndex
CREATE INDEX "Milestones_projectId_isDeleted_idx" ON "Milestones"("projectId", "isDeleted");

-- CreateIndex
CREATE INDEX "Milestones_parentId_idx" ON "Milestones"("parentId");

-- CreateIndex
CREATE INDEX "Milestones_isCompleted_isDeleted_idx" ON "Milestones"("isCompleted", "isDeleted");

-- CreateIndex
CREATE INDEX "Milestones_isCompleted_automaticCompletion_completedAt_idx" ON "Milestones"("isCompleted", "automaticCompletion", "completedAt");

-- CreateIndex
CREATE INDEX "Milestones_isCompleted_notifyDaysBefore_completedAt_idx" ON "Milestones"("isCompleted", "notifyDaysBefore", "completedAt");

-- CreateIndex
CREATE UNIQUE INDEX "MilestoneTypes_name_key" ON "MilestoneTypes"("name");

-- CreateIndex
CREATE UNIQUE INDEX "FieldIcon_name_key" ON "FieldIcon"("name");

-- CreateIndex
CREATE UNIQUE INDEX "ColorFamily_name_key" ON "ColorFamily"("name");

-- CreateIndex
CREATE UNIQUE INDEX "ColorFamily_order_key" ON "ColorFamily"("order");

-- CreateIndex
CREATE UNIQUE INDEX "Color_colorFamilyId_order_key" ON "Color"("colorFamilyId", "order");

-- CreateIndex
CREATE UNIQUE INDEX "CaseFields_systemName_key" ON "CaseFields"("systemName");

-- CreateIndex
CREATE UNIQUE INDEX "ResultFields_systemName_key" ON "ResultFields"("systemName");

-- CreateIndex
CREATE UNIQUE INDEX "CaseFieldTypes_type_key" ON "CaseFieldTypes"("type");

-- CreateIndex
CREATE UNIQUE INDEX "Templates_templateName_key" ON "Templates"("templateName");

-- CreateIndex
CREATE UNIQUE INDEX "CaseExportTemplate_name_key" ON "CaseExportTemplate"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Status_systemName_key" ON "Status"("systemName");

-- CreateIndex
CREATE INDEX "Status_isDeleted_isEnabled_idx" ON "Status"("isDeleted", "isEnabled");

-- CreateIndex
CREATE INDEX "Status_order_idx" ON "Status"("order");

-- CreateIndex
CREATE UNIQUE INDEX "StatusScope_name_key" ON "StatusScope"("name");

-- CreateIndex
CREATE INDEX "Workflows_isDeleted_isEnabled_idx" ON "Workflows"("isDeleted", "isEnabled");

-- CreateIndex
CREATE INDEX "Workflows_scope_isDefault_idx" ON "Workflows"("scope", "isDefault");

-- CreateIndex
CREATE INDEX "Workflows_order_idx" ON "Workflows"("order");

-- CreateIndex
CREATE UNIQUE INDEX "Tags_name_key" ON "Tags"("name");

-- CreateIndex
CREATE INDEX "RepositoryFolders_projectId_repositoryId_isDeleted_idx" ON "RepositoryFolders"("projectId", "repositoryId", "isDeleted");

-- CreateIndex
CREATE INDEX "RepositoryFolders_parentId_idx" ON "RepositoryFolders"("parentId");

-- CreateIndex
CREATE INDEX "RepositoryFolders_order_idx" ON "RepositoryFolders"("order");

-- CreateIndex
CREATE UNIQUE INDEX "RepositoryFolders_projectId_repositoryId_parentId_name_isDe_key" ON "RepositoryFolders"("projectId", "repositoryId", "parentId", "name", "isDeleted");

-- CreateIndex
CREATE UNIQUE INDEX "RepositoryCaseLink_caseAId_caseBId_type_key" ON "RepositoryCaseLink"("caseAId", "caseBId", "type");

-- CreateIndex
CREATE INDEX "DuplicateScanResult_projectId_status_isDeleted_idx" ON "DuplicateScanResult"("projectId", "status", "isDeleted");

-- CreateIndex
CREATE INDEX "DuplicateScanResult_scanJobId_idx" ON "DuplicateScanResult"("scanJobId");

-- CreateIndex
CREATE UNIQUE INDEX "DuplicateScanResult_caseAId_caseBId_scanJobId_key" ON "DuplicateScanResult"("caseAId", "caseBId", "scanJobId");

-- CreateIndex
CREATE INDEX "StepSequenceMatch_projectId_status_isDeleted_idx" ON "StepSequenceMatch"("projectId", "status", "isDeleted");

-- CreateIndex
CREATE INDEX "StepSequenceMatch_scanJobId_idx" ON "StepSequenceMatch"("scanJobId");

-- CreateIndex
CREATE UNIQUE INDEX "StepSequenceMatch_projectId_fingerprint_scanJobId_key" ON "StepSequenceMatch"("projectId", "fingerprint", "scanJobId");

-- CreateIndex
CREATE INDEX "StepSequenceMatchCase_caseId_idx" ON "StepSequenceMatchCase"("caseId");

-- CreateIndex
CREATE UNIQUE INDEX "StepSequenceMatchCase_matchId_caseId_key" ON "StepSequenceMatchCase"("matchId", "caseId");

-- CreateIndex
CREATE INDEX "RepositoryCases_projectId_isDeleted_isArchived_idx" ON "RepositoryCases"("projectId", "isDeleted", "isArchived");

-- CreateIndex
CREATE INDEX "RepositoryCases_folderId_order_idx" ON "RepositoryCases"("folderId", "order");

-- CreateIndex
CREATE INDEX "RepositoryCases_repositoryId_isDeleted_idx" ON "RepositoryCases"("repositoryId", "isDeleted");

-- CreateIndex
CREATE INDEX "RepositoryCases_stateId_idx" ON "RepositoryCases"("stateId");

-- CreateIndex
CREATE INDEX "RepositoryCases_automated_idx" ON "RepositoryCases"("automated");

-- CreateIndex
CREATE INDEX "RepositoryCases_createdAt_idx" ON "RepositoryCases"("createdAt");

-- CreateIndex
CREATE INDEX "RepositoryCases_hasParameters_idx" ON "RepositoryCases"("hasParameters");

-- CreateIndex
CREATE UNIQUE INDEX "RepositoryCases_projectId_name_className_source_key" ON "RepositoryCases"("projectId", "name", "className", "source");

-- CreateIndex
CREATE UNIQUE INDEX "RepositoryCaseVersions_repositoryCaseId_version_key" ON "RepositoryCaseVersions"("repositoryCaseId", "version");

-- CreateIndex
CREATE INDEX "CaseFieldValues_testCaseId_idx" ON "CaseFieldValues"("testCaseId");

-- CreateIndex
CREATE INDEX "CaseFieldValues_fieldId_idx" ON "CaseFieldValues"("fieldId");

-- CreateIndex
CREATE INDEX "ResultFieldValues_testRunResultsId_idx" ON "ResultFieldValues"("testRunResultsId");

-- CreateIndex
CREATE INDEX "ResultFieldValues_sessionResultsId_idx" ON "ResultFieldValues"("sessionResultsId");

-- CreateIndex
CREATE INDEX "ResultFieldValues_fieldId_idx" ON "ResultFieldValues"("fieldId");

-- CreateIndex
CREATE INDEX "Steps_testCaseId_idx" ON "Steps"("testCaseId");

-- CreateIndex
CREATE INDEX "Steps_sharedStepGroupId_idx" ON "Steps"("sharedStepGroupId");

-- CreateIndex
CREATE INDEX "TestCaseParameter_testCaseId_idx" ON "TestCaseParameter"("testCaseId");

-- CreateIndex
CREATE UNIQUE INDEX "TestCaseParameter_testCaseId_name_key" ON "TestCaseParameter"("testCaseId", "name");

-- CreateIndex
CREATE INDEX "Sessions_projectId_isDeleted_idx" ON "Sessions"("projectId", "isDeleted");

-- CreateIndex
CREATE INDEX "Sessions_createdById_idx" ON "Sessions"("createdById");

-- CreateIndex
CREATE INDEX "Sessions_assignedToId_idx" ON "Sessions"("assignedToId");

-- CreateIndex
CREATE INDEX "Sessions_stateId_idx" ON "Sessions"("stateId");

-- CreateIndex
CREATE INDEX "Sessions_isCompleted_createdAt_idx" ON "Sessions"("isCompleted", "createdAt");

-- CreateIndex
CREATE INDEX "Sessions_configurationGroupId_idx" ON "Sessions"("configurationGroupId");

-- CreateIndex
CREATE INDEX "SessionResults_sessionId_idx" ON "SessionResults"("sessionId");

-- CreateIndex
CREATE INDEX "SessionResults_statusId_idx" ON "SessionResults"("statusId");

-- CreateIndex
CREATE INDEX "SessionResults_createdAt_idx" ON "SessionResults"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "SessionVersions_sessionId_version_key" ON "SessionVersions"("sessionId", "version");

-- CreateIndex
CREATE INDEX "SessionFieldValues_sessionId_idx" ON "SessionFieldValues"("sessionId");

-- CreateIndex
CREATE INDEX "SessionFieldValues_fieldId_idx" ON "SessionFieldValues"("fieldId");

-- CreateIndex
CREATE INDEX "TestRuns_projectId_isDeleted_idx" ON "TestRuns"("projectId", "isDeleted");

-- CreateIndex
CREATE INDEX "TestRuns_createdById_idx" ON "TestRuns"("createdById");

-- CreateIndex
CREATE INDEX "TestRuns_stateId_idx" ON "TestRuns"("stateId");

-- CreateIndex
CREATE INDEX "TestRuns_isCompleted_createdAt_idx" ON "TestRuns"("isCompleted", "createdAt");

-- CreateIndex
CREATE INDEX "TestRuns_testRunType_idx" ON "TestRuns"("testRunType");

-- CreateIndex
CREATE INDEX "TestRuns_configurationGroupId_idx" ON "TestRuns"("configurationGroupId");

-- CreateIndex
CREATE INDEX "TestRunCases_testRunId_idx" ON "TestRunCases"("testRunId");

-- CreateIndex
CREATE INDEX "TestRunCases_repositoryCaseId_idx" ON "TestRunCases"("repositoryCaseId");

-- CreateIndex
CREATE INDEX "TestRunCases_assignedToId_idx" ON "TestRunCases"("assignedToId");

-- CreateIndex
CREATE INDEX "TestRunCases_statusId_idx" ON "TestRunCases"("statusId");

-- CreateIndex
CREATE INDEX "TestRunCases_isCompleted_idx" ON "TestRunCases"("isCompleted");

-- CreateIndex
CREATE INDEX "TestRunCases_isDeleted_idx" ON "TestRunCases"("isDeleted");

-- CreateIndex
CREATE UNIQUE INDEX "TestRunCases_testRunId_repositoryCaseId_key" ON "TestRunCases"("testRunId", "repositoryCaseId");

-- CreateIndex
CREATE INDEX "TestRunResults_testRunCaseId_idx" ON "TestRunResults"("testRunCaseId");

-- CreateIndex
CREATE INDEX "TestRunResults_executedById_idx" ON "TestRunResults"("executedById");

-- CreateIndex
CREATE INDEX "TestRunResults_statusId_idx" ON "TestRunResults"("statusId");

-- CreateIndex
CREATE INDEX "TestRunResults_executedAt_idx" ON "TestRunResults"("executedAt");

-- CreateIndex
CREATE INDEX "TestRunResults_testRunCaseId_executedAt_idx" ON "TestRunResults"("testRunCaseId", "executedAt" DESC);

-- CreateIndex
CREATE INDEX "TestRunResults_iterationId_idx" ON "TestRunResults"("iterationId");

-- CreateIndex
CREATE INDEX "TestRunStepResults_sharedStepItemId_idx" ON "TestRunStepResults"("sharedStepItemId");

-- CreateIndex
CREATE UNIQUE INDEX "uq_tsr_res_step_shareditem" ON "TestRunStepResults"("testRunResultId", "stepId", "sharedStepItemId");

-- CreateIndex
CREATE INDEX "TestRunCaseIteration_testRunCaseId_idx" ON "TestRunCaseIteration"("testRunCaseId");

-- CreateIndex
CREATE INDEX "TestRunCaseIteration_statusId_idx" ON "TestRunCaseIteration"("statusId");

-- CreateIndex
CREATE INDEX "TestRunCaseIteration_assignedToId_idx" ON "TestRunCaseIteration"("assignedToId");

-- CreateIndex
CREATE UNIQUE INDEX "TestRunCaseIteration_testRunCaseId_rowIndex_key" ON "TestRunCaseIteration"("testRunCaseId", "rowIndex");

-- CreateIndex
CREATE UNIQUE INDEX "TestRunCaseDataSetSnapshot_testRunCaseId_key" ON "TestRunCaseDataSetSnapshot"("testRunCaseId");

-- CreateIndex
CREATE INDEX "TestRunCaseDataSetSnapshot_testRunCaseId_idx" ON "TestRunCaseDataSetSnapshot"("testRunCaseId");

-- CreateIndex
CREATE INDEX "TestRunCaseDataSetSnapshot_sourceDataSetId_idx" ON "TestRunCaseDataSetSnapshot"("sourceDataSetId");

-- CreateIndex
CREATE INDEX "TestRunCaseDataSetSnapshot_sourceVersionId_idx" ON "TestRunCaseDataSetSnapshot"("sourceVersionId");

-- CreateIndex
CREATE INDEX "Issue_externalId_idx" ON "Issue"("externalId");

-- CreateIndex
CREATE INDEX "Issue_createdById_idx" ON "Issue"("createdById");

-- CreateIndex
CREATE INDEX "Issue_projectId_idx" ON "Issue"("projectId");

-- CreateIndex
CREATE INDEX "Issue_integrationId_idx" ON "Issue"("integrationId");

-- CreateIndex
CREATE UNIQUE INDEX "Issue_externalId_integrationId_key" ON "Issue"("externalId", "integrationId");

-- CreateIndex
CREATE INDEX "Integration_provider_status_idx" ON "Integration"("provider", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Integration_name_key" ON "Integration"("name");

-- CreateIndex
CREATE UNIQUE INDEX "CodeRepository_name_key" ON "CodeRepository"("name");

-- CreateIndex
CREATE INDEX "CodeRepository_provider_status_idx" ON "CodeRepository"("provider", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectCodeRepositoryConfig_projectId_key" ON "ProjectCodeRepositoryConfig"("projectId");

-- CreateIndex
CREATE INDEX "LlmIntegration_provider_status_idx" ON "LlmIntegration"("provider", "status");

-- CreateIndex
CREATE UNIQUE INDEX "LlmIntegration_name_key" ON "LlmIntegration"("name");

-- CreateIndex
CREATE INDEX "ProjectLlmIntegration_projectId_isActive_idx" ON "ProjectLlmIntegration"("projectId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectLlmIntegration_projectId_llmIntegrationId_key" ON "ProjectLlmIntegration"("projectId", "llmIntegrationId");

-- CreateIndex
CREATE INDEX "UserIntegrationAuth_integrationId_isActive_idx" ON "UserIntegrationAuth"("integrationId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "UserIntegrationAuth_userId_integrationId_key" ON "UserIntegrationAuth"("userId", "integrationId");

-- CreateIndex
CREATE INDEX "JUnitTestSuite_testRunId_idx" ON "JUnitTestSuite"("testRunId");

-- CreateIndex
CREATE INDEX "JUnitTestSuite_parentId_idx" ON "JUnitTestSuite"("parentId");

-- CreateIndex
CREATE INDEX "JUnitTestResult_testSuiteId_idx" ON "JUnitTestResult"("testSuiteId");

-- CreateIndex
CREATE INDEX "JUnitTestResult_repositoryCaseId_idx" ON "JUnitTestResult"("repositoryCaseId");

-- CreateIndex
CREATE INDEX "JUnitTestResult_repositoryCaseId_executedAt_idx" ON "JUnitTestResult"("repositoryCaseId", "executedAt" DESC);

-- CreateIndex
CREATE INDEX "SharedStepGroup_projectId_idx" ON "SharedStepGroup"("projectId");

-- CreateIndex
CREATE INDEX "SharedStepGroup_createdById_idx" ON "SharedStepGroup"("createdById");

-- CreateIndex
CREATE INDEX "SharedStepItem_sharedStepGroupId_idx" ON "SharedStepItem"("sharedStepGroupId");

-- CreateIndex
CREATE INDEX "DataSet_projectId_idx" ON "DataSet"("projectId");

-- CreateIndex
CREATE INDEX "DataSet_ownerCaseId_idx" ON "DataSet"("ownerCaseId");

-- CreateIndex
CREATE INDEX "DataSet_createdById_idx" ON "DataSet"("createdById");

-- CreateIndex
CREATE INDEX "DataSetRow_dataSetId_idx" ON "DataSetRow"("dataSetId");

-- CreateIndex
CREATE UNIQUE INDEX "DataSetRow_dataSetId_rowIndex_key" ON "DataSetRow"("dataSetId", "rowIndex");

-- CreateIndex
CREATE INDEX "DataSetVersion_dataSetId_idx" ON "DataSetVersion"("dataSetId");

-- CreateIndex
CREATE INDEX "DataSetVersion_createdById_idx" ON "DataSetVersion"("createdById");

-- CreateIndex
CREATE UNIQUE INDEX "DataSetVersion_dataSetId_version_key" ON "DataSetVersion"("dataSetId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "CaseSharedDataSetAssignment_caseId_key" ON "CaseSharedDataSetAssignment"("caseId");

-- CreateIndex
CREATE INDEX "CaseSharedDataSetAssignment_caseId_idx" ON "CaseSharedDataSetAssignment"("caseId");

-- CreateIndex
CREATE INDEX "CaseSharedDataSetAssignment_sharedDataSetId_idx" ON "CaseSharedDataSetAssignment"("sharedDataSetId");

-- CreateIndex
CREATE INDEX "CaseSharedDataSetAssignment_pinnedVersionId_idx" ON "CaseSharedDataSetAssignment"("pinnedVersionId");

-- CreateIndex
CREATE INDEX "CaseSharedDataSetAssignment_createdById_idx" ON "CaseSharedDataSetAssignment"("createdById");

-- CreateIndex
CREATE INDEX "Notification_userId_isRead_isDeleted_idx" ON "Notification"("userId", "isRead", "isDeleted");

-- CreateIndex
CREATE INDEX "Notification_createdAt_idx" ON "Notification"("createdAt");

-- CreateIndex
CREATE INDEX "Notification_type_idx" ON "Notification"("type");

-- CreateIndex
CREATE INDEX "ReviewRequest_assigneeUserId_status_idx" ON "ReviewRequest"("assigneeUserId", "status");

-- CreateIndex
CREATE INDEX "ReviewRequest_assigneeRoleId_status_idx" ON "ReviewRequest"("assigneeRoleId", "status");

-- CreateIndex
CREATE INDEX "ReviewRequest_entityType_entityId_status_createdAt_idx" ON "ReviewRequest"("entityType", "entityId", "status", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "ReviewRequest_projectId_status_idx" ON "ReviewRequest"("projectId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ShareLink_shareKey_key" ON "ShareLink"("shareKey");

-- CreateIndex
CREATE INDEX "ShareLink_shareKey_idx" ON "ShareLink"("shareKey");

-- CreateIndex
CREATE INDEX "ShareLink_projectId_createdById_idx" ON "ShareLink"("projectId", "createdById");

-- CreateIndex
CREATE INDEX "ShareLink_entityType_entityId_idx" ON "ShareLink"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "ShareLink_isRevoked_expiresAt_idx" ON "ShareLink"("isRevoked", "expiresAt");

-- CreateIndex
CREATE INDEX "ShareLink_isDeleted_idx" ON "ShareLink"("isDeleted");

-- CreateIndex
CREATE INDEX "ShareLink_createdById_idx" ON "ShareLink"("createdById");

-- CreateIndex
CREATE INDEX "ShareLinkAccessLog_shareLinkId_accessedAt_idx" ON "ShareLinkAccessLog"("shareLinkId", "accessedAt");

-- CreateIndex
CREATE INDEX "ShareLinkAccessLog_accessedById_idx" ON "ShareLinkAccessLog"("accessedById");

-- CreateIndex
CREATE INDEX "ProjectIntegration_integrationId_idx" ON "ProjectIntegration"("integrationId");

-- CreateIndex
CREATE INDEX "ProjectIntegration_isActive_idx" ON "ProjectIntegration"("isActive");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectIntegration_projectId_integrationId_key" ON "ProjectIntegration"("projectId", "integrationId");

-- CreateIndex
CREATE INDEX "IntegrationProject_projectIntegrationId_idx" ON "IntegrationProject"("projectIntegrationId");

-- CreateIndex
CREATE INDEX "IntegrationProject_isActive_idx" ON "IntegrationProject"("isActive");

-- CreateIndex
CREATE UNIQUE INDEX "IntegrationProject_projectIntegrationId_externalProjectId_key" ON "IntegrationProject"("projectIntegrationId", "externalProjectId");

-- CreateIndex
CREATE UNIQUE INDEX "WebhookConfig_token_key" ON "WebhookConfig"("token");

-- CreateIndex
CREATE INDEX "WebhookConfig_projectId_adapterType_direction_idx" ON "WebhookConfig"("projectId", "adapterType", "direction");

-- CreateIndex
CREATE INDEX "WebhookConfig_projectId_idx" ON "WebhookConfig"("projectId");

-- CreateIndex
CREATE INDEX "WebhookConfig_token_idx" ON "WebhookConfig"("token");

-- CreateIndex
CREATE INDEX "WebhookDelivery_webhookConfigId_receivedAt_idx" ON "WebhookDelivery"("webhookConfigId", "receivedAt");

-- CreateIndex
CREATE INDEX "WebhookDelivery_webhookConfigId_eventId_idx" ON "WebhookDelivery"("webhookConfigId", "eventId");

-- CreateIndex
CREATE INDEX "WebhookDelivery_direction_receivedAt_idx" ON "WebhookDelivery"("direction", "receivedAt");

-- CreateIndex
CREATE INDEX "WebhookDelivery_payloadDigest_idx" ON "WebhookDelivery"("payloadDigest");

-- CreateIndex
CREATE INDEX "WebhookDelivery_replayedFromDeliveryId_idx" ON "WebhookDelivery"("replayedFromDeliveryId");

-- CreateIndex
CREATE INDEX "WebhookEventDedup_webhookConfigId_processedAt_idx" ON "WebhookEventDedup"("webhookConfigId", "processedAt");

-- CreateIndex
CREATE UNIQUE INDEX "WebhookEventDedup_webhookConfigId_payloadDigest_key" ON "WebhookEventDedup"("webhookConfigId", "payloadDigest");

-- CreateIndex
CREATE INDEX "WebhookConfigSecret_webhookConfigId_activatedAt_idx" ON "WebhookConfigSecret"("webhookConfigId", "activatedAt");

-- CreateIndex
CREATE INDEX "WebhookConfigSecret_retiredAt_autoRetireAt_idx" ON "WebhookConfigSecret"("retiredAt", "autoRetireAt");

-- CreateIndex
CREATE UNIQUE INDEX "WebhookOutboxEvent_eventId_key" ON "WebhookOutboxEvent"("eventId");

-- CreateIndex
CREATE INDEX "WebhookOutboxEvent_dispatchedAt_createdAt_idx" ON "WebhookOutboxEvent"("dispatchedAt", "createdAt");

-- CreateIndex
CREATE INDEX "WebhookOutboxEvent_projectId_eventName_idx" ON "WebhookOutboxEvent"("projectId", "eventName");

-- CreateIndex
CREATE UNIQUE INDEX "LlmProviderConfig_llmIntegrationId_key" ON "LlmProviderConfig"("llmIntegrationId");

-- CreateIndex
CREATE UNIQUE INDEX "PromptConfig_name_key" ON "PromptConfig"("name");

-- CreateIndex
CREATE INDEX "PromptConfig_isDefault_isActive_isDeleted_idx" ON "PromptConfig"("isDefault", "isActive", "isDeleted");

-- CreateIndex
CREATE INDEX "PromptConfigPrompt_feature_idx" ON "PromptConfigPrompt"("feature");

-- CreateIndex
CREATE INDEX "PromptConfigPrompt_llmIntegrationId_idx" ON "PromptConfigPrompt"("llmIntegrationId");

-- CreateIndex
CREATE UNIQUE INDEX "PromptConfigPrompt_promptConfigId_feature_key" ON "PromptConfigPrompt"("promptConfigId", "feature");

-- CreateIndex
CREATE INDEX "OllamaModelRegistry_llmIntegrationId_isInstalled_idx" ON "OllamaModelRegistry"("llmIntegrationId", "isInstalled");

-- CreateIndex
CREATE UNIQUE INDEX "OllamaModelRegistry_llmIntegrationId_modelName_modelTag_key" ON "OllamaModelRegistry"("llmIntegrationId", "modelName", "modelTag");

-- CreateIndex
CREATE INDEX "LlmUsage_llmIntegrationId_idx" ON "LlmUsage"("llmIntegrationId");

-- CreateIndex
CREATE INDEX "LlmUsage_projectId_idx" ON "LlmUsage"("projectId");

-- CreateIndex
CREATE INDEX "LlmUsage_userId_idx" ON "LlmUsage"("userId");

-- CreateIndex
CREATE INDEX "LlmUsage_feature_idx" ON "LlmUsage"("feature");

-- CreateIndex
CREATE INDEX "LlmUsage_createdAt_idx" ON "LlmUsage"("createdAt");

-- CreateIndex
CREATE INDEX "LlmFeatureConfig_llmIntegrationId_idx" ON "LlmFeatureConfig"("llmIntegrationId");

-- CreateIndex
CREATE UNIQUE INDEX "LlmFeatureConfig_projectId_feature_key" ON "LlmFeatureConfig"("projectId", "feature");

-- CreateIndex
CREATE INDEX "LlmResponseCache_expiresAt_idx" ON "LlmResponseCache"("expiresAt");

-- CreateIndex
CREATE INDEX "LlmResponseCache_lastAccessedAt_idx" ON "LlmResponseCache"("lastAccessedAt");

-- CreateIndex
CREATE INDEX "LlmResponseCache_projectId_feature_idx" ON "LlmResponseCache"("projectId", "feature");

-- CreateIndex
CREATE UNIQUE INDEX "LlmResponseCache_feature_model_promptHash_contextHash_key" ON "LlmResponseCache"("feature", "model", "promptHash", "contextHash");

-- CreateIndex
CREATE INDEX "LlmRateLimit_scope_isActive_idx" ON "LlmRateLimit"("scope", "isActive");

-- CreateIndex
CREATE INDEX "LlmRateLimit_windowStart_idx" ON "LlmRateLimit"("windowStart");

-- CreateIndex
CREATE UNIQUE INDEX "LlmRateLimit_scope_scopeId_feature_key" ON "LlmRateLimit"("scope", "scopeId", "feature");

-- CreateIndex
CREATE INDEX "LlmReportSnapshot_projectId_reportType_completedAt_idx" ON "LlmReportSnapshot"("projectId", "reportType", "completedAt");

-- CreateIndex
CREATE INDEX "LlmReportSnapshot_projectId_isDeleted_idx" ON "LlmReportSnapshot"("projectId", "isDeleted");

-- CreateIndex
CREATE UNIQUE INDEX "SsoProvider_name_key" ON "SsoProvider"("name");

-- CreateIndex
CREATE UNIQUE INDEX "AllowedEmailDomain_domain_key" ON "AllowedEmailDomain"("domain");

-- CreateIndex
CREATE UNIQUE INDEX "SamlConfiguration_providerId_key" ON "SamlConfiguration"("providerId");

-- CreateIndex
CREATE INDEX "TestmoImportJob_createdById_idx" ON "TestmoImportJob"("createdById");

-- CreateIndex
CREATE INDEX "TestmoImportJob_status_idx" ON "TestmoImportJob"("status");

-- CreateIndex
CREATE INDEX "TestmoImportJob_createdAt_idx" ON "TestmoImportJob"("createdAt");

-- CreateIndex
CREATE INDEX "TestmoImportDataset_jobId_idx" ON "TestmoImportDataset"("jobId");

-- CreateIndex
CREATE INDEX "TestmoImportDataset_name_idx" ON "TestmoImportDataset"("name");

-- CreateIndex
CREATE INDEX "TestmoImportStaging_jobId_datasetName_processed_idx" ON "TestmoImportStaging"("jobId", "datasetName", "processed");

-- CreateIndex
CREATE INDEX "TestmoImportStaging_jobId_processed_idx" ON "TestmoImportStaging"("jobId", "processed");

-- CreateIndex
CREATE INDEX "TestmoImportStaging_jobId_datasetName_rowIndex_idx" ON "TestmoImportStaging"("jobId", "datasetName", "rowIndex");

-- CreateIndex
CREATE INDEX "TestmoImportMapping_jobId_entityType_idx" ON "TestmoImportMapping"("jobId", "entityType");

-- CreateIndex
CREATE INDEX "TestmoImportMapping_jobId_entityType_sourceId_idx" ON "TestmoImportMapping"("jobId", "entityType", "sourceId");

-- CreateIndex
CREATE UNIQUE INDEX "TestmoImportMapping_jobId_entityType_sourceId_key" ON "TestmoImportMapping"("jobId", "entityType", "sourceId");

-- CreateIndex
CREATE INDEX "Comment_projectId_isDeleted_createdAt_idx" ON "Comment"("projectId", "isDeleted", "createdAt");

-- CreateIndex
CREATE INDEX "Comment_repositoryCaseId_isDeleted_idx" ON "Comment"("repositoryCaseId", "isDeleted");

-- CreateIndex
CREATE INDEX "Comment_testRunId_isDeleted_idx" ON "Comment"("testRunId", "isDeleted");

-- CreateIndex
CREATE INDEX "Comment_sessionId_isDeleted_idx" ON "Comment"("sessionId", "isDeleted");

-- CreateIndex
CREATE INDEX "Comment_milestoneId_isDeleted_idx" ON "Comment"("milestoneId", "isDeleted");

-- CreateIndex
CREATE INDEX "Comment_reviewRequestId_idx" ON "Comment"("reviewRequestId");

-- CreateIndex
CREATE INDEX "Comment_creatorId_idx" ON "Comment"("creatorId");

-- CreateIndex
CREATE INDEX "CommentMention_userId_createdAt_idx" ON "CommentMention"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "CommentMention_commentId_idx" ON "CommentMention"("commentId");

-- CreateIndex
CREATE UNIQUE INDEX "CommentMention_commentId_userId_key" ON "CommentMention"("commentId", "userId");

-- CreateIndex
CREATE INDEX "AuditLog_entityType_entityId_idx" ON "AuditLog"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "AuditLog_userId_timestamp_idx" ON "AuditLog"("userId", "timestamp");

-- CreateIndex
CREATE INDEX "AuditLog_projectId_timestamp_idx" ON "AuditLog"("projectId", "timestamp");

-- CreateIndex
CREATE INDEX "AuditLog_timestamp_idx" ON "AuditLog"("timestamp");

-- CreateIndex
CREATE INDEX "AuditLog_action_idx" ON "AuditLog"("action");

-- CreateIndex
CREATE INDEX "AuditLog_operationId_idx" ON "AuditLog"("operationId");

-- CreateIndex
CREATE INDEX "dcl_unprocessed_seq" ON "DataChangeLog"("seq");

-- CreateIndex
CREATE INDEX "dcl_table_pk" ON "DataChangeLog"("table", "pk");

-- CreateIndex
CREATE INDEX "dcl_ts" ON "DataChangeLog"("ts");

-- CreateIndex
CREATE INDEX "_TagsToTestRuns_B_index" ON "_TagsToTestRuns"("B");

-- CreateIndex
CREATE INDEX "_RepositoryCasesToTags_B_index" ON "_RepositoryCasesToTags"("B");

-- CreateIndex
CREATE INDEX "_SessionsToTags_B_index" ON "_SessionsToTags"("B");

-- CreateIndex
CREATE INDEX "_IssueToRepositoryCases_B_index" ON "_IssueToRepositoryCases"("B");

-- CreateIndex
CREATE INDEX "_IssueToSessions_B_index" ON "_IssueToSessions"("B");

-- CreateIndex
CREATE INDEX "_IssueToSessionResults_B_index" ON "_IssueToSessionResults"("B");

-- CreateIndex
CREATE INDEX "_IssueToTestRuns_B_index" ON "_IssueToTestRuns"("B");

-- CreateIndex
CREATE INDEX "_IssueToTestRunResults_B_index" ON "_IssueToTestRunResults"("B");

-- CreateIndex
CREATE INDEX "_IssueToTestRunStepResults_B_index" ON "_IssueToTestRunStepResults"("B");

-- AddForeignKey
ALTER TABLE "Account" ADD CONSTRAINT "Account_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Roles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PasswordHistory" ADD CONSTRAINT "PasswordHistory_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserPreferences" ADD CONSTRAINT "UserPreferences_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApiToken" ADD CONSTRAINT "ApiToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScimToken" ADD CONSTRAINT "ScimToken_systemUserId_fkey" FOREIGN KEY ("systemUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScimToken" ADD CONSTRAINT "ScimToken_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScimToken" ADD CONSTRAINT "ScimToken_revokedById_fkey" FOREIGN KEY ("revokedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GroupAssignment" ADD CONSTRAINT "GroupAssignment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GroupAssignment" ADD CONSTRAINT "GroupAssignment_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "Groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Projects" ADD CONSTRAINT "Projects_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Projects" ADD CONSTRAINT "Projects_defaultRoleId_fkey" FOREIGN KEY ("defaultRoleId") REFERENCES "Roles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Projects" ADD CONSTRAINT "Projects_promptConfigId_fkey" FOREIGN KEY ("promptConfigId") REFERENCES "PromptConfig"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Projects" ADD CONSTRAINT "Projects_defaultCaseExportTemplateId_fkey" FOREIGN KEY ("defaultCaseExportTemplateId") REFERENCES "CaseExportTemplate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectAssignment" ADD CONSTRAINT "ProjectAssignment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectAssignment" ADD CONSTRAINT "ProjectAssignment_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectStatusAssignment" ADD CONSTRAINT "ProjectStatusAssignment_statusId_fkey" FOREIGN KEY ("statusId") REFERENCES "Status"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectStatusAssignment" ADD CONSTRAINT "ProjectStatusAssignment_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectConfigurationAssignment" ADD CONSTRAINT "ProjectConfigurationAssignment_configurationId_fkey" FOREIGN KEY ("configurationId") REFERENCES "Configurations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectConfigurationAssignment" ADD CONSTRAINT "ProjectConfigurationAssignment_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectWorkflowAssignment" ADD CONSTRAINT "ProjectWorkflowAssignment_workflowId_fkey" FOREIGN KEY ("workflowId") REFERENCES "Workflows"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectWorkflowAssignment" ADD CONSTRAINT "ProjectWorkflowAssignment_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Milestones" ADD CONSTRAINT "Milestones_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Milestones" ADD CONSTRAINT "Milestones_rootId_fkey" FOREIGN KEY ("rootId") REFERENCES "Milestones"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Milestones" ADD CONSTRAINT "Milestones_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "Milestones"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Milestones" ADD CONSTRAINT "Milestones_milestoneTypesId_fkey" FOREIGN KEY ("milestoneTypesId") REFERENCES "MilestoneTypes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Milestones" ADD CONSTRAINT "Milestones_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MilestoneTypes" ADD CONSTRAINT "MilestoneTypes_iconId_fkey" FOREIGN KEY ("iconId") REFERENCES "FieldIcon"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MilestoneTypesAssignment" ADD CONSTRAINT "MilestoneTypesAssignment_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MilestoneTypesAssignment" ADD CONSTRAINT "MilestoneTypesAssignment_milestoneTypeId_fkey" FOREIGN KEY ("milestoneTypeId") REFERENCES "MilestoneTypes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Color" ADD CONSTRAINT "Color_colorFamilyId_fkey" FOREIGN KEY ("colorFamilyId") REFERENCES "ColorFamily"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CaseFields" ADD CONSTRAINT "CaseFields_typeId_fkey" FOREIGN KEY ("typeId") REFERENCES "CaseFieldTypes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResultFields" ADD CONSTRAINT "ResultFields_typeId_fkey" FOREIGN KEY ("typeId") REFERENCES "CaseFieldTypes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FieldOptions" ADD CONSTRAINT "FieldOptions_iconId_fkey" FOREIGN KEY ("iconId") REFERENCES "FieldIcon"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FieldOptions" ADD CONSTRAINT "FieldOptions_iconColorId_fkey" FOREIGN KEY ("iconColorId") REFERENCES "Color"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TemplateProjectAssignment" ADD CONSTRAINT "TemplateProjectAssignment_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "Templates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TemplateProjectAssignment" ADD CONSTRAINT "TemplateProjectAssignment_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TemplateCaseAssignment" ADD CONSTRAINT "TemplateCaseAssignment_caseFieldId_fkey" FOREIGN KEY ("caseFieldId") REFERENCES "CaseFields"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TemplateCaseAssignment" ADD CONSTRAINT "TemplateCaseAssignment_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "Templates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TemplateResultAssignment" ADD CONSTRAINT "TemplateResultAssignment_resultFieldId_fkey" FOREIGN KEY ("resultFieldId") REFERENCES "ResultFields"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TemplateResultAssignment" ADD CONSTRAINT "TemplateResultAssignment_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "Templates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CaseExportTemplateProjectAssignment" ADD CONSTRAINT "CaseExportTemplateProjectAssignment_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "CaseExportTemplate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CaseExportTemplateProjectAssignment" ADD CONSTRAINT "CaseExportTemplateProjectAssignment_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CaseFieldAssignment" ADD CONSTRAINT "CaseFieldAssignment_fieldOptionId_fkey" FOREIGN KEY ("fieldOptionId") REFERENCES "FieldOptions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CaseFieldAssignment" ADD CONSTRAINT "CaseFieldAssignment_caseFieldId_fkey" FOREIGN KEY ("caseFieldId") REFERENCES "CaseFields"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResultFieldAssignment" ADD CONSTRAINT "ResultFieldAssignment_fieldOptionId_fkey" FOREIGN KEY ("fieldOptionId") REFERENCES "FieldOptions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResultFieldAssignment" ADD CONSTRAINT "ResultFieldAssignment_resultFieldId_fkey" FOREIGN KEY ("resultFieldId") REFERENCES "ResultFields"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Status" ADD CONSTRAINT "Status_colorId_fkey" FOREIGN KEY ("colorId") REFERENCES "Color"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StatusScopeAssignment" ADD CONSTRAINT "StatusScopeAssignment_statusId_fkey" FOREIGN KEY ("statusId") REFERENCES "Status"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StatusScopeAssignment" ADD CONSTRAINT "StatusScopeAssignment_scopeId_fkey" FOREIGN KEY ("scopeId") REFERENCES "StatusScope"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Workflows" ADD CONSTRAINT "Workflows_iconId_fkey" FOREIGN KEY ("iconId") REFERENCES "FieldIcon"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Workflows" ADD CONSTRAINT "Workflows_colorId_fkey" FOREIGN KEY ("colorId") REFERENCES "Color"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConfigVariants" ADD CONSTRAINT "ConfigVariants_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "ConfigCategories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConfigurationConfigVariant" ADD CONSTRAINT "ConfigurationConfigVariant_configurationId_fkey" FOREIGN KEY ("configurationId") REFERENCES "Configurations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConfigurationConfigVariant" ADD CONSTRAINT "ConfigurationConfigVariant_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "ConfigVariants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Repositories" ADD CONSTRAINT "Repositories_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RepositoryFolders" ADD CONSTRAINT "RepositoryFolders_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RepositoryFolders" ADD CONSTRAINT "RepositoryFolders_repositoryId_fkey" FOREIGN KEY ("repositoryId") REFERENCES "Repositories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RepositoryFolders" ADD CONSTRAINT "RepositoryFolders_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "RepositoryFolders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RepositoryFolders" ADD CONSTRAINT "RepositoryFolders_creatorId_fkey" FOREIGN KEY ("creatorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RepositoryCaseLink" ADD CONSTRAINT "RepositoryCaseLink_caseAId_fkey" FOREIGN KEY ("caseAId") REFERENCES "RepositoryCases"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RepositoryCaseLink" ADD CONSTRAINT "RepositoryCaseLink_caseBId_fkey" FOREIGN KEY ("caseBId") REFERENCES "RepositoryCases"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RepositoryCaseLink" ADD CONSTRAINT "RepositoryCaseLink_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DuplicateScanResult" ADD CONSTRAINT "DuplicateScanResult_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DuplicateScanResult" ADD CONSTRAINT "DuplicateScanResult_caseAId_fkey" FOREIGN KEY ("caseAId") REFERENCES "RepositoryCases"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DuplicateScanResult" ADD CONSTRAINT "DuplicateScanResult_caseBId_fkey" FOREIGN KEY ("caseBId") REFERENCES "RepositoryCases"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StepSequenceMatch" ADD CONSTRAINT "StepSequenceMatch_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StepSequenceMatchCase" ADD CONSTRAINT "StepSequenceMatchCase_matchId_fkey" FOREIGN KEY ("matchId") REFERENCES "StepSequenceMatch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StepSequenceMatchCase" ADD CONSTRAINT "StepSequenceMatchCase_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "RepositoryCases"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RepositoryCases" ADD CONSTRAINT "RepositoryCases_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RepositoryCases" ADD CONSTRAINT "RepositoryCases_repositoryId_fkey" FOREIGN KEY ("repositoryId") REFERENCES "Repositories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RepositoryCases" ADD CONSTRAINT "RepositoryCases_folderId_fkey" FOREIGN KEY ("folderId") REFERENCES "RepositoryFolders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RepositoryCases" ADD CONSTRAINT "RepositoryCases_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "Templates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RepositoryCases" ADD CONSTRAINT "RepositoryCases_stateId_fkey" FOREIGN KEY ("stateId") REFERENCES "Workflows"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RepositoryCases" ADD CONSTRAINT "RepositoryCases_creatorId_fkey" FOREIGN KEY ("creatorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RepositoryCaseVersions" ADD CONSTRAINT "RepositoryCaseVersions_repositoryCaseId_fkey" FOREIGN KEY ("repositoryCaseId") REFERENCES "RepositoryCases"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RepositoryCaseVersions" ADD CONSTRAINT "RepositoryCaseVersions_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CaseFieldValues" ADD CONSTRAINT "CaseFieldValues_testCaseId_fkey" FOREIGN KEY ("testCaseId") REFERENCES "RepositoryCases"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CaseFieldValues" ADD CONSTRAINT "CaseFieldValues_fieldId_fkey" FOREIGN KEY ("fieldId") REFERENCES "CaseFields"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CaseFieldVersionValues" ADD CONSTRAINT "CaseFieldVersionValues_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "RepositoryCaseVersions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResultFieldValues" ADD CONSTRAINT "ResultFieldValues_testCaseId_fkey" FOREIGN KEY ("testCaseId") REFERENCES "RepositoryCases"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResultFieldValues" ADD CONSTRAINT "ResultFieldValues_fieldId_fkey" FOREIGN KEY ("fieldId") REFERENCES "ResultFields"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResultFieldValues" ADD CONSTRAINT "ResultFieldValues_sessionResultsId_fkey" FOREIGN KEY ("sessionResultsId") REFERENCES "SessionResults"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResultFieldValues" ADD CONSTRAINT "ResultFieldValues_testRunResultsId_fkey" FOREIGN KEY ("testRunResultsId") REFERENCES "TestRunResults"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Attachments" ADD CONSTRAINT "Attachments_testCaseId_fkey" FOREIGN KEY ("testCaseId") REFERENCES "RepositoryCases"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Attachments" ADD CONSTRAINT "Attachments_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Attachments" ADD CONSTRAINT "Attachments_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Attachments" ADD CONSTRAINT "Attachments_sessionResultsId_fkey" FOREIGN KEY ("sessionResultsId") REFERENCES "SessionResults"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Attachments" ADD CONSTRAINT "Attachments_testRunsId_fkey" FOREIGN KEY ("testRunsId") REFERENCES "TestRuns"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Attachments" ADD CONSTRAINT "Attachments_testRunResultsId_fkey" FOREIGN KEY ("testRunResultsId") REFERENCES "TestRunResults"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Attachments" ADD CONSTRAINT "Attachments_testRunStepResultId_fkey" FOREIGN KEY ("testRunStepResultId") REFERENCES "TestRunStepResults"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Attachments" ADD CONSTRAINT "Attachments_junitTestResultId_fkey" FOREIGN KEY ("junitTestResultId") REFERENCES "JUnitTestResult"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Steps" ADD CONSTRAINT "Steps_testCaseId_fkey" FOREIGN KEY ("testCaseId") REFERENCES "RepositoryCases"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Steps" ADD CONSTRAINT "Steps_sharedStepGroupId_fkey" FOREIGN KEY ("sharedStepGroupId") REFERENCES "SharedStepGroup"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TestCaseParameter" ADD CONSTRAINT "TestCaseParameter_testCaseId_fkey" FOREIGN KEY ("testCaseId") REFERENCES "RepositoryCases"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TestCaseParameter" ADD CONSTRAINT "TestCaseParameter_lookupDataSetId_fkey" FOREIGN KEY ("lookupDataSetId") REFERENCES "DataSet"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Sessions" ADD CONSTRAINT "Sessions_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Sessions" ADD CONSTRAINT "Sessions_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "Templates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Sessions" ADD CONSTRAINT "Sessions_configId_fkey" FOREIGN KEY ("configId") REFERENCES "Configurations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Sessions" ADD CONSTRAINT "Sessions_milestoneId_fkey" FOREIGN KEY ("milestoneId") REFERENCES "Milestones"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Sessions" ADD CONSTRAINT "Sessions_stateId_fkey" FOREIGN KEY ("stateId") REFERENCES "Workflows"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Sessions" ADD CONSTRAINT "Sessions_assignedToId_fkey" FOREIGN KEY ("assignedToId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Sessions" ADD CONSTRAINT "Sessions_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SessionResults" ADD CONSTRAINT "SessionResults_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SessionResults" ADD CONSTRAINT "SessionResults_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SessionResults" ADD CONSTRAINT "SessionResults_statusId_fkey" FOREIGN KEY ("statusId") REFERENCES "Status"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SessionVersions" ADD CONSTRAINT "SessionVersions_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SessionVersions" ADD CONSTRAINT "SessionVersions_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SessionFieldValues" ADD CONSTRAINT "SessionFieldValues_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SessionFieldValues" ADD CONSTRAINT "SessionFieldValues_fieldId_fkey" FOREIGN KEY ("fieldId") REFERENCES "CaseFields"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TestRuns" ADD CONSTRAINT "TestRuns_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TestRuns" ADD CONSTRAINT "TestRuns_configId_fkey" FOREIGN KEY ("configId") REFERENCES "Configurations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TestRuns" ADD CONSTRAINT "TestRuns_milestoneId_fkey" FOREIGN KEY ("milestoneId") REFERENCES "Milestones"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TestRuns" ADD CONSTRAINT "TestRuns_stateId_fkey" FOREIGN KEY ("stateId") REFERENCES "Workflows"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TestRuns" ADD CONSTRAINT "TestRuns_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TestRunCases" ADD CONSTRAINT "TestRunCases_testRunId_fkey" FOREIGN KEY ("testRunId") REFERENCES "TestRuns"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TestRunCases" ADD CONSTRAINT "TestRunCases_repositoryCaseId_fkey" FOREIGN KEY ("repositoryCaseId") REFERENCES "RepositoryCases"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TestRunCases" ADD CONSTRAINT "TestRunCases_statusId_fkey" FOREIGN KEY ("statusId") REFERENCES "Status"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TestRunCases" ADD CONSTRAINT "TestRunCases_assignedToId_fkey" FOREIGN KEY ("assignedToId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TestRunResults" ADD CONSTRAINT "TestRunResults_testRunId_fkey" FOREIGN KEY ("testRunId") REFERENCES "TestRuns"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TestRunResults" ADD CONSTRAINT "TestRunResults_testRunCaseId_fkey" FOREIGN KEY ("testRunCaseId") REFERENCES "TestRunCases"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TestRunResults" ADD CONSTRAINT "TestRunResults_statusId_fkey" FOREIGN KEY ("statusId") REFERENCES "Status"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TestRunResults" ADD CONSTRAINT "TestRunResults_executedById_fkey" FOREIGN KEY ("executedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TestRunResults" ADD CONSTRAINT "TestRunResults_editedById_fkey" FOREIGN KEY ("editedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TestRunResults" ADD CONSTRAINT "TestRunResults_iterationId_fkey" FOREIGN KEY ("iterationId") REFERENCES "TestRunCaseIteration"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TestRunStepResults" ADD CONSTRAINT "TestRunStepResults_testRunResultId_fkey" FOREIGN KEY ("testRunResultId") REFERENCES "TestRunResults"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TestRunStepResults" ADD CONSTRAINT "TestRunStepResults_stepId_fkey" FOREIGN KEY ("stepId") REFERENCES "Steps"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TestRunStepResults" ADD CONSTRAINT "test_run_step_results_shared_step_item_id_fkey" FOREIGN KEY ("sharedStepItemId") REFERENCES "SharedStepItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TestRunStepResults" ADD CONSTRAINT "TestRunStepResults_statusId_fkey" FOREIGN KEY ("statusId") REFERENCES "Status"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TestRunCaseIteration" ADD CONSTRAINT "TestRunCaseIteration_testRunCaseId_fkey" FOREIGN KEY ("testRunCaseId") REFERENCES "TestRunCases"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TestRunCaseIteration" ADD CONSTRAINT "TestRunCaseIteration_statusId_fkey" FOREIGN KEY ("statusId") REFERENCES "Status"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TestRunCaseIteration" ADD CONSTRAINT "TestRunCaseIteration_assignedToId_fkey" FOREIGN KEY ("assignedToId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TestRunCaseIteration" ADD CONSTRAINT "TestRunCaseIteration_dataSetSnapshotId_fkey" FOREIGN KEY ("dataSetSnapshotId") REFERENCES "TestRunCaseDataSetSnapshot"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TestRunCaseDataSetSnapshot" ADD CONSTRAINT "TestRunCaseDataSetSnapshot_testRunCaseId_fkey" FOREIGN KEY ("testRunCaseId") REFERENCES "TestRunCases"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TestRunCaseDataSetSnapshot" ADD CONSTRAINT "TestRunCaseDataSetSnapshot_sourceDataSetId_fkey" FOREIGN KEY ("sourceDataSetId") REFERENCES "DataSet"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TestRunCaseDataSetSnapshot" ADD CONSTRAINT "TestRunCaseDataSetSnapshot_sourceVersionId_fkey" FOREIGN KEY ("sourceVersionId") REFERENCES "DataSetVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Issue" ADD CONSTRAINT "Issue_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Issue" ADD CONSTRAINT "Issue_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Issue" ADD CONSTRAINT "Issue_integrationId_fkey" FOREIGN KEY ("integrationId") REFERENCES "Integration"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectCodeRepositoryConfig" ADD CONSTRAINT "ProjectCodeRepositoryConfig_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectCodeRepositoryConfig" ADD CONSTRAINT "ProjectCodeRepositoryConfig_repositoryId_fkey" FOREIGN KEY ("repositoryId") REFERENCES "CodeRepository"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectLlmIntegration" ADD CONSTRAINT "ProjectLlmIntegration_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectLlmIntegration" ADD CONSTRAINT "ProjectLlmIntegration_llmIntegrationId_fkey" FOREIGN KEY ("llmIntegrationId") REFERENCES "LlmIntegration"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserIntegrationAuth" ADD CONSTRAINT "UserIntegrationAuth_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserIntegrationAuth" ADD CONSTRAINT "UserIntegrationAuth_integrationId_fkey" FOREIGN KEY ("integrationId") REFERENCES "Integration"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RolePermission" ADD CONSTRAINT "RolePermission_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserProjectPermission" ADD CONSTRAINT "UserProjectPermission_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserProjectPermission" ADD CONSTRAINT "UserProjectPermission_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserProjectPermission" ADD CONSTRAINT "UserProjectPermission_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Roles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GroupProjectPermission" ADD CONSTRAINT "GroupProjectPermission_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "Groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GroupProjectPermission" ADD CONSTRAINT "GroupProjectPermission_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GroupProjectPermission" ADD CONSTRAINT "GroupProjectPermission_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Roles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JUnitTestSuite" ADD CONSTRAINT "JUnitTestSuite_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "JUnitTestSuite"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JUnitTestSuite" ADD CONSTRAINT "JUnitTestSuite_testRunId_fkey" FOREIGN KEY ("testRunId") REFERENCES "TestRuns"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JUnitTestSuite" ADD CONSTRAINT "JUnitTestSuite_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JUnitTestResult" ADD CONSTRAINT "JUnitTestResult_repositoryCaseId_fkey" FOREIGN KEY ("repositoryCaseId") REFERENCES "RepositoryCases"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JUnitTestResult" ADD CONSTRAINT "JUnitTestResult_testSuiteId_fkey" FOREIGN KEY ("testSuiteId") REFERENCES "JUnitTestSuite"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JUnitTestResult" ADD CONSTRAINT "JUnitTestResult_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JUnitTestResult" ADD CONSTRAINT "JUnitTestResult_statusId_fkey" FOREIGN KEY ("statusId") REFERENCES "Status"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JUnitProperty" ADD CONSTRAINT "JUnitProperty_testSuiteId_fkey" FOREIGN KEY ("testSuiteId") REFERENCES "JUnitTestSuite"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JUnitProperty" ADD CONSTRAINT "JUnitProperty_repositoryCaseId_fkey" FOREIGN KEY ("repositoryCaseId") REFERENCES "RepositoryCases"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JUnitProperty" ADD CONSTRAINT "JUnitProperty_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JUnitAttachment" ADD CONSTRAINT "JUnitAttachment_repositoryCaseId_fkey" FOREIGN KEY ("repositoryCaseId") REFERENCES "RepositoryCases"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JUnitAttachment" ADD CONSTRAINT "JUnitAttachment_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JUnitTestStep" ADD CONSTRAINT "JUnitTestStep_statusId_fkey" FOREIGN KEY ("statusId") REFERENCES "Status"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JUnitTestStep" ADD CONSTRAINT "JUnitTestStep_repositoryCaseId_fkey" FOREIGN KEY ("repositoryCaseId") REFERENCES "RepositoryCases"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JUnitTestStep" ADD CONSTRAINT "JUnitTestStep_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SharedStepGroup" ADD CONSTRAINT "SharedStepGroup_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SharedStepGroup" ADD CONSTRAINT "SharedStepGroup_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SharedStepItem" ADD CONSTRAINT "SharedStepItem_sharedStepGroupId_fkey" FOREIGN KEY ("sharedStepGroupId") REFERENCES "SharedStepGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DataSet" ADD CONSTRAINT "DataSet_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DataSet" ADD CONSTRAINT "DataSet_ownerCaseId_fkey" FOREIGN KEY ("ownerCaseId") REFERENCES "RepositoryCases"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DataSet" ADD CONSTRAINT "DataSet_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DataSetRow" ADD CONSTRAINT "DataSetRow_dataSetId_fkey" FOREIGN KEY ("dataSetId") REFERENCES "DataSet"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DataSetVersion" ADD CONSTRAINT "DataSetVersion_dataSetId_fkey" FOREIGN KEY ("dataSetId") REFERENCES "DataSet"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DataSetVersion" ADD CONSTRAINT "DataSetVersion_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CaseSharedDataSetAssignment" ADD CONSTRAINT "CaseSharedDataSetAssignment_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "RepositoryCases"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CaseSharedDataSetAssignment" ADD CONSTRAINT "CaseSharedDataSetAssignment_sharedDataSetId_fkey" FOREIGN KEY ("sharedDataSetId") REFERENCES "DataSet"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CaseSharedDataSetAssignment" ADD CONSTRAINT "CaseSharedDataSetAssignment_pinnedVersionId_fkey" FOREIGN KEY ("pinnedVersionId") REFERENCES "DataSetVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CaseSharedDataSetAssignment" ADD CONSTRAINT "CaseSharedDataSetAssignment_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReviewRequest" ADD CONSTRAINT "ReviewRequest_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReviewRequest" ADD CONSTRAINT "ReviewRequest_requestedByUserId_fkey" FOREIGN KEY ("requestedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReviewRequest" ADD CONSTRAINT "ReviewRequest_assigneeUserId_fkey" FOREIGN KEY ("assigneeUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReviewRequest" ADD CONSTRAINT "ReviewRequest_assigneeRoleId_fkey" FOREIGN KEY ("assigneeRoleId") REFERENCES "Roles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReviewRequest" ADD CONSTRAINT "ReviewRequest_fromStateId_fkey" FOREIGN KEY ("fromStateId") REFERENCES "Workflows"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReviewRequest" ADD CONSTRAINT "ReviewRequest_toStateId_fkey" FOREIGN KEY ("toStateId") REFERENCES "Workflows"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReviewRequest" ADD CONSTRAINT "ReviewRequest_decidedByUserId_fkey" FOREIGN KEY ("decidedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShareLink" ADD CONSTRAINT "ShareLink_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShareLink" ADD CONSTRAINT "ShareLink_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShareLinkAccessLog" ADD CONSTRAINT "ShareLinkAccessLog_shareLinkId_fkey" FOREIGN KEY ("shareLinkId") REFERENCES "ShareLink"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShareLinkAccessLog" ADD CONSTRAINT "ShareLinkAccessLog_accessedById_fkey" FOREIGN KEY ("accessedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectIntegration" ADD CONSTRAINT "ProjectIntegration_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectIntegration" ADD CONSTRAINT "ProjectIntegration_integrationId_fkey" FOREIGN KEY ("integrationId") REFERENCES "Integration"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IntegrationProject" ADD CONSTRAINT "IntegrationProject_projectIntegrationId_fkey" FOREIGN KEY ("projectIntegrationId") REFERENCES "ProjectIntegration"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WebhookConfig" ADD CONSTRAINT "WebhookConfig_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WebhookDelivery" ADD CONSTRAINT "WebhookDelivery_webhookConfigId_fkey" FOREIGN KEY ("webhookConfigId") REFERENCES "WebhookConfig"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WebhookDelivery" ADD CONSTRAINT "WebhookDelivery_replayedFromDeliveryId_fkey" FOREIGN KEY ("replayedFromDeliveryId") REFERENCES "WebhookDelivery"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WebhookEventDedup" ADD CONSTRAINT "WebhookEventDedup_webhookConfigId_fkey" FOREIGN KEY ("webhookConfigId") REFERENCES "WebhookConfig"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WebhookConfigSecret" ADD CONSTRAINT "WebhookConfigSecret_webhookConfigId_fkey" FOREIGN KEY ("webhookConfigId") REFERENCES "WebhookConfig"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WebhookOutboxEvent" ADD CONSTRAINT "WebhookOutboxEvent_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LlmProviderConfig" ADD CONSTRAINT "LlmProviderConfig_llmIntegrationId_fkey" FOREIGN KEY ("llmIntegrationId") REFERENCES "LlmIntegration"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PromptConfigPrompt" ADD CONSTRAINT "PromptConfigPrompt_promptConfigId_fkey" FOREIGN KEY ("promptConfigId") REFERENCES "PromptConfig"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PromptConfigPrompt" ADD CONSTRAINT "PromptConfigPrompt_llmIntegrationId_fkey" FOREIGN KEY ("llmIntegrationId") REFERENCES "LlmIntegration"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OllamaModelRegistry" ADD CONSTRAINT "OllamaModelRegistry_llmIntegrationId_fkey" FOREIGN KEY ("llmIntegrationId") REFERENCES "LlmIntegration"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LlmUsage" ADD CONSTRAINT "LlmUsage_llmIntegrationId_fkey" FOREIGN KEY ("llmIntegrationId") REFERENCES "LlmIntegration"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LlmUsage" ADD CONSTRAINT "LlmUsage_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Projects"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LlmUsage" ADD CONSTRAINT "LlmUsage_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LlmFeatureConfig" ADD CONSTRAINT "LlmFeatureConfig_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LlmFeatureConfig" ADD CONSTRAINT "LlmFeatureConfig_llmIntegrationId_fkey" FOREIGN KEY ("llmIntegrationId") REFERENCES "LlmIntegration"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LlmResponseCache" ADD CONSTRAINT "LlmResponseCache_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LlmResponseCache" ADD CONSTRAINT "LlmResponseCache_llmIntegrationId_fkey" FOREIGN KEY ("llmIntegrationId") REFERENCES "LlmIntegration"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LlmRateLimit" ADD CONSTRAINT "LlmRateLimit_llmIntegrationId_fkey" FOREIGN KEY ("llmIntegrationId") REFERENCES "LlmIntegration"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LlmReportSnapshot" ADD CONSTRAINT "LlmReportSnapshot_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LlmReportSnapshot" ADD CONSTRAINT "LlmReportSnapshot_llmIntegrationId_fkey" FOREIGN KEY ("llmIntegrationId") REFERENCES "LlmIntegration"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LlmReportSnapshot" ADD CONSTRAINT "LlmReportSnapshot_generatedById_fkey" FOREIGN KEY ("generatedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AllowedEmailDomain" ADD CONSTRAINT "AllowedEmailDomain_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SamlConfiguration" ADD CONSTRAINT "SamlConfiguration_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "SsoProvider"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TestmoImportJob" ADD CONSTRAINT "TestmoImportJob_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TestmoImportDataset" ADD CONSTRAINT "TestmoImportDataset_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "TestmoImportJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Comment" ADD CONSTRAINT "Comment_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Comment" ADD CONSTRAINT "Comment_repositoryCaseId_fkey" FOREIGN KEY ("repositoryCaseId") REFERENCES "RepositoryCases"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Comment" ADD CONSTRAINT "Comment_testRunId_fkey" FOREIGN KEY ("testRunId") REFERENCES "TestRuns"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Comment" ADD CONSTRAINT "Comment_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Comment" ADD CONSTRAINT "Comment_milestoneId_fkey" FOREIGN KEY ("milestoneId") REFERENCES "Milestones"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Comment" ADD CONSTRAINT "Comment_reviewRequestId_fkey" FOREIGN KEY ("reviewRequestId") REFERENCES "ReviewRequest"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Comment" ADD CONSTRAINT "Comment_creatorId_fkey" FOREIGN KEY ("creatorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommentMention" ADD CONSTRAINT "CommentMention_commentId_fkey" FOREIGN KEY ("commentId") REFERENCES "Comment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommentMention" ADD CONSTRAINT "CommentMention_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Projects"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_TagsToTestRuns" ADD CONSTRAINT "_TagsToTestRuns_A_fkey" FOREIGN KEY ("A") REFERENCES "Tags"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_TagsToTestRuns" ADD CONSTRAINT "_TagsToTestRuns_B_fkey" FOREIGN KEY ("B") REFERENCES "TestRuns"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_RepositoryCasesToTags" ADD CONSTRAINT "_RepositoryCasesToTags_A_fkey" FOREIGN KEY ("A") REFERENCES "RepositoryCases"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_RepositoryCasesToTags" ADD CONSTRAINT "_RepositoryCasesToTags_B_fkey" FOREIGN KEY ("B") REFERENCES "Tags"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_SessionsToTags" ADD CONSTRAINT "_SessionsToTags_A_fkey" FOREIGN KEY ("A") REFERENCES "Sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_SessionsToTags" ADD CONSTRAINT "_SessionsToTags_B_fkey" FOREIGN KEY ("B") REFERENCES "Tags"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_IssueToRepositoryCases" ADD CONSTRAINT "_IssueToRepositoryCases_A_fkey" FOREIGN KEY ("A") REFERENCES "Issue"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_IssueToRepositoryCases" ADD CONSTRAINT "_IssueToRepositoryCases_B_fkey" FOREIGN KEY ("B") REFERENCES "RepositoryCases"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_IssueToSessions" ADD CONSTRAINT "_IssueToSessions_A_fkey" FOREIGN KEY ("A") REFERENCES "Issue"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_IssueToSessions" ADD CONSTRAINT "_IssueToSessions_B_fkey" FOREIGN KEY ("B") REFERENCES "Sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_IssueToSessionResults" ADD CONSTRAINT "_IssueToSessionResults_A_fkey" FOREIGN KEY ("A") REFERENCES "Issue"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_IssueToSessionResults" ADD CONSTRAINT "_IssueToSessionResults_B_fkey" FOREIGN KEY ("B") REFERENCES "SessionResults"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_IssueToTestRuns" ADD CONSTRAINT "_IssueToTestRuns_A_fkey" FOREIGN KEY ("A") REFERENCES "Issue"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_IssueToTestRuns" ADD CONSTRAINT "_IssueToTestRuns_B_fkey" FOREIGN KEY ("B") REFERENCES "TestRuns"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_IssueToTestRunResults" ADD CONSTRAINT "_IssueToTestRunResults_A_fkey" FOREIGN KEY ("A") REFERENCES "Issue"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_IssueToTestRunResults" ADD CONSTRAINT "_IssueToTestRunResults_B_fkey" FOREIGN KEY ("B") REFERENCES "TestRunResults"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_IssueToTestRunStepResults" ADD CONSTRAINT "_IssueToTestRunStepResults_A_fkey" FOREIGN KEY ("A") REFERENCES "Issue"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_IssueToTestRunStepResults" ADD CONSTRAINT "_IssueToTestRunStepResults_B_fkey" FOREIGN KEY ("B") REFERENCES "TestRunStepResults"("id") ON DELETE CASCADE ON UPDATE CASCADE;
