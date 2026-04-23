use anchor_lang::prelude::*;
use alcheme_shared::*;
use crate::state::*;

// External CPI interface
extern crate alcheme_cpi;

// ==================== Initialize ====================

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(
        init,
        payer = admin,
        space = MessagingManager::SPACE,
        seeds = [b"messaging_manager"],
        bump
    )]
    pub messaging_manager: Account<'info, MessagingManager>,
    
    #[account(mut)]
    pub admin: Signer<'info>,
    
    pub system_program: Program<'info, System>,
}

pub fn initialize(
    ctx: Context<Initialize>,
    settings: MessagingSettings,
) -> Result<()> {
    let messaging_manager = &mut ctx.accounts.messaging_manager;
    messaging_manager.initialize(
        ctx.bumps.messaging_manager,
        ctx.accounts.admin.key(),
        settings,
    )?;
    Ok(())
}

// ==================== Create Conversation ====================

#[derive(Accounts)]
#[instruction(conversation_id: [u8; 32])]
pub struct CreateConversation<'info> {
    #[account(
        init,
        payer = creator,
        space = Conversation::SPACE,
        seeds = [b"conversation", conversation_id.as_ref()],
        bump
    )]
    pub conversation: Account<'info, Conversation>,
    
    #[account(mut)]
    pub messaging_manager: Account<'info, MessagingManager>,
    
    #[account(mut)]
    pub creator: Signer<'info>,
    
    pub system_program: Program<'info, System>,
    
    /// CHECK: Event Emitter program
    pub event_program: AccountInfo<'info>,
    
    /// CHECK: Event Emitter account
    #[account(mut)]
    pub event_emitter: AccountInfo<'info>,
    
    /// CHECK: Event Batch account
    #[account(mut)]
    pub event_batch: AccountInfo<'info>,
}

pub fn create_conversation(
    ctx: Context<CreateConversation>,
    conversation_id: [u8; 32],
    conversation_type: ConversationType,
    participants: Vec<Pubkey>,
    metadata: ConversationMetadata,
) -> Result<()> {
    let conversation = &mut ctx.accounts.conversation;
    let messaging_manager = &mut ctx.accounts.messaging_manager;
    
    // Clone values before moving them
    let conversation_type_clone = conversation_type.clone();
    let participants_clone = participants.clone();
    
    conversation.initialize(
        conversation_id,
        conversation_type,
        participants,
        ctx.accounts.creator.key(),
        metadata,
        ctx.bumps.conversation,
    )?;
    
    messaging_manager.increment_conversation()?;
    
    // 发射事件
    let event = ProtocolEvent::ConversationCreated {
        conversation_id: conversation.key(),
        conversation_type: conversation_type_clone,
        creator: ctx.accounts.creator.key(),
        participants: participants_clone,
        timestamp: Clock::get()?.unix_timestamp,
    };
    
    alcheme_cpi::CpiHelper::emit_event_simple(
        &ctx.accounts.event_program,
        &mut ctx.accounts.event_emitter,
        &mut ctx.accounts.event_batch,
        &ctx.accounts.creator.to_account_info(),
        &ctx.accounts.system_program.to_account_info(),
        &crate::ID,
        event,
    )?;
    
    Ok(())
}

// ==================== Send Message ====================

#[derive(Accounts)]
#[instruction(message_id: [u8; 32])]
pub struct SendMessage<'info> {
    #[account(
        init,
        payer = sender,
        space = MessageMetadata::SPACE,
        seeds = [b"message", message_id.as_ref()],
        bump
    )]
    pub message: Account<'info, MessageMetadata>,
    
    #[account(mut)]
    pub conversation: Account<'info, Conversation>,
    
    #[account(mut)]
    pub messaging_manager: Account<'info, MessagingManager>,
    
    #[account(mut)]
    pub sender: Signer<'info>,
    
    pub system_program: Program<'info, System>,
    
    /// CHECK: Event Emitter program
    pub event_program: AccountInfo<'info>,
    
    /// CHECK: Event Emitter account
    #[account(mut)]
    pub event_emitter: AccountInfo<'info>,
    
    /// CHECK: Event Batch account
    #[account(mut)]
    pub event_batch: AccountInfo<'info>,
}

