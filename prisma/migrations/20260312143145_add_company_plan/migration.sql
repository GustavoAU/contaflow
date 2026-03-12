-- CreateEnum
CREATE TYPE "CompanyPlan" AS ENUM ('FREE', 'PRO');

-- AlterTable
ALTER TABLE "Company" ADD COLUMN     "plan" "CompanyPlan" NOT NULL DEFAULT 'FREE';
