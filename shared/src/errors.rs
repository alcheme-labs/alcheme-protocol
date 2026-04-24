use anchor_lang::prelude::*;

/// Alcheme Protocol 统一错误代码
#[error_code]
pub enum AlchemeError {
    // 通用错误 (6000-6099)
    #[msg("Invalid operation")]
    InvalidOperation = 6000,
    #[msg("Unauthorized")]
    Unauthorized = 6001,
    #[msg("Account not found")]
    AccountNotFound = 6002,
    #[msg("Invalid account owner")]
    InvalidAccountOwner = 6003,
    #[msg("Missing required signature")]
    MissingSignature = 6004,
    #[msg("Account is not rent exempt")]
    NotRentExempt = 6005,
    #[msg("Data serialization failed")]
    SerializationError = 6006,
    #[msg("Data deserialization failed")]
    DeserializationError = 6007,
    #[msg("Math overflow")]
    MathOverflow = 6008,
    #[msg("Invalid timestamp")]
    InvalidTimestamp = 6009,
    #[msg("Unauthorized CPI call")]
    UnauthorizedCpiCall = 6010,
    #[msg("Invalid program ID")]
    InvalidProgramId = 6011,
    #[msg("Signer required")]
    SignerRequired = 6012,
    #[msg("Invalid account data")]
    InvalidAccountData = 6013,
    #[msg("Circle is archived")]
    CircleArchived = 6014,
    #[msg("Circle is already archived")]
    CircleAlreadyArchived = 6015,
    #[msg("Circle is not archived")]
    CircleNotArchived = 6016,

    // 身份相关错误 (6100-6199)
    #[msg("Invalid handle length")]
    InvalidHandleLength = 6100,
    #[msg("Handle contains invalid characters")]
    InvalidHandleCharacters = 6101,
    #[msg("Handle already exists")]
    HandleAlreadyExists = 6102,
    #[msg("Identity not found")]
    IdentityNotFound = 6103,
    #[msg("Identity already exists")]
    IdentityAlreadyExists = 6104,
    #[msg("Invalid identity config")]
    InvalidIdentityConfig = 6105,
    #[msg("Identity verification failed")]
    IdentityVerificationFailed = 6106,
    #[msg("Profile data too large")]
    ProfileDataTooLarge = 6107,
    #[msg("Invalid verification level")]
    InvalidVerificationLevel = 6108,
    #[msg("Invalid reputation score")]
    InvalidReputationScore = 6109,

    // 内容相关错误 (6200-6299)
    #[msg("Content not found")]
    ContentNotFound = 6200,
    #[msg("Content already exists")]
    ContentAlreadyExists = 6201,
    #[msg("Text content too long")]
    TextTooLong = 6202,
    #[msg("Invalid content type")]
    InvalidContentType = 6203,
    #[msg("Media attachment too large")]
    MediaAttachmentTooLarge = 6204,
    #[msg("Missing media attachment")]
    MissingMediaAttachment = 6205,
    #[msg("Invalid storage strategy")]
    InvalidStorageStrategy = 6206,
    #[msg("Insufficient storage fee")]
    InsufficientStorageFee = 6207,
    #[msg("Content expired")]
    ContentExpired = 6208,
    #[msg("Content moderated")]
    ContentModerated = 6209,
    #[msg("v1 write path is disabled; use v2")]
    V1WritePathDisabled = 6210,

    // 验证相关错误 (6300-6399)
    #[msg("Validation failed")]
    ValidationFailed = 6300,
    #[msg("Validator not found")]
    ValidatorNotFound = 6301,
    #[msg("Validator disabled")]
    ValidatorDisabled = 6302,
    #[msg("Invalid validation context")]
    InvalidValidationContext = 6303,
    #[msg("Validation timeout")]
    ValidationTimeout = 6304,
    #[msg("Invalid validator config")]
    InvalidValidatorConfig = 6305,
    #[msg("Invalid validation result")]
    InvalidValidationResult = 6306,
    #[msg("Validator unauthorized")]
    ValidatorUnauthorized = 6307,
    #[msg("Validator type mismatch")]
    ValidatorTypeMismatch = 6308,
    #[msg("Validation rule conflict")]
    ValidationRuleConflict = 6309,

