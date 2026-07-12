-- CreateTable
CREATE TABLE "SeatBlock" (
    "seat" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "blockedDate" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE INDEX "SeatBlock_blockedDate_idx" ON "SeatBlock"("blockedDate");
