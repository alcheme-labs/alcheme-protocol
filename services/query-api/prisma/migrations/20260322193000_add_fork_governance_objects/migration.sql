CREATE TABLE "fork_declarations" (
    "declaration_id" VARCHAR(128) NOT NULL,
    "source_circle_id" INTEGER NOT NULL,
    "target_circle_id" INTEGER,
    "actor_user_id" INTEGER NOT NULL,
    "declaration_text" TEXT NOT NULL,
    "origin_anchor_ref" VARCHAR(128),
    "qualification_snapshot" JSONB NOT NULL,
    "status" VARCHAR(32) NOT NULL,
    "execution_anchor_digest" CHAR(64),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fork_declarations_pkey" PRIMARY KEY ("declaration_id")
);

CREATE TABLE "circle_fork_lineage" (
    "lineage_id" VARCHAR(128) NOT NULL,
    "source_circle_id" INTEGER NOT NULL,
    "target_circle_id" INTEGER NOT NULL,
    "declaration_id" VARCHAR(128) NOT NULL,
    "created_by" INTEGER NOT NULL,
    "origin_anchor_ref" VARCHAR(128),
    "inheritance_snapshot" JSONB NOT NULL,
    "execution_anchor_digest" CHAR(64),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "circle_fork_lineage_pkey" PRIMARY KEY ("lineage_id")
);

CREATE TABLE "circle_fork_retention_state" (
    "target_circle_id" INTEGER NOT NULL,
    "source_circle_id" INTEGER NOT NULL,
    "declaration_id" VARCHAR(128),
    "current_checkpoint_day" INTEGER NOT NULL DEFAULT 2,
    "next_check_at" TIMESTAMP(3),
    "inactive_streak" INTEGER NOT NULL DEFAULT 0,
    "marker_visible" BOOLEAN NOT NULL DEFAULT true,
    "permanent_at" TIMESTAMP(3),
    "hidden_at" TIMESTAMP(3),
    "last_evaluated_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "circle_fork_retention_state_pkey" PRIMARY KEY ("target_circle_id")
);

CREATE TABLE "circle_activity_rollups" (
    "id" BIGSERIAL NOT NULL,
    "circle_id" INTEGER NOT NULL,
    "window_start" TIMESTAMP(3) NOT NULL,
    "window_end" TIMESTAMP(3) NOT NULL,
    "member_growth_signal" DECIMAL(10,4) NOT NULL DEFAULT 0,
    "content_growth_signal" DECIMAL(10,4) NOT NULL DEFAULT 0,
    "crystallization_signal" DECIMAL(10,4) NOT NULL DEFAULT 0,
    "activity_score" DECIMAL(10,4) NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "circle_activity_rollups_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "circle_fork_lineage_declaration_id_key" ON "circle_fork_lineage"("declaration_id");
CREATE UNIQUE INDEX "circle_fork_lineage_source_circle_id_target_circle_id_key" ON "circle_fork_lineage"("source_circle_id", "target_circle_id");
CREATE UNIQUE INDEX "circle_activity_rollups_circle_id_window_start_window_end_key" ON "circle_activity_rollups"("circle_id", "window_start", "window_end");

CREATE INDEX "fork_declarations_source_circle_id_created_at_idx" ON "fork_declarations"("source_circle_id", "created_at" DESC);
CREATE INDEX "fork_declarations_target_circle_id_created_at_idx" ON "fork_declarations"("target_circle_id", "created_at" DESC);
CREATE INDEX "fork_declarations_status_created_at_idx" ON "fork_declarations"("status", "created_at" ASC);
CREATE INDEX "circle_fork_lineage_source_circle_id_created_at_idx" ON "circle_fork_lineage"("source_circle_id", "created_at" DESC);
CREATE INDEX "circle_fork_lineage_target_circle_id_created_at_idx" ON "circle_fork_lineage"("target_circle_id", "created_at" DESC);
CREATE INDEX "circle_fork_retention_state_next_check_at_idx" ON "circle_fork_retention_state"("next_check_at" ASC);
CREATE INDEX "circle_fork_retention_state_source_circle_id_marker_visible_idx" ON "circle_fork_retention_state"("source_circle_id", "marker_visible");
CREATE INDEX "circle_activity_rollups_circle_id_window_end_idx" ON "circle_activity_rollups"("circle_id", "window_end" DESC);
