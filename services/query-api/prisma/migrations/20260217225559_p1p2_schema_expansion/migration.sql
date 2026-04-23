-- CreateEnum
CREATE TYPE "PostStatus" AS ENUM ('Active', 'Draft', 'Published', 'Archived', 'Deleted', 'Moderated', 'Suspended', 'Flagged', 'UnderReview', 'Hidden');

-- CreateEnum
CREATE TYPE "Visibility" AS ENUM ('Public', 'CircleOnly', 'FollowersOnly', 'Private');

-- CreateEnum
CREATE TYPE "CircleType" AS ENUM ('Open', 'Closed', 'Secret');

-- CreateEnum
CREATE TYPE "JoinRequirement" AS ENUM ('Free', 'ApprovalRequired', 'TokenGated', 'InviteOnly');

-- CreateEnum
CREATE TYPE "MemberRole" AS ENUM ('Owner', 'Admin', 'Moderator', 'Member');

-- CreateEnum
CREATE TYPE "MemberStatus" AS ENUM ('Active', 'Banned', 'Left');

-- CreateEnum
CREATE TYPE "ConversationType" AS ENUM ('Direct', 'Group', 'Channel');

-- CreateEnum
CREATE TYPE "MessageStatus" AS ENUM ('Sent', 'Delivered', 'Read', 'Recalled', 'Deleted');