    // 访问控制错误 (6400-6499)
    #[msg("Permission denied")]
    PermissionDenied = 6400,
    #[msg("Access rule not found")]
    AccessRuleNotFound = 6401,
    #[msg("Invalid permission type")]
    InvalidPermission = 6402,
    #[msg("Invalid access level")]
    InvalidAccessLevel = 6403,
    #[msg("Permission rule conflict")]
    PermissionRuleConflict = 6404,
    #[msg("Invalid relationship type")]
    InvalidRelationshipType = 6405,
    #[msg("Permission template not found")]
    PermissionTemplateNotFound = 6406,
    #[msg("Access controller not initialized")]
    AccessControllerNotInitialized = 6407,
    #[msg("Permission check timeout")]
    PermissionCheckTimeout = 6408,
    #[msg("Batch permission check failed")]
    BatchPermissionCheckFailed = 6409,

    // 事件系统错误 (6500-6599)
    #[msg("Event emission failed")]
    EventEmissionFailed = 6500,
    #[msg("Invalid event type")]
    InvalidEventType = 6501,
    #[msg("Event data too large")]
    EventDataTooLarge = 6502,
    #[msg("Event subscription failed")]
    EventSubscriptionFailed = 6503,
    #[msg("Event query failed")]
    EventQueryFailed = 6504,
    #[msg("Event batch is full")]
    EventBatchFull = 6505,
    #[msg("Event archive failed")]
    EventArchiveFailed = 6506,
    #[msg("Invalid event filter")]
    InvalidEventFilter = 6507,
    #[msg("Invalid event storage strategy")]
    InvalidEventStorageStrategy = 6508,
    #[msg("Event subscription already exists")]
    EventSubscriptionAlreadyExists = 6509,

    // 工厂和部署错误 (6600-6699)
    #[msg("Registry deployment failed")]
    RegistryDeploymentFailed = 6600,
    #[msg("Invalid registry config")]
    InvalidRegistryConfig = 6601,
    #[msg("Registry already exists")]
    RegistryAlreadyExists = 6602,
    #[msg("Registry upgrade failed")]
    RegistryUpgradeFailed = 6603,
    #[msg("Invalid program version")]
    InvalidProgramVersion = 6604,
    #[msg("Insufficient deployment permission")]
    InsufficientDeploymentPermission = 6605,
    #[msg("Factory not initialized")]
    FactoryNotInitialized = 6606,
    #[msg("Invalid deployment params")]
    InvalidDeploymentParams = 6607,
    #[msg("Registry type mismatch")]
    RegistryTypeMismatch = 6608,
    #[msg("Deployment quota exceeded")]
    DeploymentQuotaExceeded = 6609,
}

/// 错误处理工具函数
pub fn map_anchor_error(err: anchor_lang::error::Error) -> AlchemeError {
    // 简化错误映射，因为具体的错误变体可能因版本而异
    match err {
        _ => AlchemeError::InvalidOperation,
    }
}

/// 错误日志宏
#[macro_export]
macro_rules! log_error {
    ($error:expr, $context:expr) => {
        msg!("ERROR [{}:{}]: {} - Context: {}", 
             file!(), line!(), $error, $context);
    };
    ($error:expr) => {
        msg!("ERROR [{}:{}]: {}", 
             file!(), line!(), $error);
    };
}

/// 条件检查宏
#[macro_export]
macro_rules! require_msg {
    ($condition:expr, $error:expr, $msg:expr) => {
        if !($condition) {
            log_error!($error, $msg);
            return Err($error.into());
        }
    };
}
