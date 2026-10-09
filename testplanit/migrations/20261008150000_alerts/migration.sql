-- Alerts (#651): rules that watch a testing metric and notify an
-- audience when it crosses a user-defined line.

-- Notification raised for each subscriber of a rule when it fires.
ALTER TYPE "NotificationType" ADD VALUE 'ALERT_TRIGGERED';

-- Role area: Add/Edit lets a role create its own alerts in a project.
ALTER TYPE "ApplicationArea" ADD VALUE 'Alerts';

-- CreateEnum
CREATE TYPE "AlertMetric" AS ENUM ('RESULT_DURATION_DEVIATION', 'CASE_REGRESSED', 'CONSECUTIVE_FAILURES', 'CASE_FLAKY', 'RUN_PASS_RATE_BELOW', 'RUN_FAILURE_COUNT', 'MILESTONE_BEHIND', 'MILESTONE_OVERDUE');

-- CreateEnum
CREATE TYPE "AlertScopeType" AS ENUM ('PROJECT', 'FOLDER', 'TAG', 'CASE', 'RUN_NAME', 'MILESTONE');

-- CreateEnum
CREATE TYPE "AlertDirection" AS ENUM ('ABOVE', 'BELOW', 'EITHER');

-- CreateEnum
CREATE TYPE "AlertBaseline" AS ENUM ('MEAN', 'MEDIAN');

-- CreateEnum
CREATE TYPE "AlertResultSource" AS ENUM ('MANUAL', 'AUTOMATED', 'BOTH');

-- CreateEnum
CREATE TYPE "AlertEvaluateOn" AS ENUM ('RUN_COMPLETION', 'AS_RESULTS_ARRIVE');

-- CreateEnum
CREATE TYPE "AlertSubjectType" AS ENUM ('CASE', 'RUN', 'MILESTONE');

-- CreateTable
CREATE TABLE "AlertRule" (
    "id" SERIAL NOT NULL,
    "projectId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "metric" "AlertMetric" NOT NULL,
    "scopeType" "AlertScopeType" NOT NULL DEFAULT 'PROJECT',
    "scopeId" INTEGER,
    "scopeText" TEXT,
    "thresholdValue" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "secondaryValue" INTEGER,
    "direction" "AlertDirection" NOT NULL DEFAULT 'EITHER',
    "baselineType" "AlertBaseline" NOT NULL DEFAULT 'MEDIAN',
    "baselineWindow" INTEGER NOT NULL DEFAULT 10,
    "minSamples" INTEGER NOT NULL DEFAULT 5,
    "resultSource" "AlertResultSource" NOT NULL DEFAULT 'BOTH',
    "evaluateOn" "AlertEvaluateOn" NOT NULL DEFAULT 'RUN_COMPLETION',
    "cooldownMinutes" INTEGER NOT NULL DEFAULT 1440,
    "emitWebhook" BOOLEAN NOT NULL DEFAULT false,
    "isEnabled" BOOLEAN NOT NULL DEFAULT true,
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,
    "deletedAt" TIMESTAMPTZ(6),
    "lastFiredAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT NOT NULL,

    CONSTRAINT "AlertRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AlertSubscriber" (
    "id" SERIAL NOT NULL,
    "ruleId" INTEGER NOT NULL,
    "userId" TEXT NOT NULL,
    "addedById" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AlertSubscriber_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AlertEvent" (
    "id" SERIAL NOT NULL,
    "ruleId" INTEGER NOT NULL,
    "projectId" INTEGER NOT NULL,
    "subjectType" "AlertSubjectType" NOT NULL,
    "subjectId" INTEGER NOT NULL,
    "subjectName" TEXT NOT NULL,
    "observedValue" DOUBLE PRECISION NOT NULL,
    "baselineValue" DOUBLE PRECISION,
    "thresholdValue" DOUBLE PRECISION NOT NULL,
    "details" JSONB,
    "notifiedCount" INTEGER NOT NULL DEFAULT 0,
    "webhookEmitted" BOOLEAN NOT NULL DEFAULT false,
    "firedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AlertEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AlertRule_projectId_isDeleted_isEnabled_idx" ON "AlertRule"("projectId", "isDeleted", "isEnabled");

-- CreateIndex
CREATE INDEX "AlertRule_projectId_metric_idx" ON "AlertRule"("projectId", "metric");

-- CreateIndex
CREATE UNIQUE INDEX "AlertSubscriber_ruleId_userId_key" ON "AlertSubscriber"("ruleId", "userId");

-- CreateIndex
CREATE INDEX "AlertSubscriber_userId_idx" ON "AlertSubscriber"("userId");

-- CreateIndex
CREATE INDEX "AlertEvent_ruleId_subjectType_subjectId_firedAt_idx" ON "AlertEvent"("ruleId", "subjectType", "subjectId", "firedAt" DESC);

-- CreateIndex
CREATE INDEX "AlertEvent_ruleId_firedAt_idx" ON "AlertEvent"("ruleId", "firedAt" DESC);

-- CreateIndex
CREATE INDEX "AlertEvent_projectId_firedAt_idx" ON "AlertEvent"("projectId", "firedAt" DESC);

-- AddForeignKey
ALTER TABLE "AlertRule" ADD CONSTRAINT "AlertRule_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AlertRule" ADD CONSTRAINT "AlertRule_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AlertSubscriber" ADD CONSTRAINT "AlertSubscriber_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "AlertRule"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AlertSubscriber" ADD CONSTRAINT "AlertSubscriber_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AlertSubscriber" ADD CONSTRAINT "AlertSubscriber_addedById_fkey" FOREIGN KEY ("addedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AlertEvent" ADD CONSTRAINT "AlertEvent_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "AlertRule"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AlertEvent" ADD CONSTRAINT "AlertEvent_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
