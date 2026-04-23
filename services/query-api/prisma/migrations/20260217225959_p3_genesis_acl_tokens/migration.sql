-- AlterTable
ALTER TABLE "circles" ADD COLUMN     "genesis_mode" VARCHAR(32);

-- CreateTable
CREATE TABLE "access_rules" (
    "id" SERIAL NOT NULL,
    "user_pubkey" VARCHAR(44) NOT NULL,
    "rule_id" VARCHAR(128) NOT NULL,
    "permission" VARCHAR(64) NOT NULL,
    "access_level" VARCHAR(32) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "access_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "permissions" (
    "id" SERIAL NOT NULL,
    "granter_pubkey" VARCHAR(44) NOT NULL,
    "grantee_pubkey" VARCHAR(44) NOT NULL,
    "permission" VARCHAR(64) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "permissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_relationships" (
    "id" SERIAL NOT NULL,
    "user1_pubkey" VARCHAR(44) NOT NULL,
    "user2_pubkey" VARCHAR(44) NOT NULL,
    "relationship" VARCHAR(32) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_relationships_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "token_transactions" (
    "id" SERIAL NOT NULL,
    "pubkey" VARCHAR(44) NOT NULL,
    "amount" BIGINT NOT NULL,
    "transaction_type" VARCHAR(32) NOT NULL,
    "purpose" VARCHAR(128) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "token_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "access_rules_rule_id_key" ON "access_rules"("rule_id");

-- CreateIndex
CREATE INDEX "access_rules_user_pubkey_idx" ON "access_rules"("user_pubkey");

-- CreateIndex
CREATE INDEX "access_rules_permission_idx" ON "access_rules"("permission");

-- CreateIndex
CREATE INDEX "permissions_grantee_pubkey_idx" ON "permissions"("grantee_pubkey");

-- CreateIndex
CREATE UNIQUE INDEX "permissions_granter_pubkey_grantee_pubkey_permission_key" ON "permissions"("granter_pubkey", "grantee_pubkey", "permission");

-- CreateIndex
CREATE INDEX "user_relationships_user1_pubkey_idx" ON "user_relationships"("user1_pubkey");

-- CreateIndex
CREATE INDEX "user_relationships_user2_pubkey_idx" ON "user_relationships"("user2_pubkey");

-- CreateIndex
CREATE UNIQUE INDEX "user_relationships_user1_pubkey_user2_pubkey_key" ON "user_relationships"("user1_pubkey", "user2_pubkey");

-- CreateIndex
CREATE INDEX "token_transactions_pubkey_idx" ON "token_transactions"("pubkey");

-- CreateIndex
CREATE INDEX "token_transactions_transaction_type_idx" ON "token_transactions"("transaction_type");

-- CreateIndex
CREATE INDEX "token_transactions_created_at_idx" ON "token_transactions"("created_at" DESC);
