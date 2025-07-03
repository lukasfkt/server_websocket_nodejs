-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'queue',
    "senha" TEXT NOT NULL,
    "sector" TEXT NOT NULL,
    "isPreferencial" BOOLEAN NOT NULL DEFAULT false,
    "celphone" TEXT,
    "email" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "senhaDate" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO "new_User" ("celphone", "createdAt", "email", "id", "isPreferencial", "name", "sector", "senha", "status", "updatedAt") SELECT "celphone", "createdAt", "email", "id", "isPreferencial", "name", "sector", "senha", "status", "updatedAt" FROM "User";
DROP TABLE "User";
ALTER TABLE "new_User" RENAME TO "User";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