pub fn send_message(
    ctx: Context<SendMessage>,
    message_id: [u8; 32],
    message_hash: [u8; 32],
    message_type: MessageType,
    storage_uri: String,
    reply_to: Option<[u8; 32]>,
) -> Result<()> {
    let message = &mut ctx.accounts.message;
    let conversation = &mut ctx.accounts.conversation;
    let messaging_manager = &mut ctx.accounts.messaging_manager;
    
    // 验证发送者在会话中
    require!(
        conversation.participants.contains(&ctx.accounts.sender.key()),
        AlchemeError::InvalidOperation
    );
    
    // Clone before moving
    let message_type_clone = message_type.clone();
    
    message.initialize(
        message_id,
        message_hash,
        ctx.accounts.sender.key(),
        conversation.conversation_id,
        message_type,
        storage_uri,
        reply_to,
        ctx.bumps.message,
    )?;
    
    conversation.add_message(message_hash)?;
    messaging_manager.increment_message()?;
    
    // 发射事件
    let event = ProtocolEvent::MessageSent {
        message_id: message.key(),
        conversation_id: conversation.key(),
        sender: ctx.accounts.sender.key(),
        message_type: message_type_clone,
        reply_to: reply_to.map(|id| Pubkey::new_from_array(id)),
        timestamp: Clock::get()?.unix_timestamp,
    };
    
    alcheme_cpi::CpiHelper::emit_event_simple(
        &ctx.accounts.event_program,
        &mut ctx.accounts.event_emitter,
        &mut ctx.accounts.event_batch,
        &ctx.accounts.sender.to_account_info(),
        &ctx.accounts.system_program.to_account_info(),
        &crate::ID,
        event,
    )?;
    
    Ok(())
}

// ==================== Mark As Read ====================

#[derive(Accounts)]
#[instruction(message_id: [u8; 32])]
pub struct MarkAsRead<'info> {
    #[account(mut)]
    pub message: Account<'info, MessageMetadata>,
    
    #[account()]
    pub conversation: Account<'info, Conversation>,
    
    #[account(mut)]
    pub reader: Signer<'info>,
    
    pub system_program: Program<'info, System>,
    
    /// CHECK: Event Emitter program
    pub event_program: AccountInfo<'info>,
    
    /// CHECK: Event Emitter account
    #[account(mut)]
    pub event_emitter: AccountInfo<'info>,
    
    /// CHECK: Event Batch account
    #[account(mut)]
    pub event_batch: AccountInfo<'info>,
}

pub fn mark_as_read(
    ctx: Context<MarkAsRead>,
    _message_id: [u8; 32],
) -> Result<()> {
    let message = &mut ctx.accounts.message;
    let conversation = &ctx.accounts.conversation;
    
    // 验证读者在会话中
    require!(
        conversation.participants.contains(&ctx.accounts.reader.key()),
        AlchemeError::InvalidOperation
    );
    
    message.mark_read(ctx.accounts.reader.key())?;
    
    // 发射事件
    let event = ProtocolEvent::MessageRead {
        message_id: message.key(),
        reader: ctx.accounts.reader.key(),
        timestamp: Clock::get()?.unix_timestamp,
    };
    
    alcheme_cpi::CpiHelper::emit_event_simple(
        &ctx.accounts.event_program,
        &mut ctx.accounts.event_emitter,
        &mut ctx.accounts.event_batch,
        &ctx.accounts.reader.to_account_info(),
        &ctx.accounts.system_program.to_account_info(),
        &crate::ID,
        event,
    )?;
    
    Ok(())
}

// ==================== Batch Upload ====================

#[derive(Accounts)]
#[instruction(batch_id: u64)]
pub struct BatchUpload<'info> {
    #[account(
        init,
        payer = uploader,
        space = MessageBatch::SPACE,
        seeds = [b"batch", batch_id.to_le_bytes().as_ref()],
        bump
    )]
    pub batch: Account<'info, MessageBatch>,
    
    #[account()]
    pub conversation: Account<'info, Conversation>,
    
    #[account(mut)]
    pub uploader: Signer<'info>,
    
    pub system_program: Program<'info, System>,
}

pub fn batch_upload(
    ctx: Context<BatchUpload>,
    batch_id: u64,
    message_hashes: Vec<[u8; 32]>,
    merkle_root: [u8; 32],
) -> Result<()> {
    let batch = &mut ctx.accounts.batch;
    let conversation = &ctx.accounts.conversation;
    
    batch.initialize(
        batch_id,
        conversation.conversation_id,
        message_hashes,
        merkle_root,
        ctx.bumps.batch,
    )?;
    
    Ok(())
}

// ==================== Update Presence ====================

