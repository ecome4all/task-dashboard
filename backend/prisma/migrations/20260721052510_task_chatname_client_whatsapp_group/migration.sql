-- AlterTable
ALTER TABLE "Client" ADD COLUMN     "whatsappGroupId" TEXT,
ADD COLUMN     "whatsappGroupName" TEXT;

-- AlterTable
ALTER TABLE "Task" ADD COLUMN     "chatName" TEXT;
