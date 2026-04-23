use anchor_lang::prelude::*;
use alcheme_shared::*;

// ==================== 账户定义 ====================

/// 会话账户
#[account]
pub struct Conversation {
    pub conversation_id: [u8; 32],
    pub participants: Vec<Pubkey>,
    pub conversation_type: ConversationType,
    pub last_message_hash: [u8; 32],
    pub last_message_at: i64,
    pub message_count: u64,
    pub created_at: i64,
    pub created_by: Pubkey,
    pub metadata: ConversationMetadata,
    pub encryption_enabled: bool,
    pub bump: u8,
}

/// 消息元数据账户
#[account]
pub struct MessageMetadata {
    pub message_id: [u8; 32],
    pub message_hash: [u8; 32],
    pub sender: Pubkey,
    pub conversation_id: [u8; 32],
    pub timestamp: i64,
    pub message_type: MessageType,
    pub read_receipts: Vec<ReadReceipt>,
    pub status: MessageStatus,
    pub reply_to: Option<[u8; 32]>,
    pub storage_uri: String,
    pub bump: u8,
}

/// 消息批次账户
#[account]
pub struct MessageBatch {
    pub batch_id: u64,
    pub conversation_id: [u8; 32],
    pub message_hashes: Vec<[u8; 32]>,
    pub merkle_root: [u8; 32],
    pub start_time: i64,
    pub end_time: i64,
    pub message_count: u32,
    pub batch_status: MessageBatchStatus,
    pub bump: u8,
}

/// 用户消息统计账户
#[account]
pub struct UserMessageStats {
    pub user: Pubkey,
    pub total_sent: u64,
    pub total_received: u64,
    pub active_conversations: u64,
    pub unread_count: u64,
    pub last_active: i64,
    pub bump: u8,
}

/// 用户在线状态账户
#[account]
pub struct UserPresence {
    pub user: Pubkey,
    pub status: OnlineStatus,
    pub last_seen: i64,
    pub custom_status: Option<String>,
    pub bump: u8,
}

/// 消息管理器主账户
#[account]
pub struct MessagingManager {
    pub bump: u8,
    pub admin: Pubkey,
    pub created_at: i64,
    pub last_updated: i64,
    pub total_conversations: u64,
    pub total_messages: u64,
    pub active_users: u64,
    pub settings: MessagingSettings,
}

/// 消息管理器设置
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug, PartialEq)]
pub struct MessagingSettings {
    pub max_group_size: u32,
    pub max_message_size: u32,
    pub batch_interval_seconds: u32,
    pub batch_size: u32,
    pub enable_read_receipts: bool,
    pub enable_message_recall: bool,
    pub recall_time_limit: i64,          // 撤回时间限制（秒）
    pub enable_encryption: bool,
    pub require_identity_verification: bool,
}

// ==================== 实现 ====================

impl MessagingManager {
    pub const SPACE: usize = 
        8 +  // discriminator
        1 +  // bump
        32 + // admin
        8 +  // created_at
        8 +  // last_updated
        8 +  // total_conversations
        8 +  // total_messages
        8 +  // active_users
        MessagingSettings::SPACE;

    pub fn initialize(
        &mut self,
        bump: u8,
        admin: Pubkey,
        settings: MessagingSettings,
    ) -> Result<()> {
        self.bump = bump;
        self.admin = admin;
        self.created_at = Clock::get()?.unix_timestamp;
        self.last_updated = self.created_at;
        self.total_conversations = 0;
        self.total_messages = 0;
        self.active_users = 0;
        self.settings = settings;
        Ok(())
    }

    pub fn increment_conversation(&mut self) -> Result<()> {
        self.total_conversations = self.total_conversations.saturating_add(1);
        self.last_updated = Clock::get()?.unix_timestamp;
        Ok(())
    }

    pub fn increment_message(&mut self) -> Result<()> {
        self.total_messages = self.total_messages.saturating_add(1);
        self.last_updated = Clock::get()?.unix_timestamp;
        Ok(())
    }
}

impl MessagingSettings {
    pub const SPACE: usize = 
        4 +  // max_group_size
        4 +  // max_message_size
        4 +  // batch_interval_seconds
        4 +  // batch_size
        1 +  // enable_read_receipts
        1 +  // enable_message_recall
        8 +  // recall_time_limit
        1 +  // enable_encryption
        1;   // require_identity_verification
}

impl Default for MessagingSettings {
    fn default() -> Self {
        Self {
            max_group_size: 500,
            max_message_size: 10_000,        // 10KB
            batch_interval_seconds: 60,      // 每60秒批量上链
            batch_size: 100,                 // 每批100条消息
            enable_read_receipts: true,
            enable_message_recall: true,
            recall_time_limit: 120,          // 2分钟内可撤回
            enable_encryption: true,
            require_identity_verification: false,
        }
    }
}

impl Conversation {
    pub const SPACE: usize = 
        8 +  // discriminator
        32 + // conversation_id
        4 + 50 * 32 + // participants (减少到50人)
        1 +  // conversation_type
        32 + // last_message_hash
        8 +  // last_message_at
        8 +  // message_count
        8 +  // created_at
        32 + // created_by
        CONVERSATION_METADATA_SPACE +
        1 +  // encryption_enabled
        1;   // bump

