-- CreateTable
CREATE TABLE "ClientWhatsappGroup" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL DEFAULT 'default',
    "clientId" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "groupName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClientWhatsappGroup_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ClientWhatsappGroup_clientId_idx" ON "ClientWhatsappGroup"("clientId");

-- CreateIndex
CREATE UNIQUE INDEX "ClientWhatsappGroup_tenantId_groupId_key" ON "ClientWhatsappGroup"("tenantId", "groupId");

-- AddForeignKey
ALTER TABLE "ClientWhatsappGroup" ADD CONSTRAINT "ClientWhatsappGroup_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Carry every existing single-group link over into the new table before the
-- old columns are dropped, so linked clients don't lose their group.
INSERT INTO "ClientWhatsappGroup" ("id", "tenantId", "clientId", "groupId", "groupName", "createdAt")
SELECT md5(random()::text || clock_timestamp()::text), "tenantId", "id", "whatsappGroupId", "whatsappGroupName", CURRENT_TIMESTAMP
FROM "Client"
WHERE "whatsappGroupId" IS NOT NULL;

-- AlterTable
ALTER TABLE "Client" DROP COLUMN "whatsappGroupId",
DROP COLUMN "whatsappGroupName";
