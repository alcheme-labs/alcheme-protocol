CREATE TABLE "seeded_source_nodes" (
    "id" SERIAL PRIMARY KEY,
    "circle_id" INTEGER NOT NULL REFERENCES "circles"("id") ON DELETE CASCADE,
    "parent_id" INTEGER REFERENCES "seeded_source_nodes"("id") ON DELETE CASCADE,
    "node_type" VARCHAR(16) NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "path" VARCHAR(1024) NOT NULL,
    "depth" INTEGER NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "mime_type" VARCHAR(255),
    "content_text" TEXT,
    "content_hash" CHAR(64),
    "byte_size" INTEGER NOT NULL DEFAULT 0,
    "line_count" INTEGER,
    "created_at" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX "seeded_source_nodes_circle_id_path_key"
    ON "seeded_source_nodes"("circle_id", "path");

CREATE INDEX "seeded_source_nodes_circle_id_parent_id_sort_order_idx"
    ON "seeded_source_nodes"("circle_id", "parent_id", "sort_order");
