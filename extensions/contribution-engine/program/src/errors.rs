use anchor_lang::prelude::*;

/// Contribution Engine 错误码 (7000-7099)
/// 避免与 AlchemeError (6000-6699) 冲突
#[error_code]
pub enum ContributionError {
    // 账本相关 (7000-7009)
    #[msg("贡献账本已存在")]
    LedgerAlreadyExists = 7000,
    #[msg("贡献账本未找到")]
    LedgerNotFound = 7001,
    #[msg("账本已关闭，不可修改")]
    LedgerClosed = 7002,
    #[msg("账本尚未关闭，无法结算")]
    LedgerNotClosed = 7003,

    // 贡献记录相关 (7010-7019)
    #[msg("贡献记录已存在")]
    ContributionExists = 7010,
    #[msg("贡献记录未找到")]
    ContributionNotFound = 7011,
    #[msg("无效的贡献角色")]
    InvalidRole = 7012,
    #[msg("权重超出有效范围 (0.0 ~ 1.0)")]
    InvalidWeight = 7013,
    #[msg("超过每个 Crystal 的最大贡献条目数")]
    MaxEntriesExceeded = 7014,

    // 引用相关 (7020-7029)
    #[msg("引用关系已存在")]
    ReferenceExists = 7020,
    #[msg("引用关系未找到")]
    ReferenceNotFound = 7021,
    #[msg("无效的引用类型")]
    InvalidReferenceType = 7022,
    #[msg("不允许自引用")]
    SelfReferenceNotAllowed = 7023,

    // 权限与配置 (7030-7039)
    #[msg("未授权操作")]
    Unauthorized = 7030,
    #[msg("引擎未初始化")]
    EngineNotInitialized = 7031,
    #[msg("无效的配置参数")]
    InvalidConfig = 7032,

    // 结算相关 (7040-7049)
    #[msg("角色权重总和超过 1.0")]
    WeightOverflow = 7040,
    #[msg("声誉结算失败")]
    SettlementFailed = 7041,
    #[msg("该账本声誉已结算")]
    AlreadySettled = 7042,
}
