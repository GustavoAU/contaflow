-- Migration: loan_interest_mixed_approval
-- Adds: PENDING/REJECTED to LoanStatus; interest, mixed currency (USD), approval flow to EmployeeLoan

-- 1. Extend LoanStatus enum
ALTER TYPE "LoanStatus" ADD VALUE IF NOT EXISTS 'PENDING';
ALTER TYPE "LoanStatus" ADD VALUE IF NOT EXISTS 'REJECTED';

-- 2. Add new columns to EmployeeLoan
ALTER TABLE "EmployeeLoan"
  ADD COLUMN IF NOT EXISTS "amountUsd"            DECIMAL(20,2),
  ADD COLUMN IF NOT EXISTS "installmentAmountUsd" DECIMAL(20,2),
  ADD COLUMN IF NOT EXISTS "remainingBalanceUsd"  DECIMAL(20,2),
  ADD COLUMN IF NOT EXISTS "interestRate"         DECIMAL(5,4),
  ADD COLUMN IF NOT EXISTS "approvedByUserId"     TEXT,
  ADD COLUMN IF NOT EXISTS "rejectionReason"      VARCHAR(500);

-- 3. Make approvedAt nullable (remove NOT NULL + default — existing rows keep their value)
ALTER TABLE "EmployeeLoan" ALTER COLUMN "approvedAt" DROP DEFAULT;
ALTER TABLE "EmployeeLoan" ALTER COLUMN "approvedAt" DROP NOT NULL;

-- 4. Change existing ACTIVE loans to remain ACTIVE (no-op — enum ADD VALUE does not affect rows)
--    New loans via Prisma will use @default(PENDING).