#[derive(Accounts)]
pub struct UpdatePresence<'info> {
    #[account(
        init_if_needed,
        payer = user,
        space = UserPresence::SPACE,
        seeds = [b"presence", user.key().as_ref()],
        bump
    )]
    pub presence: Account<'info, UserPresence>,
    
    #[account(mut)]
    pub user: Signer<'info>,
    
    pub system_program: Program<'info, System>,
    
    /// CHECK: Event Emitter program
    pub event_program: AccountInfo<'info>,
    
    /// CHECK: Event Emitter account
    #[account(mut)]
    pub event_emitter: AccountInfo<'info>,
    
    /// CHECK: Event Batch account
    #[account(mut)]
    pub event_batch: AccountInfo<'info>,
}

pub fn update_presence(
    ctx: Context<UpdatePresence>,
    status: OnlineStatus,
    custom_status: Option<String>,
) -> Result<()> {
    let presence = &mut ctx.accounts.presence;
    
    // 只在第一次初始化时设置 user 和 bump
    if presence.user == Pubkey::default() {
        presence.initialize(ctx.accounts.user.key(), ctx.bumps.presence)?;
    }
    
    // Clone before moving
    let status_clone = status.clone();
    
    presence.update_status(status, custom_status.clone())?;
    
    // 发射事件
    let event = ProtocolEvent::PresenceUpdated {
        user_id: ctx.accounts.user.key(),
        status: match status_clone {
            OnlineStatus::Online => "online".to_string(),
            OnlineStatus::Away => "away".to_string(),
            OnlineStatus::Busy => "busy".to_string(),
            OnlineStatus::Offline => "offline".to_string(),
            OnlineStatus::Invisible => "invisible".to_string(),
        },
        custom_status,
        timestamp: Clock::get()?.unix_timestamp,
    };
    
    alcheme_cpi::CpiHelper::emit_event_simple(
        &ctx.accounts.event_program,
        &mut ctx.accounts.event_emitter,
        &mut ctx.accounts.event_batch,
        &ctx.accounts.user.to_account_info(),
        &ctx.accounts.system_program.to_account_info(),
        &crate::ID,
        event,
    )?;
    
    Ok(())
}

// ==================== Recall Message ====================

#[derive(Accounts)]
#[instruction(message_id: [u8; 32])]
pub struct RecallMessage<'info> {
    #[account(
        mut,
        seeds = [b"message", message_id.as_ref()],
        bump = message.bump,
        constraint = message.sender == sender.key() @ AlchemeError::InvalidOperation
    )]
    pub message: Account<'info, MessageMetadata>,
    
    #[account()]
    pub messaging_manager: Account<'info, MessagingManager>,
    
    #[account(mut)]
    pub sender: Signer<'info>,
    
    pub system_program: Program<'info, System>,
    
    /// CHECK: Event Emitter program
    pub event_program: AccountInfo<'info>,
    
    /// CHECK: Event Emitter account
    #[account(mut)]
    pub event_emitter: AccountInfo<'info>,
    
    /// CHECK: Event Batch account
    #[account(mut)]
    pub event_batch: AccountInfo<'info>,
}

pub fn recall_message(
    ctx: Context<RecallMessage>,
    _message_id: [u8; 32],
) -> Result<()> {
    let message = &mut ctx.accounts.message;
    let messaging_manager = &ctx.accounts.messaging_manager;
    
    // 检查是否启用撤回功能
    require!(
        messaging_manager.settings.enable_message_recall,
        AlchemeError::InvalidOperation
    );
    
    // 检查是否在撤回时间限制内
    let current_time = Clock::get()?.unix_timestamp;
    let time_elapsed = current_time - message.timestamp;
    require!(
        time_elapsed <= messaging_manager.settings.recall_time_limit,
        AlchemeError::InvalidOperation
    );
    
    message.recall()?;
    
    // 发射事件
    let event = ProtocolEvent::MessageRecalled {
        message_id: message.key(),
        sender: ctx.accounts.sender.key(),
        timestamp: Clock::get()?.unix_timestamp,
    };
    
    alcheme_cpi::CpiHelper::emit_event_simple(
        &ctx.accounts.event_program,
        &mut ctx.accounts.event_emitter,
        &mut ctx.accounts.event_batch,
        &ctx.accounts.sender.to_account_info(),
        &ctx.accounts.system_program.to_account_info(),
        &crate::ID,
        event,
    )?;
    
    Ok(())
}

