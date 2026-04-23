use anchor_lang::prelude::*;
use crate::{constants::*, errors::AlchemeError};

/// PDA 生成工具函数
pub struct PdaUtils;

impl PdaUtils {
    /// 生成身份注册表 PDA
    pub fn get_identity_registry_pda(
        registry_name: &str,
        program_id: &Pubkey,
    ) -> (Pubkey, u8) {
        Pubkey::find_program_address(
            &[IDENTITY_REGISTRY_SEED, registry_name.as_bytes()],
            program_id,
        )
    }

    /// 生成用户身份 PDA
    pub fn get_user_identity_pda(
        registry: &Pubkey,
        handle: &str,
        program_id: &Pubkey,
    ) -> (Pubkey, u8) {
        Pubkey::find_program_address(
            &[USER_IDENTITY_SEED, registry.as_ref(), handle.as_bytes()],
            program_id,
        )
    }

    /// 生成用户名映射 PDA
    pub fn get_handle_mapping_pda(
        handle: &str,
        program_id: &Pubkey,
    ) -> (Pubkey, u8) {
        Pubkey::find_program_address(
            &[HANDLE_MAPPING_SEED, handle.as_bytes()],
            program_id,
        )
    }

    /// 生成内容 PDA
    pub fn get_content_pda(
        author: &Pubkey,
        content_id: u64,
        program_id: &Pubkey,
    ) -> (Pubkey, u8) {
        Pubkey::find_program_address(
            &[CONTENT_POST_SEED, author.as_ref(), &content_id.to_le_bytes()],
            program_id,
        )
    }

    /// 生成访问规则 PDA
    pub fn get_access_rule_pda(
        user: &Pubkey,
        permission_hash: &[u8],
        program_id: &Pubkey,
    ) -> (Pubkey, u8) {
        Pubkey::find_program_address(
            &[ACCESS_RULE_SEED, user.as_ref(), permission_hash],
            program_id,
        )
    }

    /// 生成事件批次 PDA
    pub fn get_event_batch_pda(
        batch_id: u64,
        program_id: &Pubkey,
    ) -> (Pubkey, u8) {
        Pubkey::find_program_address(
            &[EVENT_BATCH_SEED, &batch_id.to_le_bytes()],
            program_id,
        )
    }
}

/// 验证工具函数
pub struct ValidationUtils;

impl ValidationUtils {
    /// 验证用户名格式
    pub fn validate_handle(handle: &str) -> Result<()> {
        if handle.len() < MIN_HANDLE_LENGTH || handle.len() > MAX_HANDLE_LENGTH {
            return Err(AlchemeError::InvalidHandleLength.into());
        }

        if !handle.chars().all(|c| c.is_alphanumeric() || c == '_') {
            return Err(AlchemeError::InvalidHandleCharacters.into());
        }

        // 不能以数字开头
        if handle.chars().next().unwrap().is_ascii_digit() {
            return Err(AlchemeError::InvalidHandleCharacters.into());
        }

        // 不能以下划线开头或结尾
        if handle.starts_with('_') || handle.ends_with('_') {
            return Err(AlchemeError::InvalidHandleCharacters.into());
        }

        // 不能包含连续的下划线
        if handle.contains("__") {
            return Err(AlchemeError::InvalidHandleCharacters.into());
        }

        Ok(())
    }

    /// 验证字符串长度
    pub fn validate_string_length(s: &str, max_length: usize, error: AlchemeError) -> Result<()> {
        if s.len() > max_length {
            return Err(error.into());
        }
        Ok(())
    }

    /// 验证 URL 格式
    pub fn validate_url(url: &str) -> Result<()> {
        if url.is_empty() {
            return Ok(());
        }

        if url.len() > MAX_URL_LENGTH {
            return Err(AlchemeError::InvalidOperation.into());
        }

        // 简单的 URL 格式验证
        if !url.starts_with("http://") && !url.starts_with("https://") {
            return Err(AlchemeError::InvalidOperation.into());
        }

        Ok(())
    }

