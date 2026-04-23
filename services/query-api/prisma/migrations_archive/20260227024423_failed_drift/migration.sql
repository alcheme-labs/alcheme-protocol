/*
  Warnings:

  - The primary key for the `ghost_runs` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - You are about to alter the column `id` on the `ghost_runs` table. The data in that column could be lost. The data in that column will be cast from `BigInt` to `Integer`.

*/
-- DropForeignKey
ALTER TABLE "user_totem" DROP CONSTRAINT "user_totem_user_id_fkey";

-- DropIndex
DROP INDEX "idx_pending_circle_ghost_settings_updated_at";

-- DropIndex
DROP INDEX "settlement_history_contribution_role_idx";

-- AlterTable
ALTER TABLE "circle_discussion_messages" ALTER COLUMN "lamport" DROP DEFAULT;
DROP SEQUENCE "discussion_lamport_seq";

-- AlterTable
ALTER TABLE "ghost_runs" DROP CONSTRAINT "ghost_runs_pkey",
ALTER COLUMN "id" SET DATA TYPE SERIAL,
ADD CONSTRAINT "ghost_runs_pkey" PRIMARY KEY ("id");

-- AlterTable
ALTER TABLE "indexer_failed_slots" ALTER COLUMN "first_failed_at" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "last_failed_at" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "last_replay_at" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "resolved_at" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "created_at" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "updated_at" SET DATA TYPE TIMESTAMP(3);

-- AlterTable
ALTER TABLE "knowledge_references" ALTER COLUMN "created_at" SET DATA TYPE TIMESTAMP(3);

-- AlterTable
ALTER TABLE "pending_circle_ghost_settings" ALTER COLUMN "expires_at" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "created_at" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "updated_at" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "requested_by_pubkey" DROP DEFAULT;

-- AlterTable
ALTER TABLE "user_totem" ALTER COLUMN "last_active_at" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "updated_at" SET DATA TYPE TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "pending_circle_ghost_settings_updated_at_idx" ON "pending_circle_ghost_settings"("updated_at" DESC);

-- AddForeignKey
ALTER TABLE "user_totem" ADD CONSTRAINT "user_totem_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- RenameIndex
ALTER INDEX "circle_discussion_messages_circle_id_is_featured_featured_at_id" RENAME TO "circle_discussion_messages_circle_id_is_featured_featured_a_idx";

-- RenameIndex
ALTER INDEX "idx_discussion_circle_lamport" RENAME TO "circle_discussion_messages_circle_id_lamport_idx";

-- RenameIndex
ALTER INDEX "idx_discussion_relevance_score" RENAME TO "circle_discussion_messages_relevance_score_idx";

-- RenameIndex
ALTER INDEX "idx_discussion_room_lamport" RENAME TO "circle_discussion_messages_room_key_lamport_idx";

-- RenameIndex
ALTER INDEX "idx_discussion_semantic_score" RENAME TO "circle_discussion_messages_semantic_score_idx";

-- RenameIndex
ALTER INDEX "idx_discussion_sender_lamport" RENAME TO "circle_discussion_messages_sender_pubkey_lamport_idx";

-- RenameIndex
ALTER INDEX "idx_discussion_session_id" RENAME TO "circle_discussion_messages_session_id_idx";

-- RenameIndex
ALTER INDEX "idx_discussion_spam_score" RENAME TO "circle_discussion_messages_spam_score_idx";

-- RenameIndex
ALTER INDEX "idx_discussion_stream_lamport" RENAME TO "circle_discussion_messages_stream_key_lamport_idx";

-- RenameIndex
ALTER INDEX "idx_circle_ghost_settings_updated_at" RENAME TO "circle_ghost_settings_updated_at_idx";

-- RenameIndex
ALTER INDEX "idx_discussion_sessions_expires_at" RENAME TO "discussion_sessions_expires_at_idx";

-- RenameIndex
ALTER INDEX "idx_discussion_sessions_sender_pubkey" RENAME TO "discussion_sessions_sender_pubkey_idx";

-- RenameIndex
ALTER INDEX "idx_ghost_runs_circle_created_at" RENAME TO "ghost_runs_circle_id_created_at_idx";

-- RenameIndex
ALTER INDEX "idx_ghost_runs_kind_created_at" RENAME TO "ghost_runs_run_kind_created_at_idx";

-- RenameIndex
ALTER INDEX "idx_ghost_runs_status_created_at" RENAME TO "ghost_runs_status_created_at_idx";

-- RenameIndex
ALTER INDEX "idx_indexer_failed_slots_program_resolved_slot" RENAME TO "indexer_failed_slots_program_id_resolved_slot_idx";

-- RenameIndex
ALTER INDEX "idx_indexer_failed_slots_resolved_last_failed_at" RENAME TO "indexer_failed_slots_resolved_last_failed_at_idx";

-- RenameIndex
ALTER INDEX "knowledge_references_target_idx" RENAME TO "knowledge_references_target_knowledge_id_idx";

-- RenameIndex
ALTER INDEX "idx_pending_circle_ghost_settings_expires_at" RENAME TO "pending_circle_ghost_settings_expires_at_idx";

-- RenameIndex
ALTER INDEX "idx_pending_circle_ghost_settings_requested_by_pubkey" RENAME TO "pending_circle_ghost_settings_requested_by_pubkey_idx";
