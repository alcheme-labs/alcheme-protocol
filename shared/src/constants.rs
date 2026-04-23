/// Alcheme Protocol 共享常量定义

// ==================== 通用常量 ====================

/// 协议版本
pub const PROTOCOL_VERSION: &str = "1.0.0";

/// 最大字符串长度
pub const MAX_STRING_LENGTH: usize = 256;
pub const MAX_TEXT_LENGTH: usize = 2048;
pub const MAX_BIO_LENGTH: usize = 512;
pub const MAX_URL_LENGTH: usize = 512;

/// 数组大小限制
pub const MAX_TAGS_COUNT: usize = 10;
pub const MAX_MEDIA_ATTACHMENTS: usize = 5;
pub const MAX_CUSTOM_FIELDS: usize = 20;
pub const MAX_BATCH_SIZE: usize = 50;

// ==================== 身份注册表常量 ====================

/// PDA 种子
pub const IDENTITY_REGISTRY_SEED: &[u8] = b"identity_registry";
pub const USER_IDENTITY_SEED: &[u8] = b"user_identity";
pub const HANDLE_MAPPING_SEED: &[u8] = b"handle_mapping";

/// 用户名规则
pub const MIN_HANDLE_LENGTH: usize = 3;
pub const MAX_HANDLE_LENGTH: usize = 32;
pub const HANDLE_REGEX: &str = r"^[a-zA-Z0-9_]+$";

/// 声誉系统
pub const MIN_REPUTATION_SCORE: f64 = 0.0;
pub const MAX_REPUTATION_SCORE: f64 = 100.0;
pub const DEFAULT_REPUTATION_SCORE: f64 = 50.0;
pub const REPUTATION_DECAY_RATE: f64 = 0.01;

/// 档案数据限制
pub const MAX_PROFILE_FIELDS: usize = 50;
pub const MAX_VERIFICATION_ATTRIBUTES: usize = 10;

/// 费用结构 (lamports)
pub const IDENTITY_REGISTRATION_FEE: u64 = 1_000_000; // 0.001 SOL
pub const HANDLE_TRANSFER_FEE: u64 = 5_000_000; // 0.005 SOL
pub const VERIFICATION_FEE: u64 = 10_000_000; // 0.01 SOL

// ==================== 内容管理器常量 ====================

/// PDA 种子
pub const CONTENT_MANAGER_SEED: &[u8] = b"content_manager";
pub const CONTENT_POST_SEED: &[u8] = b"content_post";
pub const CONTENT_V2_ANCHOR_SEED: &[u8] = b"content_v2_anchor";

/// 内容限制
pub const MAX_CONTENT_SIZE: usize = 10_240; // 10KB
pub const MAX_MEDIA_FILE_SIZE: u64 = 100_000_000; // 100MB
pub const MAX_CONTENT_TITLE_LENGTH: usize = 128;
pub const MAX_CONTENT_DESCRIPTION_LENGTH: usize = 512;

/// 存储阈值
pub const ON_CHAIN_STORAGE_THRESHOLD: usize = 1_024; // 1KB
pub const ARWEAVE_STORAGE_THRESHOLD: u64 = 10_000_000; // 10MB
pub const IPFS_STORAGE_THRESHOLD: u64 = 1_000_000; // 1MB

/// 互动统计
pub const MAX_INTERACTION_HISTORY: usize = 1000;
pub const INTERACTION_COOLDOWN_SECONDS: i64 = 1;

/// 内容费用 (lamports)
pub const CONTENT_CREATION_FEE: u64 = 100_000; // 0.0001 SOL
pub const MEDIA_STORAGE_FEE_PER_MB: u64 = 1_000_000; // 0.001 SOL per MB

// ==================== 访问控制器常量 ====================

/// PDA 种子
pub const ACCESS_CONTROLLER_SEED: &[u8] = b"access_controller";
pub const ACCESS_RULE_SEED: &[u8] = b"access_rule";
pub const PERMISSION_TEMPLATE_SEED: &[u8] = b"permission_template";
pub const FOLLOW_RELATIONSHIP_SEED: &[u8] = b"follow";

/// 规则限制
pub const MAX_ACCESS_RULES_PER_USER: usize = 100;
pub const MAX_RULE_CONDITIONS: usize = 10;
pub const MAX_PERMISSION_TEMPLATES: usize = 50;
pub const MAX_RELATIONSHIP_MAPPINGS: usize = 1000;

/// 权限检查
pub const PERMISSION_CHECK_TIMEOUT_SECONDS: i64 = 30;
pub const MAX_BATCH_PERMISSION_CHECKS: usize = 20;

/// 审计配置
pub const MAX_AUDIT_LOG_ENTRIES: usize = 10000;
pub const AUDIT_LOG_RETENTION_DAYS: i64 = 90;

// ==================== 圈层管理器常量 ====================

/// PDA 种子
pub const CIRCLE_MEMBER_SEED: &[u8] = b"circle_member";

// ==================== 事件系统常量 ====================

/// PDA 种子
pub const EVENT_EMITTER_SEED: &[u8] = b"event_emitter";
pub const EVENT_BATCH_SEED: &[u8] = b"event_batch";
pub const EVENT_SUBSCRIPTION_SEED: &[u8] = b"event_subscription";

