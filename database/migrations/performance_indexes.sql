-- Alcheme Protocol - 性能优化索引
-- 根据常见查询模式添加数据库索引

-- ==================== Identities 表 ====================

-- 按所有者查询身份（最常见查询）
CREATE INDEX IF NOT EXISTS idx_identities_owner 
ON identities(owner);

-- 按用户名查询（用户资料页面）
CREATE INDEX IF NOT EXISTS idx_identities_username 
ON identities(username);

-- 按创建时间排序（最新身份）
CREATE INDEX IF NOT EXISTS idx_identities_created_at 
ON identities(created_at DESC);

-- 组合索引：所有者 + 创建时间（用户的身份列表）
CREATE INDEX IF NOT EXISTS idx_identities_owner_created 
ON identities(owner, created_at DESC);

-- ==================== Content 表 ====================

-- 按作者查询内容（用户发布的内容）
CREATE INDEX IF NOT EXISTS idx_content_author 
ON content(author);

-- 按内容类型查询（文章、帖子等）
CREATE INDEX IF NOT EXISTS idx_content_type 
ON content(content_type);

-- 按创建时间排序（时间线）
CREATE INDEX IF NOT EXISTS idx_content_created_at 
ON content(created_at DESC);

-- 组合索引：作者 + 创建时间（用户内容时间线）
CREATE INDEX IF NOT EXISTS idx_content_author_created 
ON content(author, created_at DESC);

-- 组合索引：内容类型 + 创建时间（分类时间线）
CREATE INDEX IF NOT EXISTS idx_content_type_created 
ON content(content_type, created_at DESC);

-- 父内容索引（评论、回复）
CREATE INDEX IF NOT EXISTS idx_content_parent 
ON content(parent_content_id) 
WHERE parent_content_id IS NOT NULL;

-- ==================== Relationships 表 ====================

-- 按源地址查询（用户的关注列表）
CREATE INDEX IF NOT EXISTS idx_relationships_from 
ON relationships(from_address);

-- 按目标地址查询（用户的粉丝列表）
CREATE INDEX IF NOT EXISTS idx_relationships_to 
ON relationships(to_address);

-- 按关系类型查询
CREATE INDEX IF NOT EXISTS idx_relationships_type 
ON relationships(relationship_type);

-- 组合索引：源 + 类型（某用户的特定关系）
CREATE INDEX IF NOT EXISTS idx_relationships_from_type 
ON relationships(from_address, relationship_type);

-- 组合索引：目标 + 类型（某用户的特定粉丝）
CREATE INDEX IF NOT EXISTS idx_relationships_to_type 
ON relationships(to_address, relationship_type);

-- 唯一组合索引：防止重复关系
CREATE UNIQUE INDEX IF NOT EXISTS idx_relationships_unique 
ON relationships(from_address, to_address, relationship_type);

-- ==================== Messages 表 ====================

-- 按发送者查询
CREATE INDEX IF NOT EXISTS idx_messages_sender 
ON messages(sender);

-- 按接收者查询（收件箱）
CREATE INDEX IF NOT EXISTS idx_messages_recipient 
ON messages(recipient);

-- 按读取状态查询（未读消息）
CREATE INDEX IF NOT EXISTS idx_messages_read_status 
ON messages(is_read) 
WHERE is_read = false;

-- 组合索引：接收者 + 读取状态（未读收件箱）
CREATE INDEX IF NOT EXISTS idx_messages_recipient_unread 
ON messages(recipient, is_read, created_at DESC) 
WHERE is_read = false;

-- 组合索引：发送者 + 创建时间（发件箱）
CREATE INDEX IF NOT EXISTS idx_messages_sender_created 
ON messages(sender, created_at DESC);

-- ==================== Events 表（索引器）====================

-- 按区块槽位查询（同步进度）
CREATE INDEX IF NOT EXISTS idx_events_slot 
ON events(slot);

-- 按交易签名查询
CREATE INDEX IF NOT EXISTS idx_events_signature 
ON events(signature);

-- 按事件类型查询
CREATE INDEX IF NOT EXISTS idx_events_event_type 
ON events(event_type);

-- 按时间戳排序（事件时间线）
CREATE INDEX IF NOT EXISTS idx_events_timestamp 
ON events(timestamp DESC);

-- 组合索引：事件类型 + 时间戳
CREATE INDEX IF NOT EXISTS idx_events_type_timestamp 
ON events(event_type, timestamp DESC);

-- ==================== 全文搜索索引 ====================

-- 内容全文搜索（如果使用 PostgreSQL 全文搜索）
-- CREATE INDEX IF NOT EXISTS idx_content_fulltext 
-- ON content USING GIN(to_tsvector('english', content_data));

-- 身份用户名全文搜索
-- CREATE INDEX IF NOT EXISTS idx_identities_username_fulltext 
-- ON identities USING GIN(to_tsvector('english', username));

-- ==================== 分析和统计 ====================

-- 创建索引后，更新表统计信息以优化查询计划
ANALYZE identities;
ANALYZE content;
ANALYZE relationships;
ANALYZE messages;
ANALYZE events;

-- ==================== 索引使用情况监控 ====================

-- 查看索引使用情况的查询（供运维参考）
-- SELECT 
--     schemaname,
--     tablename,
--     indexname,
--     idx_scan as index_scans,
--     idx_tup_read as tuples_read,
--     idx_tup_fetch as tuples_fetched
-- FROM pg_stat_user_indexes
-- ORDER BY idx_scan DESC;

-- 查找未使用的索引（定期清理）
-- SELECT 
--     schemaname,
--     tablename,
--     indexname
-- FROM pg_stat_user_indexes
-- WHERE idx_scan = 0
--   AND indexname NOT LIKE '%_pkey';