-- CreateTable
CREATE TABLE "users" (
    "id" SERIAL NOT NULL,
    "handle" VARCHAR(32) NOT NULL,
    "pubkey" VARCHAR(44) NOT NULL,
    "display_name" VARCHAR(128),
    "bio" TEXT,
    "avatar_uri" TEXT,
    "banner_uri" TEXT,
    "website" VARCHAR(256),
    "location" VARCHAR(128),
    "reputation_score" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "followers_count" INTEGER NOT NULL DEFAULT 0,
    "following_count" INTEGER NOT NULL DEFAULT 0,
    "posts_count" INTEGER NOT NULL DEFAULT 0,
    "circles_count" INTEGER NOT NULL DEFAULT 0,
    "email" VARCHAR(255),
    "email_verified" BOOLEAN NOT NULL DEFAULT false,
    "twitter_id" VARCHAR(64),
    "twitter_handle" VARCHAR(32),
    "twitter_verified" BOOLEAN NOT NULL DEFAULT false,
    "verification_level" INTEGER NOT NULL DEFAULT 0,
    "on_chain_address" VARCHAR(44) NOT NULL,
    "last_synced_slot" BIGINT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "posts" (
    "id" SERIAL NOT NULL,
    "content_id" VARCHAR(128) NOT NULL,
    "author_id" INTEGER NOT NULL,
    "text" TEXT,
    "content_type" VARCHAR(32) NOT NULL,
    "storage_uri" TEXT,
    "storage_provider" VARCHAR(32),
    "parent_post_id" INTEGER,
    "thread_root_id" INTEGER,
    "reply_depth" INTEGER NOT NULL DEFAULT 0,
    "circle_id" INTEGER,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "likes_count" INTEGER NOT NULL DEFAULT 0,
    "reposts_count" INTEGER NOT NULL DEFAULT 0,
    "replies_count" INTEGER NOT NULL DEFAULT 0,
    "comments_count" INTEGER NOT NULL DEFAULT 0,
    "shares_count" INTEGER NOT NULL DEFAULT 0,
    "views_count" INTEGER NOT NULL DEFAULT 0,
    "heat_score" DECIMAL(10,4) NOT NULL DEFAULT 0,
    "status" "PostStatus" NOT NULL DEFAULT 'Active',
    "visibility" "Visibility" NOT NULL DEFAULT 'Public',
    "on_chain_address" VARCHAR(44) NOT NULL,
    "last_synced_slot" BIGINT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "posts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "circles" (
    "id" SERIAL NOT NULL,
    "name" VARCHAR(128) NOT NULL,
    "description" TEXT,
    "avatar_uri" TEXT,
    "banner_uri" TEXT,
    "creator_id" INTEGER NOT NULL,
    "circle_type" "CircleType" NOT NULL DEFAULT 'Open',
    "join_requirement" "JoinRequirement" NOT NULL DEFAULT 'Free',
    "level" INTEGER NOT NULL DEFAULT 0,
    "parent_circle_id" INTEGER,
    "knowledge_count" INTEGER NOT NULL DEFAULT 0,
    "members_count" INTEGER NOT NULL DEFAULT 0,
    "posts_count" INTEGER NOT NULL DEFAULT 0,
    "on_chain_address" VARCHAR(44) NOT NULL,
    "last_synced_slot" BIGINT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "circles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "circle_members" (
    "id" SERIAL NOT NULL,
    "circle_id" INTEGER NOT NULL,
    "user_id" INTEGER NOT NULL,
    "role" "MemberRole" NOT NULL DEFAULT 'Member',
    "status" "MemberStatus" NOT NULL DEFAULT 'Active',
    "on_chain_address" VARCHAR(44) NOT NULL,
    "last_synced_slot" BIGINT NOT NULL,
    "joined_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "circle_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "follows" (
    "id" SERIAL NOT NULL,
    "follower_id" INTEGER NOT NULL,
    "following_id" INTEGER NOT NULL,
    "on_chain_address" VARCHAR(44) NOT NULL,
    "last_synced_slot" BIGINT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "follows_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "likes" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "post_id" INTEGER NOT NULL,
    "on_chain_address" VARCHAR(44) NOT NULL,
    "last_synced_slot" BIGINT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "likes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "conversations" (
    "id" SERIAL NOT NULL,
    "conversation_id" VARCHAR(44) NOT NULL,
    "conversation_type" "ConversationType" NOT NULL DEFAULT 'Direct',
    "creator_id" INTEGER NOT NULL,
    "on_chain_address" VARCHAR(44) NOT NULL,
    "last_synced_slot" BIGINT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "conversations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "conversation_participants" (
    "id" SERIAL NOT NULL,
    "conversation_id" INTEGER NOT NULL,
    "user_id" INTEGER NOT NULL,
    "joined_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "conversation_participants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "messages" (
    "id" SERIAL NOT NULL,
    "message_id" VARCHAR(44),
    "conversation_id" INTEGER,
    "sender_id" INTEGER NOT NULL,
    "recipient_id" INTEGER,
    "text" TEXT NOT NULL,
    "message_type" VARCHAR(32) NOT NULL DEFAULT 'Text',
    "encrypted" BOOLEAN NOT NULL DEFAULT false,
    "reply_to_id" INTEGER,
    "status" "MessageStatus" NOT NULL DEFAULT 'Sent',
    "on_chain_address" VARCHAR(44) NOT NULL,
    "last_synced_slot" BIGINT NOT NULL,
    "sent_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "read_at" TIMESTAMP(3),

    CONSTRAINT "messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sync_checkpoints" (
    "id" SERIAL NOT NULL,
    "program_id" VARCHAR(44) NOT NULL,
    "program_name" VARCHAR(64) NOT NULL,
    "last_processed_slot" BIGINT NOT NULL,
    "last_processed_signature" VARCHAR(88),
    "total_events_processed" BIGINT NOT NULL DEFAULT 0,
    "last_event_timestamp" TIMESTAMP(3),
    "last_successful_sync" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sync_errors_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sync_checkpoints_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "knowledge" (
    "id" SERIAL NOT NULL,
    "knowledge_id" VARCHAR(64) NOT NULL,
    "circle_id" INTEGER NOT NULL,
    "title" VARCHAR(256) NOT NULL,
    "description" TEXT,
    "ipfs_cid" VARCHAR(128),
    "author_id" INTEGER NOT NULL,
    "quality_score" DECIMAL(10,4) NOT NULL DEFAULT 0,
    "citation_count" INTEGER NOT NULL DEFAULT 0,
    "view_count" INTEGER NOT NULL DEFAULT 0,
    "source_circle_id" INTEGER,
    "source_content_id" VARCHAR(128),
    "on_chain_address" VARCHAR(44) NOT NULL,
    "last_synced_slot" BIGINT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "knowledge_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "draft_comments" (
    "id" SERIAL NOT NULL,
    "post_id" INTEGER NOT NULL,
    "user_id" INTEGER NOT NULL,
    "content" TEXT NOT NULL,
    "line_ref" VARCHAR(128),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "draft_comments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "authority_scores" (
    "id" SERIAL NOT NULL,
    "crystal_id" VARCHAR(128) NOT NULL,
    "score" DECIMAL(18,8) NOT NULL,
    "epoch" INTEGER NOT NULL,
    "calculated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "authority_scores_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "anti_gaming_flags" (
    "id" SERIAL NOT NULL,
    "user_pubkey" VARCHAR(44) NOT NULL,
    "flag_type" VARCHAR(64) NOT NULL,
    "details" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "anti_gaming_flags_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "settlement_history" (
    "id" SERIAL NOT NULL,
    "crystal_id" VARCHAR(128) NOT NULL,
    "contributor_pubkey" VARCHAR(44) NOT NULL,
    "authority_score" DECIMAL(18,8) NOT NULL,
    "reputation_delta" DECIMAL(18,8) NOT NULL,
    "tx_signature" VARCHAR(88),
    "settled_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "settlement_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "type" VARCHAR(32) NOT NULL,
    "title" VARCHAR(256) NOT NULL,
    "body" TEXT,
    "source_type" VARCHAR(32),
    "source_id" VARCHAR(128),
    "circle_id" INTEGER,
    "read" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_handle_key" ON "users"("handle");

-- CreateIndex
CREATE UNIQUE INDEX "users_pubkey_key" ON "users"("pubkey");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "users_twitter_id_key" ON "users"("twitter_id");

-- CreateIndex
CREATE INDEX "users_handle_idx" ON "users"("handle");

-- CreateIndex
CREATE INDEX "users_pubkey_idx" ON "users"("pubkey");

-- CreateIndex
CREATE INDEX "users_reputation_score_idx" ON "users"("reputation_score" DESC);

-- CreateIndex
CREATE INDEX "users_created_at_idx" ON "users"("created_at" DESC);

-- CreateIndex
CREATE INDEX "users_on_chain_address_idx" ON "users"("on_chain_address");

-- CreateIndex
CREATE UNIQUE INDEX "posts_content_id_key" ON "posts"("content_id");

-- CreateIndex
CREATE INDEX "posts_author_id_idx" ON "posts"("author_id");

-- CreateIndex
CREATE INDEX "posts_created_at_idx" ON "posts"("created_at" DESC);

-- CreateIndex
CREATE INDEX "posts_status_created_at_idx" ON "posts"("status", "created_at" DESC);

-- CreateIndex
CREATE INDEX "posts_thread_root_id_idx" ON "posts"("thread_root_id");

-- CreateIndex
CREATE INDEX "posts_parent_post_id_idx" ON "posts"("parent_post_id");

-- CreateIndex
CREATE INDEX "posts_circle_id_idx" ON "posts"("circle_id");

-- CreateIndex
CREATE INDEX "posts_on_chain_address_idx" ON "posts"("on_chain_address");

-- CreateIndex
CREATE UNIQUE INDEX "circles_on_chain_address_key" ON "circles"("on_chain_address");

-- CreateIndex
CREATE INDEX "circles_creator_id_idx" ON "circles"("creator_id");

-- CreateIndex
CREATE INDEX "circles_circle_type_idx" ON "circles"("circle_type");

-- CreateIndex
CREATE INDEX "circles_level_idx" ON "circles"("level");

-- CreateIndex
CREATE INDEX "circles_parent_circle_id_idx" ON "circles"("parent_circle_id");

-- CreateIndex
CREATE INDEX "circles_created_at_idx" ON "circles"("created_at" DESC);

-- CreateIndex
CREATE INDEX "circles_members_count_idx" ON "circles"("members_count" DESC);

-- CreateIndex
CREATE INDEX "circles_on_chain_address_idx" ON "circles"("on_chain_address");

-- CreateIndex
CREATE UNIQUE INDEX "circle_members_on_chain_address_key" ON "circle_members"("on_chain_address");

-- CreateIndex
CREATE INDEX "circle_members_circle_id_idx" ON "circle_members"("circle_id");

-- CreateIndex
CREATE INDEX "circle_members_user_id_idx" ON "circle_members"("user_id");

-- CreateIndex
CREATE INDEX "circle_members_status_idx" ON "circle_members"("status");

-- CreateIndex
CREATE INDEX "circle_members_role_idx" ON "circle_members"("role");

-- CreateIndex
CREATE UNIQUE INDEX "circle_members_circle_id_user_id_key" ON "circle_members"("circle_id", "user_id");

-- CreateIndex
CREATE UNIQUE INDEX "follows_on_chain_address_key" ON "follows"("on_chain_address");

-- CreateIndex
CREATE INDEX "follows_follower_id_idx" ON "follows"("follower_id");

-- CreateIndex
CREATE INDEX "follows_following_id_idx" ON "follows"("following_id");

-- CreateIndex
CREATE INDEX "follows_created_at_idx" ON "follows"("created_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "follows_follower_id_following_id_key" ON "follows"("follower_id", "following_id");

-- CreateIndex
CREATE UNIQUE INDEX "likes_on_chain_address_key" ON "likes"("on_chain_address");

-- CreateIndex
CREATE INDEX "likes_user_id_idx" ON "likes"("user_id");

-- CreateIndex
CREATE INDEX "likes_post_id_idx" ON "likes"("post_id");

-- CreateIndex
CREATE INDEX "likes_created_at_idx" ON "likes"("created_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "likes_user_id_post_id_key" ON "likes"("user_id", "post_id");

-- CreateIndex
CREATE UNIQUE INDEX "conversations_conversation_id_key" ON "conversations"("conversation_id");

-- CreateIndex
CREATE UNIQUE INDEX "conversations_on_chain_address_key" ON "conversations"("on_chain_address");

-- CreateIndex
CREATE INDEX "conversations_creator_id_idx" ON "conversations"("creator_id");

-- CreateIndex
CREATE INDEX "conversations_conversation_type_idx" ON "conversations"("conversation_type");

-- CreateIndex
CREATE INDEX "conversations_created_at_idx" ON "conversations"("created_at" DESC);

-- CreateIndex
CREATE INDEX "conversation_participants_conversation_id_idx" ON "conversation_participants"("conversation_id");

-- CreateIndex
CREATE INDEX "conversation_participants_user_id_idx" ON "conversation_participants"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "conversation_participants_conversation_id_user_id_key" ON "conversation_participants"("conversation_id", "user_id");

-- CreateIndex
CREATE UNIQUE INDEX "messages_message_id_key" ON "messages"("message_id");

-- CreateIndex
CREATE UNIQUE INDEX "messages_on_chain_address_key" ON "messages"("on_chain_address");

-- CreateIndex
CREATE INDEX "messages_conversation_id_sent_at_idx" ON "messages"("conversation_id", "sent_at" DESC);

-- CreateIndex
CREATE INDEX "messages_sender_id_sent_at_idx" ON "messages"("sender_id", "sent_at" DESC);

-- CreateIndex
CREATE INDEX "messages_recipient_id_sent_at_idx" ON "messages"("recipient_id", "sent_at" DESC);

-- CreateIndex
CREATE INDEX "messages_status_idx" ON "messages"("status");

-- CreateIndex
CREATE INDEX "messages_sender_id_recipient_id_sent_at_idx" ON "messages"("sender_id", "recipient_id", "sent_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "sync_checkpoints_program_id_key" ON "sync_checkpoints"("program_id");

-- CreateIndex
CREATE INDEX "sync_checkpoints_program_id_idx" ON "sync_checkpoints"("program_id");

-- CreateIndex
CREATE UNIQUE INDEX "knowledge_knowledge_id_key" ON "knowledge"("knowledge_id");

-- CreateIndex
CREATE UNIQUE INDEX "knowledge_on_chain_address_key" ON "knowledge"("on_chain_address");

-- CreateIndex
CREATE INDEX "knowledge_circle_id_idx" ON "knowledge"("circle_id");

-- CreateIndex
CREATE INDEX "knowledge_author_id_idx" ON "knowledge"("author_id");

-- CreateIndex
CREATE INDEX "knowledge_quality_score_idx" ON "knowledge"("quality_score" DESC);

-- CreateIndex
CREATE INDEX "knowledge_created_at_idx" ON "knowledge"("created_at" DESC);

-- CreateIndex
CREATE INDEX "draft_comments_post_id_created_at_idx" ON "draft_comments"("post_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "draft_comments_user_id_idx" ON "draft_comments"("user_id");

-- CreateIndex
CREATE INDEX "authority_scores_crystal_id_idx" ON "authority_scores"("crystal_id");

-- CreateIndex
CREATE INDEX "authority_scores_epoch_idx" ON "authority_scores"("epoch");

-- CreateIndex
CREATE INDEX "authority_scores_score_idx" ON "authority_scores"("score" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "authority_scores_crystal_id_epoch_key" ON "authority_scores"("crystal_id", "epoch");

-- CreateIndex
CREATE INDEX "anti_gaming_flags_user_pubkey_idx" ON "anti_gaming_flags"("user_pubkey");

-- CreateIndex
CREATE INDEX "anti_gaming_flags_flag_type_idx" ON "anti_gaming_flags"("flag_type");

-- CreateIndex
CREATE INDEX "anti_gaming_flags_created_at_idx" ON "anti_gaming_flags"("created_at" DESC);

-- CreateIndex
CREATE INDEX "settlement_history_crystal_id_idx" ON "settlement_history"("crystal_id");

-- CreateIndex
CREATE INDEX "settlement_history_contributor_pubkey_idx" ON "settlement_history"("contributor_pubkey");

-- CreateIndex
CREATE INDEX "settlement_history_settled_at_idx" ON "settlement_history"("settled_at" DESC);

-- CreateIndex
CREATE INDEX "notifications_user_id_read_idx" ON "notifications"("user_id", "read");

-- CreateIndex
CREATE INDEX "notifications_user_id_created_at_idx" ON "notifications"("user_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "notifications_type_idx" ON "notifications"("type");

-- AddForeignKey
ALTER TABLE "posts" ADD CONSTRAINT "posts_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "posts" ADD CONSTRAINT "posts_parent_post_id_fkey" FOREIGN KEY ("parent_post_id") REFERENCES "posts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "posts" ADD CONSTRAINT "posts_thread_root_id_fkey" FOREIGN KEY ("thread_root_id") REFERENCES "posts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "posts" ADD CONSTRAINT "posts_circle_id_fkey" FOREIGN KEY ("circle_id") REFERENCES "circles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "circles" ADD CONSTRAINT "circles_creator_id_fkey" FOREIGN KEY ("creator_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "circles" ADD CONSTRAINT "circles_parent_circle_id_fkey" FOREIGN KEY ("parent_circle_id") REFERENCES "circles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "circle_members" ADD CONSTRAINT "circle_members_circle_id_fkey" FOREIGN KEY ("circle_id") REFERENCES "circles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "circle_members" ADD CONSTRAINT "circle_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "follows" ADD CONSTRAINT "follows_follower_id_fkey" FOREIGN KEY ("follower_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "follows" ADD CONSTRAINT "follows_following_id_fkey" FOREIGN KEY ("following_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "likes" ADD CONSTRAINT "likes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "likes" ADD CONSTRAINT "likes_post_id_fkey" FOREIGN KEY ("post_id") REFERENCES "posts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_creator_id_fkey" FOREIGN KEY ("creator_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversation_participants" ADD CONSTRAINT "conversation_participants_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversation_participants" ADD CONSTRAINT "conversation_participants_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_sender_id_fkey" FOREIGN KEY ("sender_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_recipient_id_fkey" FOREIGN KEY ("recipient_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_reply_to_id_fkey" FOREIGN KEY ("reply_to_id") REFERENCES "messages"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "knowledge" ADD CONSTRAINT "knowledge_circle_id_fkey" FOREIGN KEY ("circle_id") REFERENCES "circles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "knowledge" ADD CONSTRAINT "knowledge_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "knowledge" ADD CONSTRAINT "knowledge_source_circle_id_fkey" FOREIGN KEY ("source_circle_id") REFERENCES "circles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "draft_comments" ADD CONSTRAINT "draft_comments_post_id_fkey" FOREIGN KEY ("post_id") REFERENCES "posts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "draft_comments" ADD CONSTRAINT "draft_comments_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
