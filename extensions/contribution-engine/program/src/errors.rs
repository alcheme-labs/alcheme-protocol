use anchor_lang::prelude::*;

/// Contribution Engine 错误码 (7000-7099)
/// 避免与 AlchemeError (6000-6699) 冲突
#[error_code]
pub enum ContributionError {
    // 账本相关 (7000-7009)
    #[msg("Contribution ledger already exists")]
    LedgerAlreadyExists = 7000,
    #[msg("Contribution ledger not found")]
    LedgerNotFound = 7001,
    #[msg("Ledger is closed and cannot be modified")]
    LedgerClosed = 7002,
    #[msg("Ledger is not closed and cannot be settled")]
    LedgerNotClosed = 7003,

    // 贡献记录相关 (7010-7019)
    #[msg("Contribution record already exists")]
    ContributionExists = 7010,
    #[msg("Contribution record not found")]
    ContributionNotFound = 7011,
    #[msg("Invalid contribution role")]
    InvalidRole = 7012,
    #[msg("Weight out of range (0.0 to 1.0)")]
    InvalidWeight = 7013,
    #[msg("Maximum contribution entries per Crystal exceeded")]
    MaxEntriesExceeded = 7014,

    // 引用相关 (7020-7029)
    #[msg("Reference already exists")]
    ReferenceExists = 7020,
    #[msg("Reference not found")]
    ReferenceNotFound = 7021,
    #[msg("Invalid reference type")]
    InvalidReferenceType = 7022,
    #[msg("Self-reference is not allowed")]
    SelfReferenceNotAllowed = 7023,

    // 权限与配置 (7030-7039)
    #[msg("Unauthorized operation")]
    Unauthorized = 7030,
    #[msg("Engine not initialized")]
    EngineNotInitialized = 7031,
    #[msg("Invalid config")]
    InvalidConfig = 7032,

    // 结算相关 (7040-7049)
    #[msg("Role weights exceed 1.0")]
    WeightOverflow = 7040,
    #[msg("Reputation settlement failed")]
    SettlementFailed = 7041,
    #[msg("Ledger reputation already settled")]
    AlreadySettled = 7042,
}
