CREATE TABLE "indexer_runtime_state" (
    "id" VARCHAR(64) NOT NULL,
    "indexer_id" VARCHAR(64) NOT NULL,
    "listener_mode" VARCHAR(32) NOT NULL,
    "phase" VARCHAR(32) NOT NULL,
    "current_slot" BIGINT,
    "current_slot_tx_count" INTEGER,
    "current_tx_index" INTEGER,
    "current_tx_signature" VARCHAR(88),
    "last_progress_at" TIMESTAMP(3) NOT NULL,
    "last_error" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "indexer_runtime_state_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "indexer_runtime_state_indexer_id_key" ON "indexer_runtime_state"("indexer_id");
CREATE INDEX "indexer_runtime_state_indexer_id_idx" ON "indexer_runtime_state"("indexer_id");
CREATE INDEX "indexer_runtime_state_updated_at_idx" ON "indexer_runtime_state"("updated_at" DESC);
