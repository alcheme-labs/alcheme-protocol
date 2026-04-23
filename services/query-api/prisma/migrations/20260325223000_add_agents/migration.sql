CREATE TABLE "agents" (
    "id" SERIAL NOT NULL,
    "circle_id" INTEGER NOT NULL,
    "agent_pubkey" VARCHAR(44) NOT NULL,
    "handle" VARCHAR(64) NOT NULL,
    "display_name" VARCHAR(128),
    "description" TEXT,
    "owner_user_id" INTEGER,
    "created_by_user_id" INTEGER NOT NULL,
    "status" VARCHAR(16) NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agents_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "agents_agent_pubkey_key" ON "agents"("agent_pubkey");
CREATE UNIQUE INDEX "agents_circle_id_handle_key" ON "agents"("circle_id", "handle");
CREATE INDEX "agents_circle_id_created_at_idx" ON "agents"("circle_id", "created_at" DESC);
CREATE INDEX "agents_owner_user_id_created_at_idx" ON "agents"("owner_user_id", "created_at" DESC);
CREATE INDEX "agents_created_by_user_id_created_at_idx" ON "agents"("created_by_user_id", "created_at" DESC);

ALTER TABLE "agents"
    ADD CONSTRAINT "agents_circle_id_fkey"
    FOREIGN KEY ("circle_id") REFERENCES "circles"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "agents"
    ADD CONSTRAINT "agents_owner_user_id_fkey"
    FOREIGN KEY ("owner_user_id") REFERENCES "users"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "agents"
    ADD CONSTRAINT "agents_created_by_user_id_fkey"
    FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
