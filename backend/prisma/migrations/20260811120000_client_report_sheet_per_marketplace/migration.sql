-- One report sheet per client becomes one per marketplace.
--
-- A client selling on both Amazon and Flipkart has two separate sets of
-- figures, and one sheet cannot hold two accounts' numbers in the same
-- columns. See ClientReportSheet in schema.prisma.
--
-- The data already in Client."reportSheetUrl" is moved onto "amazon" — every
-- sheet linked so far is an Amazon tracker (confirmed with Ecom4all before
-- this ran). The column is dropped afterwards, so this step is the only
-- chance to keep those 19 links; do not reorder it below the DROP.

CREATE TABLE "ClientReportSheet" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL DEFAULT 'default',
    "clientId" TEXT NOT NULL,
    "marketplace" TEXT NOT NULL,
    "sheetUrl" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClientReportSheet_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ClientReportSheet_clientId_idx" ON "ClientReportSheet"("clientId");

CREATE UNIQUE INDEX "ClientReportSheet_tenantId_clientId_marketplace_key"
    ON "ClientReportSheet"("tenantId", "clientId", "marketplace");

ALTER TABLE "ClientReportSheet" ADD CONSTRAINT "ClientReportSheet_clientId_fkey"
    FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Carry the existing links across. gen_random_uuid() rather than a cuid:
-- these ids are opaque text either way, and nothing in the app parses one.
-- Blank-but-not-null urls are skipped — they were never a working link.
INSERT INTO "ClientReportSheet" ("id", "tenantId", "clientId", "marketplace", "sheetUrl")
SELECT gen_random_uuid()::text, "tenantId", "id", 'amazon', "reportSheetUrl"
FROM "Client"
WHERE "reportSheetUrl" IS NOT NULL AND btrim("reportSheetUrl") <> '';

ALTER TABLE "Client" DROP COLUMN "reportSheetUrl";
