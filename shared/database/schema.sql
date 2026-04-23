-- Alcheme Protocol 数据库 Schema
-- Version: 1.0
-- PostgreSQL 16+

BEGIN;

-- 用户表
CREATE TABLE users (
  id SERIAL PRIMARY KEY,
  handle VARCHAR(32) UNIQUE NOT NULL,
  pubkey VARCHAR(44) UNIQUE NOT NULL,
  display_name VARCHAR(128),
  bio TEXT,
  avatar_uri TEXT,
  banner_uri TEXT,
  website VARCHAR(256),
  location VARCHAR(128),
  metadata_uri TEXT,
  
  reputation_score DECIMAL(10,2) DEFAULT 0,
  followers_count INTEGER DEFAULT 0,
  following_count INTEGER DEFAULT 0,
  posts_count INTEGER DEFAULT 0,
  circles_count INTEGER DEFAULT 0,
  
  on_chain_address VARCHAR(44) NOT NULL,
  last_synced_slot BIGINT NOT NULL,
  
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  
  CONSTRAINT handle_format CHECK (handle ~ '^[a-z0-9_]{3,32}$'),
  CONSTRAINT reputation_positive CHECK (reputation_score >= 0)
);

CREATE INDEX idx_users_handle ON users(handle);
CREATE INDEX idx_users_pubkey ON users(pubkey);
CREATE INDEX idx_users_reputation ON users(reputation_score DESC);
CREATE INDEX idx_users_created ON users(created_at DESC);
CREATE INDEX idx_users_on_chain ON users(on_chain_address);

