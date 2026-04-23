CREATE TABLE "draft_candidate_acceptances" (
    "id" SERIAL NOT NULL,
    "circle_id" INTEGER NOT NULL,
    "candidate_id" VARCHAR(64) NOT NULL,
    "draft_post_id" INTEGER NOT NULL,
    "accepted_by_user_id" INTEGER NOT NULL,
    "accepted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "draft_candidate_acceptances_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "draft_candidate_acceptances_draft_post_id_key"
ON "draft_candidate_acceptances"("draft_post_id");

CREATE UNIQUE INDEX "draft_candidate_acceptances_circle_id_candidate_id_key"
ON "draft_candidate_acceptances"("circle_id", "candidate_id");

CREATE INDEX "draft_candidate_acceptances_circle_id_accepted_at_idx"
ON "draft_candidate_acceptances"("circle_id", "accepted_at" DESC);

CREATE INDEX "draft_candidate_acceptances_accepted_by_user_id_accepted_at_idx"
ON "draft_candidate_acceptances"("accepted_by_user_id", "accepted_at" DESC);

ALTER TABLE "draft_candidate_acceptances"
ADD CONSTRAINT "draft_candidate_acceptances_circle_id_fkey"
FOREIGN KEY ("circle_id") REFERENCES "circles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "draft_candidate_acceptances"
ADD CONSTRAINT "draft_candidate_acceptances_draft_post_id_fkey"
FOREIGN KEY ("draft_post_id") REFERENCES "posts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "draft_candidate_acceptances"
ADD CONSTRAINT "draft_candidate_acceptances_accepted_by_user_id_fkey"
FOREIGN KEY ("accepted_by_user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
