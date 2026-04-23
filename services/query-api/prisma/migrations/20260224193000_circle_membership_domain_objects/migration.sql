-- CreateEnum
CREATE TYPE "CircleJoinRequestStatus" AS ENUM ('Pending', 'Approved', 'Rejected', 'Cancelled', 'Expired');

-- CreateEnum
CREATE TYPE "CircleInviteStatus" AS ENUM ('Active', 'Accepted', 'Revoked', 'Expired');

-- CreateEnum
CREATE TYPE "CircleMembershipEventType" AS ENUM (
    'JoinRequested',
    'JoinApproved',
    'JoinRejected',
    'Joined',
    'Left',
    'Banned',
    'Unbanned',
    'RoleChanged',
    'InviteCreated',
    'InviteAccepted'
);

-- CreateTable
CREATE TABLE "circle_join_requests" (
    "id" SERIAL NOT NULL,
    "circle_id" INTEGER NOT NULL,
    "user_id" INTEGER NOT NULL,
    "status" "CircleJoinRequestStatus" NOT NULL DEFAULT 'Pending',
    "request_message" TEXT,
    "decision_reason" TEXT,
    "reviewed_by_id" INTEGER,
    "reviewed_at" TIMESTAMP(3),
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "circle_join_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "circle_invites" (
    "id" SERIAL NOT NULL,
    "circle_id" INTEGER NOT NULL,
    "inviter_id" INTEGER NOT NULL,
    "invitee_user_id" INTEGER,
    "invitee_handle" VARCHAR(64),
    "code" VARCHAR(128) NOT NULL,
    "status" "CircleInviteStatus" NOT NULL DEFAULT 'Active',
    "note" TEXT,
    "accepted_by_id" INTEGER,
    "accepted_at" TIMESTAMP(3),
    "expires_at" TIMESTAMP(3),
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "circle_invites_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "circle_membership_events" (
    "id" BIGSERIAL NOT NULL,
    "circle_id" INTEGER NOT NULL,
    "user_id" INTEGER NOT NULL,
    "actor_user_id" INTEGER,
    "event_type" "CircleMembershipEventType" NOT NULL,
    "role_before" "MemberRole",
    "role_after" "MemberRole",
    "status_before" "MemberStatus",
    "status_after" "MemberStatus",
    "join_request_id" INTEGER,
    "invite_id" INTEGER,
    "reason" TEXT,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "circle_membership_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "circle_join_requests_circle_id_status_created_at_idx"
ON "circle_join_requests"("circle_id", "status", "created_at" DESC);

-- CreateIndex
CREATE INDEX "circle_join_requests_user_id_status_created_at_idx"
ON "circle_join_requests"("user_id", "status", "created_at" DESC);

-- CreateIndex
CREATE INDEX "circle_join_requests_reviewed_by_id_reviewed_at_idx"
ON "circle_join_requests"("reviewed_by_id", "reviewed_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "circle_invites_code_key" ON "circle_invites"("code");

-- CreateIndex
CREATE INDEX "circle_invites_circle_id_status_created_at_idx"
ON "circle_invites"("circle_id", "status", "created_at" DESC);

-- CreateIndex
CREATE INDEX "circle_invites_inviter_id_created_at_idx"
ON "circle_invites"("inviter_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "circle_invites_invitee_user_id_status_created_at_idx"
ON "circle_invites"("invitee_user_id", "status", "created_at" DESC);

-- CreateIndex
CREATE INDEX "circle_invites_invitee_handle_status_created_at_idx"
ON "circle_invites"("invitee_handle", "status", "created_at" DESC);

-- CreateIndex
CREATE INDEX "circle_invites_expires_at_idx" ON "circle_invites"("expires_at");

-- CreateIndex
CREATE INDEX "circle_membership_events_circle_id_created_at_idx"
ON "circle_membership_events"("circle_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "circle_membership_events_user_id_created_at_idx"
ON "circle_membership_events"("user_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "circle_membership_events_actor_user_id_created_at_idx"
ON "circle_membership_events"("actor_user_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "circle_membership_events_event_type_created_at_idx"
ON "circle_membership_events"("event_type", "created_at" DESC);

-- AddForeignKey
ALTER TABLE "circle_join_requests"
ADD CONSTRAINT "circle_join_requests_circle_id_fkey"
FOREIGN KEY ("circle_id") REFERENCES "circles"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "circle_join_requests"
ADD CONSTRAINT "circle_join_requests_user_id_fkey"
FOREIGN KEY ("user_id") REFERENCES "users"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "circle_join_requests"
ADD CONSTRAINT "circle_join_requests_reviewed_by_id_fkey"
FOREIGN KEY ("reviewed_by_id") REFERENCES "users"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "circle_invites"
ADD CONSTRAINT "circle_invites_circle_id_fkey"
FOREIGN KEY ("circle_id") REFERENCES "circles"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "circle_invites"
ADD CONSTRAINT "circle_invites_inviter_id_fkey"
FOREIGN KEY ("inviter_id") REFERENCES "users"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "circle_invites"
ADD CONSTRAINT "circle_invites_invitee_user_id_fkey"
FOREIGN KEY ("invitee_user_id") REFERENCES "users"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "circle_invites"
ADD CONSTRAINT "circle_invites_accepted_by_id_fkey"
FOREIGN KEY ("accepted_by_id") REFERENCES "users"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "circle_membership_events"
ADD CONSTRAINT "circle_membership_events_circle_id_fkey"
FOREIGN KEY ("circle_id") REFERENCES "circles"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "circle_membership_events"
ADD CONSTRAINT "circle_membership_events_user_id_fkey"
FOREIGN KEY ("user_id") REFERENCES "users"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "circle_membership_events"
ADD CONSTRAINT "circle_membership_events_actor_user_id_fkey"
FOREIGN KEY ("actor_user_id") REFERENCES "users"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "circle_membership_events"
ADD CONSTRAINT "circle_membership_events_join_request_id_fkey"
FOREIGN KEY ("join_request_id") REFERENCES "circle_join_requests"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "circle_membership_events"
ADD CONSTRAINT "circle_membership_events_invite_id_fkey"
FOREIGN KEY ("invite_id") REFERENCES "circle_invites"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