-- 帖子表
CREATE TABLE posts (
  id SERIAL PRIMARY KEY,
  content_id VARCHAR(128) UNIQUE NOT NULL,
  author_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  
  text TEXT,
  content_type VARCHAR(32) NOT NULL,
  storage_uri TEXT,
  storage_provider VARCHAR(32),
  
  parent_post_id INTEGER REFERENCES posts(id) ON DELETE SET NULL,
  thread_root_id INTEGER REFERENCES posts(id) ON DELETE SET NULL,
  reply_depth INTEGER DEFAULT 0,
  
  circle_id INTEGER,
  tags TEXT[] DEFAULT '{}',
  
  likes_count INTEGER DEFAULT 0,
  reposts_count INTEGER DEFAULT 0,
  replies_count INTEGER DEFAULT 0,
  views_count INTEGER DEFAULT 0,
  
  status VARCHAR(32) DEFAULT 'Active' CHECK (status IN ('Active', 'Deleted', 'Hidden', 'Flagged')),
  visibility VARCHAR(32) DEFAULT 'Public' CHECK (visibility IN ('Public', 'CircleOnly', 'FollowersOnly', 'Private')),
  
  on_chain_address VARCHAR(44) NOT NULL,
  last_synced_slot BIGINT NOT NULL,
  
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_posts_author ON posts(author_id);
CREATE INDEX idx_posts_created ON posts(created_at DESC);
CREATE INDEX idx_posts_status_created ON posts(status, created_at DESC) WHERE status = 'Active';
CREATE INDEX idx_posts_thread_root ON posts(thread_root_id);
CREATE INDEX idx_posts_parent ON posts(parent_post_id);
CREATE INDEX idx_posts_circle ON posts(circle_id);
CREATE INDEX idx_posts_tags ON posts USING gin(tags);
CREATE INDEX idx_posts_on_chain ON posts(on_chain_address);
CREATE INDEX idx_posts_text_search ON posts USING gin(to_tsvector('english', text));

-- 圈子表
CREATE TABLE circles (
  id SERIAL PRIMARY KEY,
  name VARCHAR(128) NOT NULL,
  description TEXT,
  avatar_uri TEXT,
  banner_uri TEXT,
  
  creator_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  
  circle_type VARCHAR(32) DEFAULT 'Open' CHECK (circle_type IN ('Open', 'Closed', 'Secret')),
  join_requirement VARCHAR(32) DEFAULT 'Free' CHECK (join_requirement IN ('Free', 'ApprovalRequired', 'TokenGated', 'InviteOnly')),
  
  members_count INTEGER DEFAULT 0,
  posts_count INTEGER DEFAULT 0,
  
  on_chain_address VARCHAR(44) UNIQUE NOT NULL,
  last_synced_slot BIGINT NOT NULL,
  
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_circles_creator ON circles(creator_id);
CREATE INDEX idx_circles_type ON circles(circle_type);
CREATE INDEX idx_circles_created ON circles(created_at DESC);
CREATE INDEX idx_circles_members_count ON circles(members_count DESC);
CREATE INDEX idx_circles_on_chain ON circles(on_chain_address);

-- 添加外键
ALTER TABLE posts ADD CONSTRAINT fk_posts_circle 
  FOREIGN KEY (circle_id) REFERENCES circles(id) ON DELETE SET NULL;

-- 圈子成员表
CREATE TABLE circle_members (
  id SERIAL PRIMARY KEY,
  circle_id INTEGER REFERENCES circles(id) ON DELETE CASCADE,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  
  role VARCHAR(32) DEFAULT 'Member' CHECK (role IN ('Owner', 'Admin', 'Moderator', 'Member')),
  status VARCHAR(32) DEFAULT 'Active' CHECK (status IN ('Active', 'Banned', 'Left')),
  
  on_chain_address VARCHAR(44) UNIQUE NOT NULL,
  last_synced_slot BIGINT NOT NULL,
  
  joined_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  
  UNIQUE(circle_id, user_id)
);

CREATE INDEX idx_circle_members_circle ON circle_members(circle_id);
CREATE INDEX idx_circle_members_user ON circle_members(user_id);
CREATE INDEX idx_circle_members_status ON circle_members(status) WHERE status = 'Active';
CREATE INDEX idx_circle_members_role ON circle_members(role);

-- 关注关系表
CREATE TABLE follows (
  id SERIAL PRIMARY KEY,
  follower_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  following_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  
  on_chain_address VARCHAR(44) UNIQUE NOT NULL,
  last_synced_slot BIGINT NOT NULL,
  
  created_at TIMESTAMP DEFAULT NOW(),
  
  UNIQUE(follower_id, following_id),
  CONSTRAINT no_self_follow CHECK (follower_id != following_id)
);

CREATE INDEX idx_follows_follower ON follows(follower_id);
CREATE INDEX idx_follows_following ON follows(following_id);
CREATE INDEX idx_follows_created ON follows(created_at DESC);

-- 点赞表
CREATE TABLE likes (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  post_id INTEGER REFERENCES posts(id) ON DELETE CASCADE,
  
  on_chain_address VARCHAR(44) UNIQUE NOT NULL,
  last_synced_slot BIGINT NOT NULL,
  
  created_at TIMESTAMP DEFAULT NOW(),
  
  UNIQUE(user_id, post_id)
);

CREATE INDEX idx_likes_user ON likes(user_id);
CREATE INDEX idx_likes_post ON likes(post_id);
CREATE INDEX idx_likes_created ON likes(created_at DESC);

-- 消息表
CREATE TABLE messages (
  id SERIAL PRIMARY KEY,
  sender_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  recipient_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  
  text TEXT NOT NULL,
  encrypted BOOLEAN DEFAULT FALSE,
  
  status VARCHAR(32) DEFAULT 'Sent' CHECK (status IN ('Sent', 'Delivered', 'Read', 'Deleted')),
  
  on_chain_address VARCHAR(44) UNIQUE NOT NULL,
  last_synced_slot BIGINT NOT NULL,
  
  sent_at TIMESTAMP DEFAULT NOW(),
  read_at TIMESTAMP
);

CREATE INDEX idx_messages_sender ON messages(sender_id, sent_at DESC);
CREATE INDEX idx_messages_recipient ON messages(recipient_id, sent_at DESC);
CREATE INDEX idx_messages_status ON messages(status);
CREATE INDEX idx_messages_conversation ON messages(sender_id, recipient_id, sent_at DESC);

-- 同步检查点表
CREATE TABLE sync_checkpoints (
  id SERIAL PRIMARY KEY,
  program_id VARCHAR(44) NOT NULL,
  program_name VARCHAR(64) NOT NULL,
  
  last_processed_slot BIGINT NOT NULL DEFAULT 0,
  last_processed_signature VARCHAR(88),
  
  total_events_processed BIGINT DEFAULT 0,
  last_event_timestamp TIMESTAMP,
  
  last_successful_sync TIMESTAMP DEFAULT NOW(),
  sync_errors_count INTEGER DEFAULT 0,
  
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  
  UNIQUE(program_id)
);

CREATE INDEX idx_sync_checkpoints_program ON sync_checkpoints(program_id);

-- Schema 迁移记录表
CREATE TABLE schema_migrations (
  version VARCHAR(16) PRIMARY KEY,
  description TEXT,
  applied_at TIMESTAMP DEFAULT NOW()
);

INSERT INTO schema_migrations (version, description) VALUES ('001', 'Initial schema');

COMMIT;
