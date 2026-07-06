-- CreateIndex
CREATE INDEX "User_name_sector_idx" ON "User"("name", "sector");

-- CreateIndex
CREATE INDEX "User_senhaDate_idx" ON "User"("senhaDate");

-- CreateIndex
CREATE INDEX "User_status_idx" ON "User"("status");

-- CreateIndex
CREATE INDEX "User_createdAt_idx" ON "User"("createdAt");
