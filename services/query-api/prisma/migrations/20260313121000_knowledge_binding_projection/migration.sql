CREATE TABLE IF NOT EXISTS "knowledge_binding" (
    "knowledge_id" VARCHAR(64) NOT NULL,
    "source_anchor_id" CHAR(64) NOT NULL,
    "proof_package_hash" CHAR(64) NOT NULL,
    "contributors_root" CHAR(64) NOT NULL,
    "contributors_count" INTEGER NOT NULL,
    "binding_version" INTEGER NOT NULL,
    "generated_at" TIMESTAMP(3) NOT NULL,
    "bound_at" TIMESTAMP(3) NOT NULL,
    "bound_by" VARCHAR(44) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "knowledge_binding_pkey" PRIMARY KEY ("knowledge_id"),
    CONSTRAINT "knowledge_binding_knowledge_id_fkey"
        FOREIGN KEY ("knowledge_id")
        REFERENCES "knowledge"("knowledge_id")
        ON DELETE CASCADE
        ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "knowledge_binding_proof_package_hash_idx"
    ON "knowledge_binding"("proof_package_hash");

CREATE INDEX IF NOT EXISTS "knowledge_binding_bound_at_idx"
    ON "knowledge_binding"("bound_at" DESC);
