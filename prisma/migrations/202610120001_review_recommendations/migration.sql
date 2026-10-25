ALTER TABLE "LearningSession" ADD COLUMN "hintsUsed" JSONB NOT NULL DEFAULT '[]';
CREATE TABLE "DayReview" (
  "id" TEXT NOT NULL, "day" TEXT NOT NULL, "maintenanceMinutes" INTEGER NOT NULL,
  "savedMinutes" INTEGER NOT NULL, "usefulStep" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL, CONSTRAINT "DayReview_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "DayReview_day_key" ON "DayReview"("day");
