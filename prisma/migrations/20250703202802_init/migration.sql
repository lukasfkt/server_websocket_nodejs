-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'queue',
    "senha" TEXT NOT NULL,
    "sector" TEXT NOT NULL,
    "isPreferencial" BOOLEAN NOT NULL DEFAULT false,
    "celphone" TEXT,
    "email" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
