CREATE TABLE "governance_proposals" (
    "proposal_id" VARCHAR(128) NOT NULL,
    "circle_id" INTEGER NOT NULL,
    "action_type" VARCHAR(64) NOT NULL,
    "target_type" VARCHAR(64) NOT NULL,
    "target_id" VARCHAR(128) NOT NULL,
    "target_version" INTEGER,
    "status" VARCHAR(32) NOT NULL,
    "created_by" INTEGER,
    "electorate_scope" VARCHAR(64),
    "vote_rule" VARCHAR(64),
    "threshold_value" INTEGER,
    "quorum" INTEGER,
    "opens_at" TIMESTAMP(3),
    "closes_at" TIMESTAMP(3),
    "resolved_at" TIMESTAMP(3),
    "executed_at" TIMESTAMP(3),
    "execution_error" TEXT,
    "execution_marker" VARCHAR(128),
    "policy_profile_digest" CHAR(64),
    "config_snapshot" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "governance_proposals_pkey" PRIMARY KEY ("proposal_id")
);

CREATE UNIQUE INDEX "governance_proposals_execution_marker_key"
    ON "governance_proposals"("execution_marker");

CREATE INDEX "governance_proposals_circle_id_action_type_created_at_idx"
    ON "governance_proposals"("circle_id", "action_type", "created_at" DESC);

CREATE INDEX "governance_proposals_target_type_target_id_created_at_idx"
    ON "governance_proposals"("target_type", "target_id", "created_at" DESC);

CREATE TABLE "governance_votes" (
    "id" BIGSERIAL NOT NULL,
    "proposal_id" VARCHAR(128) NOT NULL,
    "voter_user_id" INTEGER NOT NULL,
    "vote" VARCHAR(16) NOT NULL,
    "reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "governance_votes_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "governance_votes_proposal_id_voter_user_id_key"
    ON "governance_votes"("proposal_id", "voter_user_id");

CREATE INDEX "governance_votes_proposal_id_created_at_idx"
    ON "governance_votes"("proposal_id", "created_at" DESC);

CREATE INDEX "governance_votes_voter_user_id_created_at_idx"
    ON "governance_votes"("voter_user_id", "created_at" DESC);

ALTER TABLE "governance_proposals"
    ADD CONSTRAINT "governance_proposals_created_by_fkey"
    FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "governance_votes"
    ADD CONSTRAINT "governance_votes_proposal_id_fkey"
    FOREIGN KEY ("proposal_id") REFERENCES "governance_proposals"("proposal_id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "governance_votes"
    ADD CONSTRAINT "governance_votes_voter_user_id_fkey"
    FOREIGN KEY ("voter_user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
