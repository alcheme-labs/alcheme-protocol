use anchor_lang::prelude::*;

/// Alcheme Protocol 统一错误代码
#[error_code]
pub enum AlchemeError {
    // 通用错误 (6000-6099)
    #[msg("无效的操作")]
    InvalidOperation = 6000,
    #[msg("权限不足")]
    Unauthorized = 6001,
    #[msg("账户未找到")]
    AccountNotFound = 6002,
    #[msg("无效的账户所有者")]
    InvalidAccountOwner = 6003,
    #[msg("缺少必需的签名")]
    MissingSignature = 6004,
    #[msg("账户未租金豁免")]
    NotRentExempt = 6005,
    #[msg("数据序列化失败")]
    SerializationError = 6006,
    #[msg("数据反序列化失败")]
    DeserializationError = 6007,
    #[msg("数学运算溢出")]
    MathOverflow = 6008,
    #[msg("无效的时间戳")]
    InvalidTimestamp = 6009,
    #[msg("未授权的 CPI 调用")]
    UnauthorizedCpiCall = 6010,
    #[msg("无效的程序ID")]
    InvalidProgramId = 6011,
    #[msg("需要签名者")]
    SignerRequired = 6012,
    #[msg("无效的账户数据")]
    InvalidAccountData = 6013,
    #[msg("Circle is archived")]
    CircleArchived = 6014,
    #[msg("Circle is already archived")]
    CircleAlreadyArchived = 6015,
    #[msg("Circle is not archived")]
    CircleNotArchived = 6016,

    // 身份相关错误 (6100-6199)
    #[msg("无效的用户名长度")]
    InvalidHandleLength = 6100,
    #[msg("用户名包含无效字符")]
    InvalidHandleCharacters = 6101,
    #[msg("用户名已存在")]
    HandleAlreadyExists = 6102,
    #[msg("身份未找到")]
    IdentityNotFound = 6103,
    #[msg("身份已存在")]
    IdentityAlreadyExists = 6104,
    #[msg("无效的身份配置")]
    InvalidIdentityConfig = 6105,
    #[msg("身份验证失败")]
    IdentityVerificationFailed = 6106,
    #[msg("档案数据过大")]
    ProfileDataTooLarge = 6107,
    #[msg("无效的验证等级")]
    InvalidVerificationLevel = 6108,
    #[msg("声誉分数无效")]
    InvalidReputationScore = 6109,

    // 内容相关错误 (6200-6299)
    #[msg("内容未找到")]
    ContentNotFound = 6200,
    #[msg("内容已存在")]
    ContentAlreadyExists = 6201,
    #[msg("文本内容过长")]
    TextTooLong = 6202,
    #[msg("无效的内容类型")]
    InvalidContentType = 6203,
    #[msg("媒体附件过大")]
    MediaAttachmentTooLarge = 6204,
    #[msg("缺少媒体附件")]
    MissingMediaAttachment = 6205,
    #[msg("无效的存储策略")]
    InvalidStorageStrategy = 6206,
    #[msg("存储费用不足")]
    InsufficientStorageFee = 6207,
    #[msg("内容已过期")]
    ContentExpired = 6208,
    #[msg("内容被审核")]
    ContentModerated = 6209,
    #[msg("v1 写入路径已禁用，请改用 v2")]
    V1WritePathDisabled = 6210,

    // 验证相关错误 (6300-6399)
    #[msg("验证失败")]
    ValidationFailed = 6300,
    #[msg("验证器未找到")]
    ValidatorNotFound = 6301,
    #[msg("验证器已禁用")]
    ValidatorDisabled = 6302,
    #[msg("无效的验证上下文")]
    InvalidValidationContext = 6303,
    #[msg("验证超时")]
    ValidationTimeout = 6304,
    #[msg("验证器配置无效")]
    InvalidValidatorConfig = 6305,
    #[msg("验证结果无效")]
    InvalidValidationResult = 6306,
    #[msg("验证器权限不足")]
    ValidatorUnauthorized = 6307,
    #[msg("验证器类型不匹配")]
    ValidatorTypeMismatch = 6308,
    #[msg("验证规则冲突")]
    ValidationRuleConflict = 6309,

    // 访问控制错误 (6400-6499)
    #[msg("权限被拒绝")]
    PermissionDenied = 6400,
    #[msg("访问规则未找到")]
    AccessRuleNotFound = 6401,
    #[msg("无效的权限类型")]
    InvalidPermission = 6402,
    #[msg("无效的访问级别")]
    InvalidAccessLevel = 6403,
    #[msg("权限规则冲突")]
    PermissionRuleConflict = 6404,
    #[msg("关系类型无效")]
    InvalidRelationshipType = 6405,
    #[msg("权限模板未找到")]
    PermissionTemplateNotFound = 6406,
    #[msg("访问控制器未初始化")]
    AccessControllerNotInitialized = 6407,
    #[msg("权限检查超时")]
    PermissionCheckTimeout = 6408,
    #[msg("批量权限检查失败")]
    BatchPermissionCheckFailed = 6409,

    // 事件系统错误 (6500-6599)
    #[msg("事件发射失败")]
    EventEmissionFailed = 6500,
    #[msg("无效的事件类型")]
    InvalidEventType = 6501,
    #[msg("事件数据过大")]
    EventDataTooLarge = 6502,
    #[msg("事件订阅失败")]
    EventSubscriptionFailed = 6503,
    #[msg("事件查询失败")]
    EventQueryFailed = 6504,
    #[msg("事件批次已满")]
    EventBatchFull = 6505,
    #[msg("事件归档失败")]
    EventArchiveFailed = 6506,
    #[msg("无效的事件过滤器")]
    InvalidEventFilter = 6507,
    #[msg("事件存储策略无效")]
    InvalidEventStorageStrategy = 6508,
    #[msg("事件订阅已存在")]
    EventSubscriptionAlreadyExists = 6509,

    // 工厂和部署错误 (6600-6699)
    #[msg("注册表部署失败")]
    RegistryDeploymentFailed = 6600,
    #[msg("无效的注册表配置")]
    InvalidRegistryConfig = 6601,
    #[msg("注册表已存在")]
    RegistryAlreadyExists = 6602,
    #[msg("注册表升级失败")]
    RegistryUpgradeFailed = 6603,
    #[msg("无效的程序版本")]
    InvalidProgramVersion = 6604,
    #[msg("部署权限不足")]
    InsufficientDeploymentPermission = 6605,
    #[msg("工厂未初始化")]
    FactoryNotInitialized = 6606,
    #[msg("无效的部署参数")]
    InvalidDeploymentParams = 6607,
    #[msg("注册表类型不匹配")]
    RegistryTypeMismatch = 6608,
    #[msg("部署配额已用完")]
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
