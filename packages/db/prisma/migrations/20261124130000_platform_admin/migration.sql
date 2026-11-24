CREATE TABLE "PlatformAdminAuditEvent" (
  "id" TEXT NOT NULL,
  "actorId" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "metadata" JSONB NOT NULL DEFAULT '{}',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PlatformAdminAuditEvent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "PlatformAdminAuditEvent_actorId_createdAt_idx"
  ON "PlatformAdminAuditEvent"("actorId", "createdAt");

ALTER TABLE "PlatformAdminAuditEvent"
  ADD CONSTRAINT "PlatformAdminAuditEvent_actorId_fkey"
  FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
