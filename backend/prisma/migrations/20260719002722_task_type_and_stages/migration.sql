-- AlterTable
ALTER TABLE "Task" ADD COLUMN     "taskType" TEXT,
ALTER COLUMN "status" SET DEFAULT 'started';
