-- CreateTable
CREATE TABLE "UnrecognizedMessage" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL DEFAULT 'default',
    "source" TEXT NOT NULL,
    "sourceRef" TEXT NOT NULL,
    "chatName" TEXT,
    "text" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UnrecognizedMessage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "UnrecognizedMessage_tenantId_sourceRef_idx" ON "UnrecognizedMessage"("tenantId", "sourceRef");
