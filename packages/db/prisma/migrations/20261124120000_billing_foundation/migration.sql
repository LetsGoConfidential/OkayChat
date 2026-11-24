CREATE TYPE "BillingPlan" AS ENUM ('FREE', 'STARTER', 'GROWTH', 'PRO', 'AGENCY', 'ENTERPRISE');
CREATE TYPE "SubscriptionStatus" AS ENUM ('ACTIVE', 'TRIALING', 'PAST_DUE', 'CANCELED');

CREATE TABLE "WorkspaceSubscription" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "plan" "BillingPlan" NOT NULL DEFAULT 'FREE',
  "status" "SubscriptionStatus" NOT NULL DEFAULT 'ACTIVE',
  "provider" TEXT,
  "providerCustomerId" TEXT,
  "providerSubscriptionId" TEXT,
  "currentPeriodStart" TIMESTAMP(3),
  "currentPeriodEnd" TIMESTAMP(3),
  "cancelAtPeriodEnd" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "WorkspaceSubscription_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "WorkspaceSubscription_workspaceId_key" ON "WorkspaceSubscription"("workspaceId");
CREATE UNIQUE INDEX "WorkspaceSubscription_providerCustomerId_key" ON "WorkspaceSubscription"("providerCustomerId");
CREATE UNIQUE INDEX "WorkspaceSubscription_providerSubscriptionId_key" ON "WorkspaceSubscription"("providerSubscriptionId");
CREATE INDEX "WorkspaceSubscription_plan_status_idx" ON "WorkspaceSubscription"("plan", "status");

ALTER TABLE "WorkspaceSubscription"
  ADD CONSTRAINT "WorkspaceSubscription_workspaceId_fkey"
  FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

INSERT INTO "WorkspaceSubscription" ("id", "workspaceId", "plan", "status", "updatedAt")
SELECT md5("id" || ':billing'), "id", 'FREE'::"BillingPlan", 'ACTIVE'::"SubscriptionStatus", CURRENT_TIMESTAMP
FROM "Workspace";
