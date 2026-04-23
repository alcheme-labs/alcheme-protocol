-- CreateEnum
CREATE TYPE "IdentityLevel" AS ENUM ('Visitor', 'Initiate', 'Member', 'Elder');

-- AlterTable
ALTER TABLE "circle_members" ADD COLUMN     "identity_level" "IdentityLevel" NOT NULL DEFAULT 'Visitor';

-- AlterTable
ALTER TABLE "circles" ADD COLUMN     "kind" VARCHAR(16) NOT NULL DEFAULT 'main',
ADD COLUMN     "min_crystals" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "mode" VARCHAR(16) NOT NULL DEFAULT 'knowledge';

-- AlterTable
ALTER TABLE "knowledge" ADD COLUMN     "contributors_count" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "contributors_root" VARCHAR(64),
ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "posts" ADD COLUMN     "relevance_score" DECIMAL(5,4);

-- CreateIndex
CREATE INDEX "circle_members_identity_level_idx" ON "circle_members"("identity_level");
