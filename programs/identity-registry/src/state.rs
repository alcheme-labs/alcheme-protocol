use anchor_lang::prelude::*;
use alcheme_shared::*;
use std::collections::HashSet;
use std::ops::{Deref, DerefMut};

use crate::validation::{
    IdentityValidator,
    MAX_PROFILE_DISPLAY_NAME_LENGTH,
    MAX_PROFILE_LOCATION_LENGTH,
    MAX_PROFILE_URI_LENGTH,
};

/// 身份更新数据结构
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct IdentityUpdates {
    pub display_name: Option<String>,
    pub bio: Option<String>,
    pub avatar_uri: Option<String>,
    pub banner_uri: Option<String>,
    pub website: Option<String>,
    pub location: Option<String>,
    pub metadata_uri: Option<String>,
    pub custom_attributes: Option<Vec<KeyValue>>,
}

/// 档案更新数据结构
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct ProfileUpdates {
    pub display_name: Option<String>,
    pub bio: Option<String>,
    pub avatar_uri: Option<String>,
    pub banner_uri: Option<String>,
    pub website: Option<String>,
    pub location: Option<String>,
    pub custom_fields: Option<Vec<KeyValue>>,
}

#[derive(Clone, Debug, PartialEq)]
pub struct PreparedIdentityProfileUpdate {
    pub next_profile: ProtocolProfile,
    pub updated_fields: Vec<String>,
    pub update_type: ProfileUpdateType,
    pub required_account_space: usize,
}

pub fn prepare_identity_profile_update(
    identity: &UserIdentity,
    updates: &IdentityUpdates,
) -> Result<PreparedIdentityProfileUpdate> {
    let mut next_profile = identity.protocol_profile();
    let mut updated_fields = Vec::new();

    if let Some(display_name) = updates.display_name.as_ref() {
        let normalized = normalize_optional_text(display_name, MAX_PROFILE_DISPLAY_NAME_LENGTH)?;
        if next_profile.display_name != normalized {
            next_profile.display_name = normalized;
            updated_fields.push("display_name".to_string());
        }
    }

    if let Some(bio) = updates.bio.as_ref() {
        let normalized = normalize_optional_text(bio, MAX_BIO_LENGTH)?;
        if next_profile.bio != normalized {
            next_profile.bio = normalized;
            updated_fields.push("bio".to_string());
        }
    }

    if let Some(avatar_uri) = updates.avatar_uri.as_ref() {
        let normalized = normalize_optional_uri(avatar_uri, MAX_PROFILE_URI_LENGTH)?;
        if next_profile.avatar_uri != normalized {
            next_profile.avatar_uri = normalized;
            updated_fields.push("avatar_uri".to_string());
        }
    }

    if let Some(banner_uri) = updates.banner_uri.as_ref() {
        let normalized = normalize_optional_uri(banner_uri, MAX_PROFILE_URI_LENGTH)?;
        if next_profile.banner_uri != normalized {
            next_profile.banner_uri = normalized;
            updated_fields.push("banner_uri".to_string());
        }
    }

    if let Some(website) = updates.website.as_ref() {
        let normalized = normalize_optional_website(website)?;
        if next_profile.website != normalized {
            next_profile.website = normalized;
            updated_fields.push("website".to_string());
        }
    }

    if let Some(location) = updates.location.as_ref() {
        let normalized = normalize_optional_text(location, MAX_PROFILE_LOCATION_LENGTH)?;
        if next_profile.location != normalized {
            next_profile.location = normalized;
            updated_fields.push("location".to_string());
        }
    }

    if let Some(metadata_uri) = updates.metadata_uri.as_ref() {
        let normalized = normalize_metadata_uri(metadata_uri)?;
        if next_profile.metadata_uri != normalized {
            next_profile.metadata_uri = normalized;
            updated_fields.push("metadata_uri".to_string());
        }
    }

    if let Some(custom_attributes) = updates.custom_attributes.as_ref() {
        let normalized = normalize_generic_custom_attributes(custom_attributes)?;
        if next_profile.custom_attributes != normalized {
            next_profile.custom_attributes = normalized;
            updated_fields.push("custom_attributes".to_string());
        }
    }

    let required_account_space = identity.protocol_profile_account_size(&next_profile)?;
    let current_account_space = 8
        + identity
            .try_to_vec()
            .map_err(|_| AlchemeError::SerializationError)?
            .len();

    require!(
        required_account_space.saturating_sub(current_account_space) <= 10_240,
        AlchemeError::ProfileDataTooLarge
    );

    let update_type = if updated_fields.len() == 1 && updated_fields[0] == "custom_attributes" {
        ProfileUpdateType::CustomAttributes
    } else {
        ProfileUpdateType::BasicInfo
    };

    Ok(PreparedIdentityProfileUpdate {
        next_profile,
        updated_fields,
        update_type,
        required_account_space,
    })
}

