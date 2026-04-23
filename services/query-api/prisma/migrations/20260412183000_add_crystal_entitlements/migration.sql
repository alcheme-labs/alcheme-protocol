CREATE TABLE "crystal_entitlements" (
    "id" SERIAL NOT NULL,
    "knowledge_row_id" INTEGER NOT NULL,
    "knowledge_public_id" VARCHAR(64) NOT NULL,
    "circle_id" INTEGER NOT NULL,
    "owner_pubkey" VARCHAR(44) NOT NULL,
    "owner_user_id" INTEGER,
    "contribution_role" VARCHAR(32) NOT NULL,
    "contribution_weight_bps" INTEGER NOT NULL,
    "proof_package_hash" CHAR(64) NOT NULL,
    "source_anchor_id" CHAR(64) NOT NULL,
    "contributors_root" CHAR(64) NOT NULL,
    "contributors_count" INTEGER NOT NULL,
    "status" VARCHAR(16) NOT NULL DEFAULT 'active',
    "granted_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_synced_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "crystal_entitlements_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "crystal_entitlements_knowledge_row_id_owner_pubkey_key" UNIQUE ("knowledge_row_id", "owner_pubkey"),
    CONSTRAINT "crystal_entitlements_knowledge_row_id_fkey" FOREIGN KEY ("knowledge_row_id") REFERENCES "knowledge"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "crystal_entitlements_circle_id_fkey" FOREIGN KEY ("circle_id") REFERENCES "circles"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "crystal_entitlements_owner_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX "crystal_entitlements_owner_pubkey_status_circle_id_idx"
    ON "crystal_entitlements"("owner_pubkey", "status", "circle_id");

CREATE INDEX "crystal_entitlements_owner_user_id_status_idx"
    ON "crystal_entitlements"("owner_user_id", "status");

CREATE INDEX "crystal_entitlements_knowledge_row_id_status_idx"
    ON "crystal_entitlements"("knowledge_row_id", "status");

CREATE INDEX "crystal_entitlements_circle_id_status_idx"
    ON "crystal_entitlements"("circle_id", "status");
