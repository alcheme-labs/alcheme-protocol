CREATE TABLE "source_materials" (
    "id" SERIAL NOT NULL,
    "circle_id" INTEGER NOT NULL,
    "uploaded_by_user_id" INTEGER NOT NULL,
    "draft_post_id" INTEGER,
    "discussion_thread_id" VARCHAR(64),
    "seeded_source_node_id" INTEGER,
    "name" VARCHAR(255) NOT NULL,
    "mime_type" VARCHAR(255),
    "byte_size" INTEGER NOT NULL DEFAULT 0,
    "extraction_status" VARCHAR(32) NOT NULL DEFAULT 'ready',
    "raw_text" TEXT,
    "content_digest" CHAR(64) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "source_materials_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "source_material_chunks" (
    "id" SERIAL NOT NULL,
    "source_material_id" INTEGER NOT NULL,
    "chunk_index" INTEGER NOT NULL,
    "locator_type" VARCHAR(32) NOT NULL,
    "locator_ref" VARCHAR(128) NOT NULL,
    "text" TEXT NOT NULL,
    "text_digest" CHAR(64) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "source_material_chunks_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "source_material_chunks_source_material_id_chunk_index_key"
ON "source_material_chunks"("source_material_id", "chunk_index");

CREATE INDEX "source_materials_circle_id_created_at_idx"
ON "source_materials"("circle_id", "created_at" DESC);

CREATE INDEX "source_materials_draft_post_id_created_at_idx"
ON "source_materials"("draft_post_id", "created_at" DESC);

CREATE INDEX "source_materials_discussion_thread_id_created_at_idx"
ON "source_materials"("discussion_thread_id", "created_at" DESC);

CREATE INDEX "source_materials_seeded_source_node_id_created_at_idx"
ON "source_materials"("seeded_source_node_id", "created_at" DESC);

CREATE INDEX "source_material_chunks_source_material_id_chunk_index_idx"
ON "source_material_chunks"("source_material_id", "chunk_index");

ALTER TABLE "source_materials"
ADD CONSTRAINT "source_materials_circle_id_fkey"
FOREIGN KEY ("circle_id") REFERENCES "circles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "source_material_chunks"
ADD CONSTRAINT "source_material_chunks_source_material_id_fkey"
FOREIGN KEY ("source_material_id") REFERENCES "source_materials"("id") ON DELETE CASCADE ON UPDATE CASCADE;
