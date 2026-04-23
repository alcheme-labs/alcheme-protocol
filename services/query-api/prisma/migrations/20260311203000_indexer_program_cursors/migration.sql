CREATE TABLE "indexer_program_cursors" (
    "program_id" VARCHAR(44) NOT NULL,
    "listener_mode" VARCHAR(32) NOT NULL,
    "last_signature" VARCHAR(88),
    "last_processed_slot" BIGINT NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "indexer_program_cursors_pkey" PRIMARY KEY ("program_id","listener_mode")
);

CREATE INDEX "indexer_program_cursors_listener_mode_updated_at_idx"
    ON "indexer_program_cursors"("listener_mode", "updated_at" DESC);
