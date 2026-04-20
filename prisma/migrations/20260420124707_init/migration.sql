-- CreateEnum
CREATE TYPE "OrganizationKind" AS ENUM ('SYSTEM', 'USER');

-- CreateEnum
CREATE TYPE "Chain" AS ENUM ('ETHEREUM', 'SOLANA');

-- CreateEnum
CREATE TYPE "OwnershipStatus" AS ENUM ('CURATED', 'UNCLAIMED', 'CLAIMED');

-- CreateEnum
CREATE TYPE "ScanStatus" AS ENUM ('QUEUED', 'RUNNING', 'PARTIAL_COMPLETE', 'COMPLETE', 'FAILED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "ScanAttemptStatus" AS ENUM ('ACCEPTED', 'RATE_LIMITED', 'INVALID', 'ERROR', 'DUPLICATE');

-- CreateEnum
CREATE TYPE "ModuleName" AS ENUM ('GOVERNANCE', 'ORACLE', 'SIGNER', 'FRONTEND');

-- CreateEnum
CREATE TYPE "ModuleStatus" AS ENUM ('QUEUED', 'RUNNING', 'COMPLETE', 'FAILED', 'SKIPPED');

-- CreateEnum
CREATE TYPE "Severity" AS ENUM ('CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFO');

-- CreateEnum
CREATE TYPE "Grade" AS ENUM ('A', 'B', 'C', 'D', 'F');

-- CreateEnum
CREATE TYPE "ClaimMethod" AS ENUM ('SIGN_MESSAGE', 'ENS', 'DNS_TXT');

-- CreateEnum
CREATE TYPE "ClaimStatus" AS ENUM ('PENDING', 'VERIFIED', 'REJECTED');

-- CreateEnum
CREATE TYPE "SubscriptionTier" AS ENUM ('FREE', 'PAID');

-- CreateTable
CREATE TABLE "Organization" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "OrganizationKind" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Organization_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "emailVerified" TIMESTAMP(3),
    "organizationId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Protocol" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "chain" "Chain" NOT NULL,
    "primaryContractAddress" TEXT NOT NULL,
    "extraContractAddresses" JSONB NOT NULL DEFAULT '[]',
    "domain" TEXT,
    "logoUrl" TEXT,
    "ownershipStatus" "OwnershipStatus" NOT NULL,
    "organizationId" TEXT,
    "knownMultisigs" JSONB NOT NULL DEFAULT '[]',
    "expectedRiskProfile" "Grade",
    "latestDemoScanId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Protocol_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProtocolClaim" (
    "id" TEXT NOT NULL,
    "protocolId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "proofMethod" "ClaimMethod" NOT NULL,
    "proofData" JSONB NOT NULL,
    "status" "ClaimStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProtocolClaim_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Scan" (
    "id" TEXT NOT NULL,
    "protocolId" TEXT NOT NULL,
    "submittedByUserId" TEXT,
    "submittedEmail" TEXT,
    "submittedEmailHash" TEXT,
    "ipHash" TEXT NOT NULL,
    "userAgent" TEXT NOT NULL,
    "status" "ScanStatus" NOT NULL DEFAULT 'QUEUED',
    "compositeScore" INTEGER,
    "compositeGrade" "Grade",
    "isPartialGrade" BOOLEAN NOT NULL DEFAULT false,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "Scan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScanAttempt" (
    "id" TEXT NOT NULL,
    "ipHash" TEXT NOT NULL,
    "userId" TEXT,
    "attemptedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" "ScanAttemptStatus" NOT NULL,
    "reason" TEXT NOT NULL,
    "userAgent" TEXT NOT NULL,
    "inputPayloadHash" TEXT NOT NULL,
    "cooldownKey" TEXT NOT NULL,
    "scanId" TEXT,

    CONSTRAINT "ScanAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ModuleRun" (
    "id" TEXT NOT NULL,
    "scanId" TEXT NOT NULL,
    "module" "ModuleName" NOT NULL,
    "status" "ModuleStatus" NOT NULL DEFAULT 'QUEUED',
    "grade" "Grade",
    "score" INTEGER,
    "findingsCount" INTEGER,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "errorMessage" TEXT,
    "errorStack" TEXT,
    "detectorVersions" JSONB NOT NULL,
    "inputSnapshot" JSONB NOT NULL,
    "rpcCallsUsed" INTEGER NOT NULL DEFAULT 0,
    "idempotencyKey" TEXT NOT NULL,

    CONSTRAINT "ModuleRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Finding" (
    "id" TEXT NOT NULL,
    "scanId" TEXT NOT NULL,
    "moduleRunId" TEXT NOT NULL,
    "module" "ModuleName" NOT NULL,
    "severity" "Severity" NOT NULL,
    "publicTitle" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "evidence" JSONB NOT NULL,
    "affectedComponent" TEXT NOT NULL,
    "references" JSONB NOT NULL,
    "remediationHint" TEXT NOT NULL,
    "remediationDetailed" TEXT NOT NULL,
    "publicRank" INTEGER NOT NULL,
    "detectorId" TEXT NOT NULL,
    "detectorVersion" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Finding_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Subscription" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "tier" "SubscriptionTier" NOT NULL DEFAULT 'FREE',
    "status" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Subscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Account" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "providerAccountId" TEXT NOT NULL,
    "refresh_token" TEXT,
    "access_token" TEXT,
    "expires_at" INTEGER,
    "token_type" TEXT,
    "scope" TEXT,
    "id_token" TEXT,
    "session_state" TEXT,

    CONSTRAINT "Account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "sessionToken" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expires" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VerificationToken" (
    "identifier" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "expires" TIMESTAMP(3) NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Protocol_slug_key" ON "Protocol"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "Protocol_chain_primaryContractAddress_key" ON "Protocol"("chain", "primaryContractAddress");

-- CreateIndex
CREATE INDEX "Scan_submittedEmail_idx" ON "Scan"("submittedEmail");

-- CreateIndex
CREATE INDEX "Scan_expiresAt_idx" ON "Scan"("expiresAt");

-- CreateIndex
CREATE INDEX "ScanAttempt_ipHash_attemptedAt_idx" ON "ScanAttempt"("ipHash", "attemptedAt");

-- CreateIndex
CREATE INDEX "ScanAttempt_userId_attemptedAt_idx" ON "ScanAttempt"("userId", "attemptedAt");

-- CreateIndex
CREATE INDEX "ScanAttempt_inputPayloadHash_ipHash_attemptedAt_idx" ON "ScanAttempt"("inputPayloadHash", "ipHash", "attemptedAt");

-- CreateIndex
CREATE INDEX "ScanAttempt_cooldownKey_attemptedAt_idx" ON "ScanAttempt"("cooldownKey", "attemptedAt");

-- CreateIndex
CREATE UNIQUE INDEX "ModuleRun_idempotencyKey_key" ON "ModuleRun"("idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "ModuleRun_scanId_module_key" ON "ModuleRun"("scanId", "module");

-- CreateIndex
CREATE INDEX "Finding_scanId_module_idx" ON "Finding"("scanId", "module");

-- CreateIndex
CREATE UNIQUE INDEX "Account_provider_providerAccountId_key" ON "Account"("provider", "providerAccountId");

-- CreateIndex
CREATE UNIQUE INDEX "Session_sessionToken_key" ON "Session"("sessionToken");

-- CreateIndex
CREATE UNIQUE INDEX "VerificationToken_token_key" ON "VerificationToken"("token");

-- CreateIndex
CREATE UNIQUE INDEX "VerificationToken_identifier_token_key" ON "VerificationToken"("identifier", "token");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Protocol" ADD CONSTRAINT "Protocol_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Protocol" ADD CONSTRAINT "Protocol_latestDemoScanId_fkey" FOREIGN KEY ("latestDemoScanId") REFERENCES "Scan"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProtocolClaim" ADD CONSTRAINT "ProtocolClaim_protocolId_fkey" FOREIGN KEY ("protocolId") REFERENCES "Protocol"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProtocolClaim" ADD CONSTRAINT "ProtocolClaim_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Scan" ADD CONSTRAINT "Scan_protocolId_fkey" FOREIGN KEY ("protocolId") REFERENCES "Protocol"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Scan" ADD CONSTRAINT "Scan_submittedByUserId_fkey" FOREIGN KEY ("submittedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScanAttempt" ADD CONSTRAINT "ScanAttempt_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScanAttempt" ADD CONSTRAINT "ScanAttempt_scanId_fkey" FOREIGN KEY ("scanId") REFERENCES "Scan"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ModuleRun" ADD CONSTRAINT "ModuleRun_scanId_fkey" FOREIGN KEY ("scanId") REFERENCES "Scan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Finding" ADD CONSTRAINT "Finding_scanId_fkey" FOREIGN KEY ("scanId") REFERENCES "Scan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Finding" ADD CONSTRAINT "Finding_moduleRunId_fkey" FOREIGN KEY ("moduleRunId") REFERENCES "ModuleRun"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Account" ADD CONSTRAINT "Account_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