    /// 验证声誉分数
    pub fn validate_reputation_score(score: f64) -> Result<()> {
        if score < MIN_REPUTATION_SCORE || score > MAX_REPUTATION_SCORE {
            return Err(AlchemeError::InvalidReputationScore.into());
        }
        Ok(())
    }

    /// 验证时间戳
    pub fn validate_timestamp(timestamp: i64) -> Result<()> {
        let current_time = Clock::get()?.unix_timestamp;
        
        // 不能是未来时间（允许5分钟的时钟偏差）
        if timestamp > current_time + 300 {
            return Err(AlchemeError::InvalidTimestamp.into());
        }

        // 不能太老（超过1年）
        if timestamp < current_time - (365 * 24 * 3600) {
            return Err(AlchemeError::InvalidTimestamp.into());
        }

        Ok(())
    }
}

/// 数学工具函数
pub struct MathUtils;

impl MathUtils {
    /// 安全的加法，防止溢出
    pub fn safe_add_u64(a: u64, b: u64) -> Result<u64> {
        a.checked_add(b)
            .ok_or(AlchemeError::MathOverflow.into())
    }

    /// 安全的减法，防止溢出
    pub fn safe_sub_u64(a: u64, b: u64) -> Result<u64> {
        a.checked_sub(b)
            .ok_or(AlchemeError::MathOverflow.into())
    }

    /// 安全的乘法，防止溢出
    pub fn safe_mul_u64(a: u64, b: u64) -> Result<u64> {
        a.checked_mul(b)
            .ok_or(AlchemeError::MathOverflow.into())
    }

    /// 安全的除法，防止除零
    pub fn safe_div_u64(a: u64, b: u64) -> Result<u64> {
        if b == 0 {
            return Err(AlchemeError::MathOverflow.into());
        }
        Ok(a / b)
    }

    /// 计算百分比
    pub fn calculate_percentage(value: u64, total: u64) -> Result<f64> {
        if total == 0 {
            return Ok(0.0);
        }
        Ok((value as f64 / total as f64) * 100.0)
    }

    /// 声誉分数衰减计算
    pub fn calculate_reputation_decay(
        current_score: f64,
        days_inactive: i64,
    ) -> Result<f64> {
        let decay_factor = 1.0 - (REPUTATION_DECAY_RATE * days_inactive as f64);
        let new_score = current_score * decay_factor.max(0.0);
        Ok(new_score.max(MIN_REPUTATION_SCORE))
    }
}

/// 存储工具函数
pub struct StorageUtils;

impl StorageUtils {
    /// 计算账户大小
    pub fn calculate_account_size<T>() -> usize {
        ACCOUNT_DISCRIMINATOR_SIZE + std::mem::size_of::<T>()
    }

    /// 计算动态字符串账户大小
    pub fn calculate_string_account_size(base_size: usize, string_length: usize) -> usize {
        base_size + 4 + string_length // 4 bytes for length prefix
    }

    /// 计算向量账户大小
    pub fn calculate_vec_account_size<T>(base_size: usize, vec_length: usize) -> usize {
        base_size + 4 + (vec_length * std::mem::size_of::<T>()) // 4 bytes for length prefix
    }

    /// 计算存储费用
    pub fn calculate_storage_cost(data_size: u64, storage_strategy: &crate::StorageStrategy) -> u64 {
        match storage_strategy {
            crate::StorageStrategy::OnChain => data_size * 1000, // Higher cost for on-chain
            crate::StorageStrategy::Arweave => data_size * 100,  // Medium cost for Arweave
            crate::StorageStrategy::IPFS => data_size * 10,      // Lower cost for IPFS
            crate::StorageStrategy::Hybrid => data_size * 50,    // Balanced cost
            crate::StorageStrategy::Custom(_) => data_size * 25,  // Custom strategy
        }
    }