    pub fn initialize(
        &mut self,
        conversation_id: [u8; 32],
        conversation_type: ConversationType,
        participants: Vec<Pubkey>,
        created_by: Pubkey,
        metadata: ConversationMetadata,
        bump: u8,
    ) -> Result<()> {
        require!(
            participants.len() <= metadata.settings.max_participants as usize,
            AlchemeError::InvalidOperation
        );

        self.conversation_id = conversation_id;
        self.participants = participants;
        self.conversation_type = conversation_type;
        self.last_message_hash = [0; 32];
        self.last_message_at = 0;
        self.message_count = 0;
        self.created_at = Clock::get()?.unix_timestamp;
        self.created_by = created_by;
        self.metadata = metadata;
        self.encryption_enabled = true;
        self.bump = bump;
        Ok(())
    }

    pub fn add_message(&mut self, message_hash: [u8; 32]) -> Result<()> {
        self.last_message_hash = message_hash;
        self.last_message_at = Clock::get()?.unix_timestamp;
        self.message_count = self.message_count.saturating_add(1);
        Ok(())
    }
}

const CONVERSATION_METADATA_SPACE: usize = 
    4 + 64 + 1 + // name
    4 + 256 + 1 + // description
    4 + 256 + 1 + // avatar_uri
    33 + // admin (Option<Pubkey>)
    CONVERSATION_SETTINGS_SPACE;

const CONVERSATION_SETTINGS_SPACE: usize = 
    1 +  // allow_new_members
    1 +  // require_approval
    4 +  // max_participants
    5;   // message_retention_days (Option<u32>)

impl MessageMetadata {
    pub const SPACE: usize = 
        8 +  // discriminator
        32 + // message_id
        32 + // message_hash
        32 + // sender
        32 + // conversation_id
        8 +  // timestamp
        1 +  // message_type
        4 + 50 * (32 + 8) + // read_receipts (最多50个)
        1 +  // status
        33 + // reply_to
        4 + 256 + // storage_uri
        1;   // bump

    pub fn initialize(
        &mut self,
        message_id: [u8; 32],
        message_hash: [u8; 32],
        sender: Pubkey,
        conversation_id: [u8; 32],
        message_type: MessageType,
        storage_uri: String,
        reply_to: Option<[u8; 32]>,
        bump: u8,
    ) -> Result<()> {
        self.message_id = message_id;
        self.message_hash = message_hash;
        self.sender = sender;
        self.conversation_id = conversation_id;
        self.timestamp = Clock::get()?.unix_timestamp;
        self.message_type = message_type;
        self.read_receipts = Vec::new();
        self.status = MessageStatus::Sent;
        self.reply_to = reply_to;
        self.storage_uri = storage_uri;
        self.bump = bump;
        Ok(())
    }

    pub fn mark_read(&mut self, reader: Pubkey) -> Result<()> {
        let receipt = ReadReceipt {
            reader,
            read_at: Clock::get()?.unix_timestamp,
        };
        
        if !self.read_receipts.iter().any(|r| r.reader == reader) {
            self.read_receipts.push(receipt);
        }

        if self.read_receipts.len() > 0 {
            self.status = MessageStatus::Read;
        }
        Ok(())
    }

    pub fn recall(&mut self) -> Result<()> {
        self.status = MessageStatus::Recalled;
        Ok(())
    }
}

impl MessageBatch {
    pub const SPACE: usize = 
        8 +  // discriminator
        8 +  // batch_id
        32 + // conversation_id
        4 + 100 * 32 + // message_hashes
        32 + // merkle_root
        8 +  // start_time
        8 +  // end_time
        4 +  // message_count
        1 +  // batch_status
        1;   // bump

    pub fn initialize(
        &mut self,
        batch_id: u64,
        conversation_id: [u8; 32],
        message_hashes: Vec<[u8; 32]>,
        merkle_root: [u8; 32],
        bump: u8,
    ) -> Result<()> {
        self.batch_id = batch_id;
        self.conversation_id = conversation_id;
        self.message_hashes = message_hashes.clone();
        self.merkle_root = merkle_root;
        self.start_time = Clock::get()?.unix_timestamp;
        self.end_time = self.start_time;
        self.message_count = message_hashes.len() as u32;
        self.batch_status = MessageBatchStatus::Sealed;
        self.bump = bump;
        Ok(())
    }
}

impl UserMessageStats {
    pub const SPACE: usize = 
        8 +  // discriminator
        32 + // user
        8 +  // total_sent
        8 +  // total_received
        8 +  // active_conversations
        8 +  // unread_count
        8 +  // last_active
        1;   // bump

    pub fn initialize(&mut self, user: Pubkey, bump: u8) -> Result<()> {
        self.user = user;
        self.total_sent = 0;
        self.total_received = 0;
        self.active_conversations = 0;
        self.unread_count = 0;
        self.last_active = Clock::get()?.unix_timestamp;
        self.bump = bump;
        Ok(())
    }
}

impl UserPresence {
    pub const SPACE: usize = 
        8 +  // discriminator
        32 + // user
        1 +  // status
        8 +  // last_seen
        4 + 128 + 1 + // custom_status
        1;   // bump

    pub fn initialize(&mut self, user: Pubkey, bump: u8) -> Result<()> {
        self.user = user;
        self.status = OnlineStatus::Online;
        self.last_seen = Clock::get()?.unix_timestamp;
        self.custom_status = None;
        self.bump = bump;
        Ok(())
    }

    pub fn update_status(&mut self, status: OnlineStatus, custom_status: Option<String>) -> Result<()> {
        self.status = status;
        self.last_seen = Clock::get()?.unix_timestamp;
        self.custom_status = custom_status;
        Ok(())
    }
}

