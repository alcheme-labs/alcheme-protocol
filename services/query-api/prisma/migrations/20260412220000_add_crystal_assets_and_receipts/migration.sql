CREATE TABLE "crystal_assets" (
    "id" SERIAL NOT NULL,
    "knowledge_row_id" INTEGER NOT NULL,
    "knowledge_public_id" VARCHAR(64) NOT NULL,
    "circle_id" INTEGER NOT NULL,
    "owner_pubkey" VARCHAR(44) NOT NULL,
    "master_asset_address" VARCHAR(128),
    "asset_standard" VARCHAR(64) NOT NULL,
    "mint_status" VARCHAR(24) NOT NULL DEFAULT 'pending',
    "metadata_uri" TEXT,
    "proof_package_hash" CHAR(64) NOT NULL,
    "source_anchor_id" CHAR(64) NOT NULL,
    "contributors_root" CHAR(64) NOT NULL,
    "contributors_count" INTEGER NOT NULL,
    "minted_at" TIMESTAMPTZ,
    "last_error" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "crystal_assets_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "crystal_assets_knowledge_row_id_key" UNIQUE ("knowledge_row_id"),
    CONSTRAINT "crystal_assets_knowledge_row_id_fkey" FOREIGN KEY ("knowledge_row_id") REFERENCES "knowledge"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "crystal_assets_circle_id_fkey" FOREIGN KEY ("circle_id") REFERENCES "circles"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "crystal_assets_circle_id_mint_status_idx"
    ON "crystal_assets"("circle_id", "mint_status");

CREATE INDEX "crystal_assets_owner_pubkey_idx"
    ON "crystal_assets"("owner_pubkey");

CREATE TABLE "crystal_receipts" (
    "id" SERIAL NOT NULL,
    "entitlement_id" INTEGER NOT NULL,
    "knowledge_row_id" INTEGER NOT NULL,
    "knowledge_public_id" VARCHAR(64) NOT NULL,
    "circle_id" INTEGER NOT NULL,
    "owner_pubkey" VARCHAR(44) NOT NULL,
    "owner_user_id" INTEGER,
    "contribution_role" VARCHAR(32) NOT NULL,
    "contribution_weight_bps" INTEGER NOT NULL,
    "receipt_asset_address" VARCHAR(128),
    "asset_standard" VARCHAR(64) NOT NULL,
    "transfer_mode" VARCHAR(32) NOT NULL DEFAULT 'non_transferable',
    "mint_status" VARCHAR(24) NOT NULL DEFAULT 'pending',
    "metadata_uri" TEXT,
    "proof_package_hash" CHAR(64) NOT NULL,
    "source_anchor_id" CHAR(64) NOT NULL,
    "contributors_root" CHAR(64) NOT NULL,
    "contributors_count" INTEGER NOT NULL,
    "minted_at" TIMESTAMPTZ,
    "last_error" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "crystal_receipts_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "crystal_receipts_entitlement_id_key" UNIQUE ("entitlement_id"),
    CONSTRAINT "crystal_receipts_knowledge_row_id_owner_pubkey_key" UNIQUE ("knowledge_row_id", "owner_pubkey"),
    CONSTRAINT "crystal_receipts_entitlement_id_fkey" FOREIGN KEY ("entitlement_id") REFERENCES "crystal_entitlements"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "crystal_receipts_knowledge_row_id_fkey" FOREIGN KEY ("knowledge_row_id") REFERENCES "knowledge"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "crystal_receipts_circle_id_fkey" FOREIGN KEY ("circle_id") REFERENCES "circles"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "crystal_receipts_owner_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX "crystal_receipts_owner_pubkey_mint_status_circle_id_idx"
    ON "crystal_receipts"("owner_pubkey", "mint_status", "circle_id");

CREATE INDEX "crystal_receipts_owner_user_id_mint_status_idx"
    ON "crystal_receipts"("owner_user_id", "mint_status");

CREATE INDEX "crystal_receipts_circle_id_mint_status_idx"
    ON "crystal_receipts"("circle_id", "mint_status");
