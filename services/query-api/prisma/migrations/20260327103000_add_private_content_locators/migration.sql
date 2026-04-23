ALTER TABLE "seeded_source_nodes"
ADD COLUMN "content_locator" TEXT;

ALTER TABLE "source_materials"
ADD COLUMN "raw_text_locator" TEXT;

ALTER TABLE "source_material_chunks"
ADD COLUMN "text_locator" TEXT;