/// 事件批次配置
pub const MAX_EVENTS_PER_BATCH: usize = 50;
pub const EVENT_BATCH_TIMEOUT_SECONDS: i64 = 300; // 5 minutes
pub const MAX_EVENT_DATA_SIZE: usize = 1024;

/// 事件存储配置
pub const CHAIN_EVENT_RETENTION_DAYS: i64 = 30;
pub const MAX_CHAIN_EVENTS: u64 = 100_000;
pub const EVENT_COMPRESSION_THRESHOLD: usize = 512;

/// 事件订阅
pub const MAX_SUBSCRIPTIONS_PER_USER: usize = 100;
pub const MAX_EVENT_FILTERS: usize = 10;
pub const SUBSCRIPTION_RENEWAL_DAYS: i64 = 30;

// ==================== 工厂部署常量 ====================

/// PDA 种子
pub const REGISTRY_FACTORY_SEED: &[u8] = b"registry_factory";
pub const DEPLOYED_REGISTRY_SEED: &[u8] = b"deployed_registry";

/// 部署限制
pub const MAX_DEPLOYMENTS_PER_AUTHORITY: usize = 10;
pub const DEPLOYMENT_COOLDOWN_HOURS: i64 = 24;
pub const MAX_REGISTRY_NAME_LENGTH: usize = 64;

/// 部署费用 (lamports)
pub const REGISTRY_DEPLOYMENT_FEE: u64 = 100_000_000; // 0.1 SOL
pub const REGISTRY_UPGRADE_FEE: u64 = 50_000_000; // 0.05 SOL

// ==================== 验证系统常量 ====================

/// 验证配置
pub const MAX_VALIDATORS_PER_OPERATION: usize = 10;
pub const VALIDATION_TIMEOUT_SECONDS: i64 = 60;
pub const MAX_VALIDATION_CONTEXT_SIZE: usize = 2048;

/// 验证器类型
pub const REQUIRED_VALIDATOR_WEIGHT: u32 = 100;
pub const OPTIONAL_VALIDATOR_WEIGHT: u32 = 50;
pub const SCORING_VALIDATOR_WEIGHT: u32 = 25;

/// 验证结果
pub const MIN_VALIDATION_SCORE: f64 = 0.0;
pub const MAX_VALIDATION_SCORE: f64 = 100.0;
pub const VALIDATION_PASS_THRESHOLD: f64 = 70.0;

// ==================== CPI 权限常量 ====================

/// CPI 权限配置
pub const MAX_AUTHORIZED_CALLERS: usize = 20;
pub const CPI_RATE_LIMIT_PER_MINUTE: u32 = 100;
pub const CPI_CALL_TIMEOUT_SECONDS: i64 = 30;

// ==================== 计算和费用常量 ====================

/// 计算单元限制
pub const DEFAULT_COMPUTE_UNITS: u32 = 200_000;
pub const IDENTITY_COMPUTE_UNITS: u32 = 150_000;
pub const CONTENT_COMPUTE_UNITS: u32 = 250_000;
pub const ACCESS_COMPUTE_UNITS: u32 = 100_000;
pub const EVENT_COMPUTE_UNITS: u32 = 80_000;
pub const FACTORY_COMPUTE_UNITS: u32 = 300_000;

/// 租金计算
pub const ACCOUNT_DISCRIMINATOR_SIZE: usize = 8;
pub const PUBKEY_SIZE: usize = 32;
pub const U64_SIZE: usize = 8;
pub const I64_SIZE: usize = 8;
pub const F64_SIZE: usize = 8;
pub const BOOL_SIZE: usize = 1;

// ==================== 时间常量 ====================

/// 时间相关常量
pub const SECONDS_PER_DAY: i64 = 86_400;
pub const SECONDS_PER_HOUR: i64 = 3_600;
pub const SECONDS_PER_MINUTE: i64 = 60;

/// 过期时间
pub const DEFAULT_CONTENT_EXPIRY_DAYS: i64 = 365; // 1 year
pub const MAX_CONTENT_EXPIRY_DAYS: i64 = 3650; // 10 years
pub const SESSION_TIMEOUT_MINUTES: i64 = 30;

// ==================== 网络和性能常量 ====================

/// 网络配置
pub const MAX_CONCURRENT_OPERATIONS: usize = 10;
pub const RETRY_ATTEMPTS: u32 = 3;
pub const RETRY_DELAY_MS: u64 = 1000;

/// 缓存配置
pub const CACHE_TTL_SECONDS: i64 = 300; // 5 minutes
pub const MAX_CACHE_ENTRIES: usize = 1000;

// ==================== 安全常量 ====================

/// 安全配置
pub const MAX_LOGIN_ATTEMPTS: u32 = 5;
pub const ACCOUNT_LOCKOUT_MINUTES: i64 = 15;
pub const TOKEN_EXPIRY_HOURS: i64 = 24;

/// 加密配置
pub const HASH_SALT_LENGTH: usize = 32;
pub const ENCRYPTION_KEY_LENGTH: usize = 32;
pub const SIGNATURE_LENGTH: usize = 64;