    /// 选择最佳存储策略
    pub fn select_storage_strategy(data_size: u64) -> crate::StorageStrategy {
        if data_size <= ON_CHAIN_STORAGE_THRESHOLD as u64 {
            crate::StorageStrategy::OnChain
        } else if data_size <= IPFS_STORAGE_THRESHOLD {
            crate::StorageStrategy::IPFS
        } else if data_size <= ARWEAVE_STORAGE_THRESHOLD {
            crate::StorageStrategy::Arweave
        } else {
            crate::StorageStrategy::Hybrid
        }
    }
}

/// 时间工具函数
pub struct TimeUtils;

impl TimeUtils {
    /// 获取当前时间戳
    pub fn current_timestamp() -> Result<i64> {
        Ok(Clock::get()?.unix_timestamp)
    }

    /// 检查是否过期
    pub fn is_expired(expiry_timestamp: Option<i64>) -> Result<bool> {
        match expiry_timestamp {
            Some(expiry) => Ok(Clock::get()?.unix_timestamp > expiry),
            None => Ok(false),
        }
    }

    /// 计算天数差
    pub fn days_between(timestamp1: i64, timestamp2: i64) -> i64 {
        (timestamp2 - timestamp1).abs() / SECONDS_PER_DAY
    }

    /// 添加天数到时间戳
    pub fn add_days(timestamp: i64, days: i64) -> i64 {
        timestamp + (days * SECONDS_PER_DAY)
    }

    /// 检查时间窗口
    pub fn is_within_time_window(
        timestamp: i64,
        window_start: i64,
        window_end: i64,
    ) -> bool {
        timestamp >= window_start && timestamp <= window_end
    }
}

/// 权限工具函数
pub struct PermissionUtils;

impl PermissionUtils {
    /// 检查账户所有权
    pub fn verify_account_ownership(
        account: &AccountInfo,
        expected_owner: &Pubkey,
    ) -> Result<()> {
        if account.owner != expected_owner {
            return Err(AlchemeError::InvalidAccountOwner.into());
        }
        Ok(())
    }

    /// 检查签名
    pub fn verify_signer(account: &AccountInfo) -> Result<()> {
        if !account.is_signer {
            return Err(AlchemeError::MissingSignature.into());
        }
        Ok(())
    }

    /// 检查租金豁免
    pub fn verify_rent_exempt(account: &AccountInfo, rent: &Rent) -> Result<()> {
        if !rent.is_exempt(account.lamports(), account.data_len()) {
            return Err(AlchemeError::NotRentExempt.into());
        }
        Ok(())
    }

    /// 检查程序权限
    pub fn verify_program_authority(
        authority: &AccountInfo,
        expected_seeds: &[&[u8]],
        program_id: &Pubkey,
    ) -> Result<u8> {
        let (expected_authority, bump) = 
            Pubkey::find_program_address(expected_seeds, program_id);
        
        if authority.key() != expected_authority {
            return Err(AlchemeError::Unauthorized.into());
        }
        
        Ok(bump)
    }
}

/// 哈希工具函数
pub struct HashUtils;

impl HashUtils {
    /// 计算权限哈希
    pub fn hash_permission(permission: &crate::Permission) -> Result<[u8; 32]> {
        use solana_program::hash::hash;
        
        let serialized = permission.try_to_vec()
            .map_err(|_| AlchemeError::SerializationError)?;
        
        let hash_result = hash(&serialized);
        Ok(hash_result.to_bytes())
    }

    /// 计算内容哈希
    pub fn hash_content_data(data: &[u8]) -> [u8; 32] {
        use solana_program::hash::hash;
        hash(data).to_bytes()
    }

    /// 生成随机种子
    pub fn generate_seed(base: &str, timestamp: i64) -> Vec<u8> {
        let mut seed = base.as_bytes().to_vec();
        seed.extend_from_slice(&timestamp.to_le_bytes());
        seed
    }
}
