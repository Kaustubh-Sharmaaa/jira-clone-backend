-- AlterTable
ALTER TABLE "Invitation" ADD COLUMN     "isExistingUser" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Task" ADD COLUMN     "isDeleted" BOOLEAN NOT NULL DEFAULT false;
