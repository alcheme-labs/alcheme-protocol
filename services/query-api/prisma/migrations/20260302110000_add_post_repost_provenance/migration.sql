ALTER TABLE "posts"
ADD COLUMN "repost_of_post_id" INTEGER,
ADD COLUMN "repost_of_address" VARCHAR(44);

CREATE INDEX "posts_repost_of_post_id_idx" ON "posts"("repost_of_post_id");

ALTER TABLE "posts"
ADD CONSTRAINT "posts_repost_of_post_id_fkey"
FOREIGN KEY ("repost_of_post_id") REFERENCES "posts"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
