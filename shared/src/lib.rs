use anchor_lang::prelude::*;
use solana_program::pubkey;

pub mod types;
pub mod errors;
pub mod constants;
pub mod utils;
pub mod validation;
pub mod events;
pub mod access;
pub mod content;
pub mod factory;
pub mod external_app;

// Shared library needs declare_id for #[account] macro
// but we hide ID from re-exports to avoid conflicts
mod __shared_anchor_id {
    use anchor_lang::prelude::declare_id;
    declare_id!("BPFLoaderUpgradeab1e11111111111111111111111");
}

// Make ID available in crate root for #[account] macro
#[doc(hidden)]
pub use __shared_anchor_id::ID;

// Re-export commonly used types
pub use types::*;
pub use errors::*;
pub use constants::*;
pub use utils::*;
pub use validation::*;
pub use events::*;
pub use access::*;
pub use content::*;
pub use factory::*;
pub use external_app::*;

// Core program IDs
pub const IDENTITY_REGISTRY_ID: Pubkey = pubkey!("2222222222222222222222222222222222222222222a");
pub const CONTENT_MANAGER_ID: Pubkey = pubkey!("3333333333333333333333333333333333333333333b");
pub const ACCESS_CONTROLLER_ID: Pubkey = pubkey!("4444444444444444444444444444444444444444444c");
pub const EVENT_EMITTER_ID: Pubkey = pubkey!("5555555555555555555555555555555555555555555d");
pub const REGISTRY_FACTORY_ID: Pubkey = pubkey!("6666666666666666666666666666666666666666666e");

// Shared types version for compatibility checking
pub const SHARED_TYPES_VERSION: &str = "1.0.0";
