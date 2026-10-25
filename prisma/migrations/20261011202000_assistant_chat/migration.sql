CREATE TABLE "AssistantTurn" (
 "id" TEXT NOT NULL, "message" TEXT NOT NULL, "response" TEXT,
 "status" TEXT NOT NULL DEFAULT 'running',
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
 CONSTRAINT "AssistantTurn_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "AssistantTurn_createdAt_idx" ON "AssistantTurn"("createdAt");
