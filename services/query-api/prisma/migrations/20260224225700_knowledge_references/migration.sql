-- Knowledge references table for replay-safe citation tracking
CREATE TABLE IF NOT EXISTS "knowledge_references" (
    "source_knowledge_id" VARCHAR(64) NOT NULL,
    "target_knowledge_id" VARCHAR(64) NOT NULL,
    "reference_type"      VARCHAR(32) NOT NULL DEFAULT 'citation',
    "created_at"          TIMESTAMP NOT NULL DEFAULT NOW(),

    PRIMARY KEY ("source_knowledge_id", "target_knowledge_id")
);

CREATE INDEX IF NOT EXISTS "knowledge_references_target_idx"
    ON "knowledge_references" ("target_knowledge_id");
