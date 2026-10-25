CREATE TABLE "MealEntry" (
 "id" TEXT NOT NULL, "externalId" TEXT NOT NULL, "day" TEXT NOT NULL,
 "description" TEXT NOT NULL, "calories" DOUBLE PRECISION NOT NULL, "protein" DOUBLE PRECISION NOT NULL,
 "carbs" DOUBLE PRECISION, "fat" DOUBLE PRECISION, "estimated" BOOLEAN NOT NULL DEFAULT true,
 "quantities" TEXT, "revision" INTEGER NOT NULL DEFAULT 1, "deletedAt" TIMESTAMP(3),
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
 CONSTRAINT "MealEntry_pkey" PRIMARY KEY ("id"),
 CONSTRAINT "MealEntry_values" CHECK ("calories" >= 0 AND "protein" >= 0 AND ("carbs" IS NULL OR "carbs" >= 0) AND ("fat" IS NULL OR "fat" >= 0))
);
CREATE UNIQUE INDEX "MealEntry_externalId_key" ON "MealEntry"("externalId");
CREATE INDEX "MealEntry_day_deletedAt_idx" ON "MealEntry"("day", "deletedAt");
CREATE TABLE "PersonalSettings" (
 "id" TEXT NOT NULL DEFAULT 'singleton', "calorieTarget" INTEGER, "proteinTarget" DOUBLE PRECISION,
 "autoAnalyze" BOOLEAN NOT NULL DEFAULT true, "autoDraft" BOOLEAN NOT NULL DEFAULT true,
 "calendarIds" JSONB NOT NULL, "updatedAt" TIMESTAMP(3) NOT NULL,
 CONSTRAINT "PersonalSettings_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "DailyBriefing" (
 "id" TEXT NOT NULL, "day" TEXT NOT NULL, "snapshot" JSONB NOT NULL,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
 CONSTRAINT "DailyBriefing_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "DailyBriefing_day_key" ON "DailyBriefing"("day");
