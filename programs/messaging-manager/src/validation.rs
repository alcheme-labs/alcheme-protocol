use anchor_lang::prelude::*;
use alcheme_shared::*;

/// 验证会话ID格式
pub fn _validate_conversation_id(conversation_id: &[u8; 32]) -> Result<()> {
    require!(
        conversation_id != &[0; 32],
        AlchemeError::InvalidOperation
    );
    Ok(())
}

/// 验证消息ID格式
pub fn _validate_message_id(message_id: &[u8; 32]) -> Result<()> {
    require!(
        message_id != &[0; 32],
        AlchemeError::InvalidOperation
    );
    Ok(())
}

/// 验证参与者列表
pub fn _validate_participants(participants: &[Pubkey], max_size: u32) -> Result<()> {
    require!(
        !participants.is_empty(),
        AlchemeError::InvalidOperation
    );
    
    require!(
        participants.len() <= max_size as usize,
        AlchemeError::InvalidOperation
    );
    
    // 检查重复
    let mut unique = participants.to_vec();
    unique.sort();
    unique.dedup();
    require!(
        unique.len() == participants.len(),
        AlchemeError::InvalidOperation
    );
    
    Ok(())
}

/// 验证存储URI
pub fn _validate_storage_uri(uri: &str) -> Result<()> {
    require!(
        !uri.is_empty() && uri.len() <= 256,
        AlchemeError::InvalidOperation
    );
    Ok(())
}

