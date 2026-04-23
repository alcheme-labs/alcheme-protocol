-- Backfill missing creator memberships so owner-created circles are visible in myCircles
-- and role-based actions work consistently.
INSERT INTO "circle_members" (
  "circle_id",
  "user_id",
  "role",
  "status",
  "identity_level",
  "on_chain_address",
  "last_synced_slot",
  "joined_at",
  "updated_at"
)
SELECT
  c."id",
  c."creator_id",
  'Owner'::"MemberRole",
  'Active'::"MemberStatus",
  'Member'::"IdentityLevel",
  ('cm:' || c."id"::text || ':' || c."creator_id"::text),
  0,
  COALESCE(c."created_at", NOW()),
  NOW()
FROM "circles" c
LEFT JOIN "circle_members" cm
  ON cm."circle_id" = c."id"
 AND cm."user_id" = c."creator_id"
WHERE c."creator_id" IS NOT NULL
  AND cm."id" IS NULL;
