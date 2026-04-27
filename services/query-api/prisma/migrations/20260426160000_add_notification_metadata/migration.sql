ALTER TABLE "notifications"
ADD COLUMN "metadata" JSONB;

UPDATE "notifications"
SET "metadata" = jsonb_build_object(
  'messageKey', 'discussion.forwarded',
  'params', jsonb_build_object(
    'senderLabel', substring("body" FROM '^(.*) 将你的消息转发到了 .*$'),
    'targetCircleName', substring("body" FROM '^.* 将你的消息转发到了 (.*)$')
  )
),
"title" = 'discussion.forwarded',
"body" = NULL
WHERE "metadata" IS NULL
  AND "type" = 'forward'
  AND "body" ~ '^.* 将你的消息转发到了 .*$';

UPDATE "notifications"
SET "metadata" = jsonb_build_object(
  'messageKey', 'discussion.highlighted',
  'params', jsonb_build_object()
),
"title" = 'discussion.highlighted',
"body" = NULL
WHERE "metadata" IS NULL
  AND "type" = 'highlight';

UPDATE "notifications"
SET "metadata" = jsonb_build_object(
  'messageKey', 'discussion.draft_ready',
  'params', jsonb_build_object(
    'messageCount', (substring("body" FROM 'showing draft-ready signals \(([0-9]+) messages'))::int,
    'focusedPercent', (substring("body" FROM 'messages, ([0-9]+)% focused'))::int,
    'questionCount', (substring("body" FROM 'focused, ([0-9]+) questions'))::int,
    'summary', substring("body" FROM 'Summary: (.*)$')
  )
),
"title" = 'discussion.draft_ready',
"body" = NULL
WHERE "metadata" IS NULL
  AND "type" = 'draft'
  AND "body" ~ '^This discussion is showing draft-ready signals \([0-9]+ messages, [0-9]+% focused, [0-9]+ questions\)\.';

UPDATE "notifications"
SET "metadata" = jsonb_build_object(
  'messageKey', 'identity.level_changed',
  'params', jsonb_strip_nulls(jsonb_build_object(
    'circleName', CASE
      WHEN substring("body" FROM '^你在「(.+)」的身份由') ~ '^圈层 #[0-9]+$'
        THEN NULL
      ELSE substring("body" FROM '^你在「(.+)」的身份由')
    END,
    'previousLevel', split_part("source_id", '->', 1),
    'nextLevel', split_part("source_id", '->', 2),
    'reasonKey', CASE
      WHEN "body" ~ '原因：已发送 [0-9]+ 条消息，达到 [0-9]+ 条门槛，已晋升为入局者。$'
        THEN 'identity.message_threshold_promoted'
      WHEN "body" ~ '原因：已获得 [0-9]+ 次引用，达到 [0-9]+ 次门槛，已晋升为成员。$'
        THEN 'identity.citation_threshold_promoted'
      WHEN "body" ~ '原因：当前信誉位于前 [0-9.]+%（阈值前 [0-9.]+%），已晋升为长老。$'
        THEN 'identity.reputation_threshold_promoted'
      WHEN "body" ~ '原因：当前信誉已降至前 [0-9.]+% 之外（阈值前 [0-9.]+%），身份调整为成员。$'
        THEN 'identity.reputation_demotion'
      WHEN "body" ~ '原因：已 [0-9]+ 天未活跃（阈值 [0-9]+ 天），身份调整为入局者。$'
        THEN 'identity.inactivity_demotion'
      ELSE NULL
    END,
    'reasonParams', CASE
      WHEN "body" ~ '原因：已发送 [0-9]+ 条消息，达到 [0-9]+ 条门槛，已晋升为入局者。$'
        THEN jsonb_build_object(
          'messageCount', substring("body" FROM '已发送 ([0-9]+) 条消息'),
          'threshold', substring("body" FROM '达到 ([0-9]+) 条门槛')
        )
      WHEN "body" ~ '原因：已获得 [0-9]+ 次引用，达到 [0-9]+ 次门槛，已晋升为成员。$'
        THEN jsonb_build_object(
          'citationCount', substring("body" FROM '已获得 ([0-9]+) 次引用'),
          'threshold', substring("body" FROM '达到 ([0-9]+) 次门槛')
        )
      WHEN "body" ~ '原因：当前信誉位于前 [0-9.]+%（阈值前 [0-9.]+%），已晋升为长老。$'
        THEN jsonb_build_object(
          'reputationPercentile', substring("body" FROM '当前信誉位于前 ([0-9.]+)%（阈值前'),
          'threshold', substring("body" FROM '阈值前 ([0-9.]+)%）')
        )
      WHEN "body" ~ '原因：当前信誉已降至前 [0-9.]+% 之外（阈值前 [0-9.]+%），身份调整为成员。$'
        THEN jsonb_build_object(
          'reputationPercentile', substring("body" FROM '当前信誉已降至前 ([0-9.]+)% 之外'),
          'threshold', substring("body" FROM '阈值前 ([0-9.]+)%）')
        )
      WHEN "body" ~ '原因：已 [0-9]+ 天未活跃（阈值 [0-9]+ 天），身份调整为入局者。$'
        THEN jsonb_build_object(
          'daysInactive', substring("body" FROM '已 ([0-9]+) 天未活跃'),
          'threshold', substring("body" FROM '阈值 ([0-9]+) 天')
        )
      ELSE NULL
    END
  ))
),
"title" = 'identity.level_changed',
"body" = NULL
WHERE "metadata" IS NULL
  AND "type" = 'identity'
  AND "source_id" ~ '^(Visitor|Initiate|Member|Elder)->(Visitor|Initiate|Member|Elder)$';

