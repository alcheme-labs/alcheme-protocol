use anchor_lang::prelude::*;
use alcheme_shared::{
    types::*, errors::*, constants::*, utils::*, validation::*,
    events::*, access::*, content::*, factory::*
};

pub mod instructions;
pub mod state;
pub mod validation;

pub use instructions::*;
pub use state::*;

declare_id!("4MZjksSnfSNa25ttV4smquKE6ggAmpZKjK74eDQLdoLx");

#[program]
pub mod messaging_manager {
    use super::*;

    /// 初始化消息管理器
    pub fn initialize(
        ctx: Context<Initialize>,
        settings: MessagingSettings,
    ) -> Result<()> {
        instructions::initialize(ctx, settings)
    }

    /// 创建会话
    pub fn create_conversation(
        ctx: Context<CreateConversation>,
        conversation_id: [u8; 32],
        conversation_type: ConversationType,
        participants: Vec<Pubkey>,
        metadata: ConversationMetadata,
    ) -> Result<()> {
        instructions::create_conversation(ctx, conversation_id, conversation_type, participants, metadata)
    }

    /// 发送消息元数据
    pub fn send_message(
        ctx: Context<SendMessage>,
        message_id: [u8; 32],
        message_hash: [u8; 32],
        message_type: MessageType,
        storage_uri: String,
        reply_to: Option<[u8; 32]>,
    ) -> Result<()> {
        instructions::send_message(ctx, message_id, message_hash, message_type, storage_uri, reply_to)
    }

    /// 标记消息已读
    pub fn mark_as_read(
        ctx: Context<MarkAsRead>,
        message_id: [u8; 32],
    ) -> Result<()> {
        instructions::mark_as_read(ctx, message_id)
    }

    /// 批量上链消息哈希
    pub fn batch_upload(
        ctx: Context<BatchUpload>,
        batch_id: u64,
        message_hashes: Vec<[u8; 32]>,
        merkle_root: [u8; 32],
    ) -> Result<()> {
        instructions::batch_upload(ctx, batch_id, message_hashes, merkle_root)
    }

    /// 更新在线状态
    pub fn update_presence(
        ctx: Context<UpdatePresence>,
        status: OnlineStatus,
        custom_status: Option<String>,
    ) -> Result<()> {
        instructions::update_presence(ctx, status, custom_status)
    }

    /// 撤回消息
    pub fn recall_message(
        ctx: Context<RecallMessage>,
        message_id: [u8; 32],
    ) -> Result<()> {
        instructions::recall_message(ctx, message_id)
    }
}

