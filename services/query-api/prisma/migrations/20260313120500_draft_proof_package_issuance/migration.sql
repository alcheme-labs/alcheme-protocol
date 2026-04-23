CREATE TABLE "draft_proof_packages" (
    "id" BIGSERIAL NOT NULL,
    "draft_post_id" INTEGER NOT NULL,
    "proof_package_hash" CHAR(64) NOT NULL,
    "source_anchor_id" VARCHAR(128) NOT NULL,
    "contributors_root" CHAR(64) NOT NULL,
    "contributors_count" INTEGER NOT NULL,
    "binding_version" INTEGER NOT NULL DEFAULT 2,
    "canonical_proof_package" JSONB NOT NULL,
    "generated_at" TIMESTAMP(3) NOT NULL,
    "generated_by" VARCHAR(64) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "draft_proof_packages_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "draft_proof_package_issuances" (
    "id" BIGSERIAL NOT NULL,
    "proof_package_id" BIGINT NOT NULL,
    "issuer_key_id" VARCHAR(64) NOT NULL,
    "issued_signature" VARCHAR(512) NOT NULL,
    "issued_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "draft_proof_package_issuances_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "draft_proof_packages_draft_post_id_proof_package_hash_key"
    ON "draft_proof_packages"("draft_post_id", "proof_package_hash");

CREATE INDEX "draft_proof_packages_draft_post_id_generated_at_idx"
    ON "draft_proof_packages"("draft_post_id", "generated_at" DESC);

CREATE INDEX "draft_proof_package_issuances_proof_package_id_issued_at_idx"
    ON "draft_proof_package_issuances"("proof_package_id", "issued_at" DESC);

CREATE INDEX "draft_proof_package_issuances_issuer_key_id_issued_at_idx"
    ON "draft_proof_package_issuances"("issuer_key_id", "issued_at" DESC);

ALTER TABLE "draft_proof_packages"
    ADD CONSTRAINT "draft_proof_packages_draft_post_id_fkey"
    FOREIGN KEY ("draft_post_id") REFERENCES "posts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "draft_proof_package_issuances"
    ADD CONSTRAINT "draft_proof_package_issuances_proof_package_id_fkey"
    FOREIGN KEY ("proof_package_id") REFERENCES "draft_proof_packages"("id") ON DELETE CASCADE ON UPDATE CASCADE;