UPDATE "notifications"
SET "metadata" = jsonb_build_object(
  'messageKey', 'knowledge.crystallized',
  'params', jsonb_build_object(
    'knowledgeTitle', substring("body" FROM '^你的知识「(.+)」已成功结晶$')
  )
),
"title" = 'knowledge.crystallized',
"body" = NULL
WHERE "metadata" IS NULL
  AND "type" = 'crystal'
  AND "source_type" = 'knowledge'
  AND "body" ~ '^你的知识「.+」已成功结晶$';

UPDATE "notifications"
SET "metadata" = jsonb_build_object(
  'messageKey', 'totem.stage_upgraded',
  'params', jsonb_build_object(
    'stage', substring("source_id" FROM '^totem:(sprout|bloom|radiant|legendary)$')
  )
),
"title" = 'totem.stage_upgraded',
"body" = NULL
WHERE "metadata" IS NULL
  AND "type" = 'crystal'
  AND "source_type" = 'totem'
  AND "source_id" ~ '^totem:(sprout|bloom|radiant|legendary)$';

UPDATE "notifications"
SET "metadata" = jsonb_build_object(
  'messageKey', 'knowledge.cited',
  'params', jsonb_build_object(
    'knowledgeTitle', substring("body" FROM '^你的知识「(.+)」被其他晶体引用$')
  )
),
"title" = 'knowledge.cited',
"body" = NULL
WHERE "metadata" IS NULL
  AND "type" = 'citation'
  AND "source_type" = 'knowledge'
  AND "body" ~ '^你的知识「.+」被其他晶体引用$';

UPDATE "notifications"
SET "metadata" = jsonb_build_object(
  'messageKey', 'knowledge.crystal_milestone',
  'params', jsonb_build_object(
    'milestone', (substring("source_id" FROM '^milestone:([0-9]+)$'))::int
  )
),
"title" = 'knowledge.crystal_milestone',
"body" = NULL
WHERE "metadata" IS NULL
  AND "type" = 'circle'
  AND "source_type" = 'milestone'
  AND "source_id" ~ '^milestone:[0-9]+$';
