-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_AccessLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "versionId" TEXT NOT NULL,
    "licenseId" TEXT,
    "mode" TEXT NOT NULL,
    "result" TEXT NOT NULL,
    "reason" TEXT,
    "ip" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AccessLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "AccessLog_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "VideoVersion" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "AccessLog_licenseId_fkey" FOREIGN KEY ("licenseId") REFERENCES "License" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_AccessLog" ("createdAt", "id", "ip", "licenseId", "mode", "reason", "result", "userId", "versionId") SELECT "createdAt", "id", "ip", "licenseId", "mode", "reason", "result", "userId", "versionId" FROM "AccessLog";
DROP TABLE "AccessLog";
ALTER TABLE "new_AccessLog" RENAME TO "AccessLog";
CREATE INDEX "AccessLog_versionId_createdAt_idx" ON "AccessLog"("versionId", "createdAt");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