fn normalize_optional_text(value: &str, max_length: usize) -> Result<Option<String>> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return Ok(None);
    }

    if max_length == MAX_PROFILE_DISPLAY_NAME_LENGTH {
        IdentityValidator::validate_profile_display_name(trimmed)?;
    } else if max_length == MAX_PROFILE_LOCATION_LENGTH {
        IdentityValidator::validate_profile_location(trimmed)?;
    } else {
        ValidationUtils::validate_string_length(trimmed, max_length, AlchemeError::InvalidOperation)?;
    }

    Ok(Some(trimmed.to_string()))
}

fn normalize_optional_uri(value: &str, _max_length: usize) -> Result<Option<String>> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return Ok(None);
    }

    IdentityValidator::validate_profile_uri(trimmed)?;
    Ok(Some(trimmed.to_string()))
}

fn normalize_optional_website(value: &str) -> Result<Option<String>> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return Ok(None);
    }

    ValidationUtils::validate_url(trimmed)?;
    Ok(Some(trimmed.to_string()))
}

fn normalize_metadata_uri(value: &str) -> Result<String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return Ok(String::new());
    }

    IdentityValidator::validate_profile_metadata_uri(trimmed)?;
    Ok(trimmed.to_string())
}

fn normalize_generic_custom_attributes(custom_attributes: &[KeyValue]) -> Result<Vec<KeyValue>> {
    require!(
        custom_attributes.len() <= MAX_CUSTOM_FIELDS,
        AlchemeError::ProfileDataTooLarge
    );

    let mut seen_keys = HashSet::new();
    let mut normalized = Vec::with_capacity(custom_attributes.len());
    for attribute in custom_attributes {
        let key = attribute.key.trim();
        require!(!key.is_empty(), AlchemeError::InvalidOperation);
        require!(
            !is_reserved_profile_attribute_key(key),
            AlchemeError::InvalidOperation
        );
        require!(seen_keys.insert(key.to_string()), AlchemeError::InvalidOperation);

        let value = attribute.value.trim();
        IdentityValidator::validate_profile_attribute(&KeyValue {
            key: key.to_string(),
            value: value.to_string(),
        })?;

        normalized.push(KeyValue {
            key: key.to_string(),
            value: value.to_string(),
        });
    }

    Ok(normalized)
}

// ==================== Wrapper Accounts ====================

#[account]
pub struct UserIdentityAccount {
    pub inner: UserIdentity,
}

impl Deref for UserIdentityAccount {
    type Target = UserIdentity;
    fn deref(&self) -> &Self::Target {
        &self.inner
    }
}

impl DerefMut for UserIdentityAccount {
    fn deref_mut(&mut self) -> &mut Self::Target {
        &mut self.inner
    }
}

impl UserIdentityAccount {
    pub const SPACE: usize = UserIdentity::SPACE;
}

#[account]
pub struct HandleMappingAccount {
    pub inner: HandleMapping,
}

impl Deref for HandleMappingAccount {
    type Target = HandleMapping;
    fn deref(&self) -> &Self::Target {
        &self.inner
    }
}

impl DerefMut for HandleMappingAccount {
    fn deref_mut(&mut self) -> &mut Self::Target {
        &mut self.inner
    }
}

impl HandleMappingAccount {
    pub const SPACE: usize = HandleMapping::SPACE;
}

#[account]
pub struct IdentityRegistryAccount {
    pub inner: IdentityRegistry,
}

impl Deref for IdentityRegistryAccount {
    type Target = IdentityRegistry;
    fn deref(&self) -> &Self::Target {
        &self.inner
    }
}

impl DerefMut for IdentityRegistryAccount {
    fn deref_mut(&mut self) -> &mut Self::Target {
        &mut self.inner
    }
}

impl IdentityRegistryAccount {
    pub const SPACE: usize = IdentityRegistry::SPACE;
}
