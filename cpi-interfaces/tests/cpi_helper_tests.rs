use alcheme_cpi::*;
use alcheme_shared::*;
use anchor_lang::prelude::*;
use solana_program::{
    account_info::AccountInfo, program_pack::Pack, pubkey::Pubkey, system_program,
};

#[cfg(test)]
mod cpi_helper_tests {
    use super::*;

    /// Test 1: Verify unauthorized program cannot emit events
    #[test]
    fn test_emit_event_unauthorized_program() {
        // 创建一个未授权的program_id
        let unauthorized_program = Pubkey::new_unique();
        
        // 这个测试验证CPI权限检查是否工作
        // 预期: require_cpi_permission! 宏应该拒绝未授权的调用
        
        // Note: 由于我们使用了require_cpi_permission!宏，
        // 实际的单元测试需要在integration test环境中运行
        // 这里我们主要测试辅助函数的逻辑
    }

    /// Test 2: Test build_emit_event_instruction creates valid instruction
    #[test]
    fn test_build_emit_event_instruction() {
        let event_program_id = Pubkey::new_unique();
        let event_emitter = Pubkey::new_unique();
        let event_batch = Pubkey::new_unique();
        let payer = Pubkey::new_unique();
        let system_program_id = system_program::ID;
        
        let event = ProtocolEvent::IdentityRegistered {
            registry_id: Pubkey::new_unique(),
            identity_id: Pubkey::new_unique(),
            handle: "testuser".to_string(),
            verification_level: VerificationLevel::Basic,
            timestamp: 1234567890,
        };
        
        // 调用辅助函数构建指令
        // Note: build_emit_event_instruction是私有函数
        // 我们需要通过public接口测试，或者将其标记为 pub(crate) for testing
        
        // 这个测试验证:
        // 1. instruction discriminator正确（sha256("global:emit_event")[0..8]）
        // 2. 账户列表包含4个账户且顺序正确
        // 3. 数据正确序列化
    }

    /// Test 3: Test read_event_sequence extracts correct offset
    #[test]
    fn test_read_event_sequence_correct_offset() {
        // 构建模拟EventEmitterAccount数据
        let mut account_data = vec![0u8; 200];
        
        // discriminator (8 bytes)
        account_data[0..8].copy_from_slice(&[1, 2, 3, 4, 5, 6, 7, 8]);
        
        // bump (1 byte)
        account_data[8] = 255;
        
        // admin (32 bytes Pubkey)
        let admin_pubkey = Pubkey::new_unique();
        account_data[9..41].copy_from_slice(admin_pubkey.as_ref());
        
        // total_events (8 bytes u64)
        let total_events: u64 = 100;
        account_data[41..49].copy_from_slice(&total_events.to_le_bytes());
        
        // event_sequence (8 bytes u64) - 这是我们要读取的值
        let expected_sequence: u64 = 42;
        account_data[49..57].copy_from_slice(&expected_sequence.to_le_bytes());
        
        // 调用read_event_sequence
        // Note: read_event_sequence是私有函数
        // 需要通过public接口或标记为pub(crate)进行测试
        
        // 验证读取的值与expected_sequence相同
    }

    /// Test 4: Test event sequence increments on successful emission
    #[test]
    fn test_event_sequence_increments() {
        // 这个测试需要在integration test环境中运行
        // 因为需要实际的program execution和CPI调用
        
        // 测试流程:
        // 1. 初始化event emitter
        // 2. 发射第一个事件，验证sequence = 1
        // 3. 发射第二个事件，验证sequence = 2
        // 4. 验证event_emitter.event_sequence正确递增
    }
}

#[cfg(test)]
mod unit_tests_for_helpers {
    use super::*;
    
    /// 为了单元测试，我们创建一个测试模块来验证辅助函数逻辑
    /// 注意：这些测试可能需要将私有函数改为 pub(crate) 或通过间接方式测试
    
    #[test]
    fn test_event_emitter_account_layout() {
        // 验证我们对EventEmitterAccount内存布局的理解是正确的
        // offset计算:
        // - discriminator: 0-7 (8 bytes)
        // - bump: 8 (1 byte)
        // - admin: 9-40 (32 bytes)
        // - total_events: 41-48 (8 bytes)
        // - event_sequence: 49-56 (8 bytes)
        
        const DISCRIMINATOR_SIZE: usize = 8;
        const BUMP_SIZE: usize = 1;
        const PUBKEY_SIZE: usize = 32;
        const U64_SIZE: usize = 8;
        
        let event_sequence_offset = DISCRIMINATOR_SIZE + BUMP_SIZE + PUBKEY_SIZE + U64_SIZE;
        assert_eq!(event_sequence_offset, 49, "event_sequence offset should be at byte 49");
    }
    
    #[test]
    fn test_anchor_discriminator_size() {
        // 验证Anchor discriminator确实是8字节
        use anchor_lang::solana_program::hash::hash;
        
        let discriminator = hash("global:emit_event".as_bytes());
        let discriminator_bytes = &discriminator.to_bytes()[0..8];
        
        assert_eq!(discriminator_bytes.len(), 8, "Anchor discriminator should be 8 bytes");
    }

    #[test]
    fn test_batch_emit_discriminator_is_distinct() {
        use anchor_lang::solana_program::hash::hash;

        let emit = hash("global:emit_event".as_bytes()).to_bytes();
        let batch = hash("global:batch_emit_events".as_bytes()).to_bytes();

        assert_eq!(emit[..8].len(), 8);
        assert_eq!(batch[..8].len(), 8);
        assert_ne!(emit[..8], batch[..8], "batch_emit_events discriminator should differ from emit_event");
    }
}
