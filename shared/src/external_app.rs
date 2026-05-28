use anchor_lang::prelude::*;

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug, PartialEq, Eq)]
pub enum ExternalAppRegistryStatus {
    Pending,
    Active,
    Suspended,
    Revoked,
}
