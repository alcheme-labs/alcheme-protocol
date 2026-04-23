use anchor_lang::prelude::*;
use alcheme_shared::*;

// Program IDs from declare_id! macros
const CONTENT_MANAGER_ID: Pubkey = solana_program::pubkey!("FEut65PCemjUt7dRPe4GJhaj1u5czWndvgp7LCEbiV7y");
const ACCESS_CONTROLLER_ID: Pubkey = solana_program::pubkey!("BNbDZu2djPT6rdqgsSEtyiCw4b8wteBNQDiyKS6GFxun");
const EVENT_EMITTER_ID: Pubkey = solana_program::pubkey!("uhPvVgDANHaUzUq2rYEVXJ9vGEBjWjNZ1E6gQJqdBUC");
const REGISTRY_FACTORY_ID: Pubkey = solana_program::pubkey!("AYrzTqFdxpiH3VhCBzLsJQtzFqjoSRKYUvk29d797AQC");
const IDENTITY_REGISTRY_ID: Pubkey = solana_program::pubkey!("75fXAp66PU3sgUcQCGJxdA4MKhFcyXXoGW8rhVk8zm4x");
const MESSAGING_MANAGER_ID: Pubkey = solana_program::pubkey!("4MZjksSnfSNa25ttV4smquKE6ggAmpZKjK74eDQLdoLx");
const CIRCLE_MANAGER_ID: Pubkey = solana_program::pubkey!("GZswb1rGbZfoiapkvatDuMZrptVAX2p1pEVDSrMuyLqQ");

// CPI 接口 — 支持核心程序互信 + 链上扩展注册

/// CPI 权限类型
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug, PartialEq)]
pub enum CpiPermission {
    // 身份相关权限
    IdentityRead,
    IdentityVerify,
    IdentityUpdate,
    
    // 内容相关权限
    ContentRead,
    ContentValidate,
    ContentCreate,
    ContentStatusUpdate,        // Extension: 更新内容状态
    
    // 访问控制权限
    AccessCheck,
    AccessRuleRead,
    
    // 事件相关权限
    EventEmit,
    EventQuery,
    
    // 工厂权限
    RegistryDeploy,
    RegistryUpgrade,
    
    // Extension 专用权限
    ReputationWrite,            // Extension: 写入声誉分数
    ContributionRead,           // Extension: 读取贡献数据
    CircleExtend,               // Extension: 扩展圈层功能
}

/// 授权调用者
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct AuthorizedCaller {
    pub program_id: Pubkey,
    pub permissions: Vec<CpiPermission>,
    pub enabled: bool,
}

// ==================== Extension Registry ====================

/// 链上扩展注册表 — 存储在 registry-factory 管理的 PDA 中
/// PDA seeds: ["extension_registry"]
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct ExtensionRegistry {
    pub bump: u8,
    pub admin: Pubkey,
    pub extensions: Vec<AuthorizedCaller>,
    pub max_extensions: u8,
    pub created_at: i64,
    pub last_updated: i64,
}

impl ExtensionRegistry {
    /// 最多支持 20 个扩展程序
    pub const MAX_EXTENSIONS: usize = 20;
    /// 每个扩展最多 10 个权限
    pub const MAX_PERMISSIONS_PER_EXTENSION: usize = 10;

    pub const SPACE: usize =
        8 +   // discriminator
        1 +   // bump
        32 +  // admin
        4 + (Self::MAX_EXTENSIONS * (32 + 4 + Self::MAX_PERMISSIONS_PER_EXTENSION * 2 + 1)) + // extensions vec
        1 +   // max_extensions
        8 +   // created_at
        8;    // last_updated

    /// 检查扩展是否已注册并拥有指定权限
    pub fn is_authorized(&self, caller_program: &Pubkey, permission: &CpiPermission) -> bool {
        self.extensions.iter().any(|ext| {
            ext.program_id == *caller_program
                && ext.enabled
                && ext.permissions.contains(permission)
        })
    }

    /// 注册新扩展
    pub fn register_extension(
        &mut self,
        program_id: Pubkey,
        permissions: Vec<CpiPermission>,
    ) -> Result<()> {
        require!(
            self.extensions.len() < self.max_extensions as usize,
            AlchemeError::InvalidOperation
        );
        require!(
            !self.extensions.iter().any(|e| e.program_id == program_id),
            AlchemeError::InvalidOperation  // 扩展已存在
        );
        require!(
            permissions.len() <= Self::MAX_PERMISSIONS_PER_EXTENSION,
            AlchemeError::InvalidOperation
        );
        self.extensions.push(AuthorizedCaller {
            program_id,
            permissions,
            enabled: true,
        });
        self.last_updated = Clock::get()?.unix_timestamp;
        Ok(())
    }

    /// 移除扩展
    pub fn remove_extension(&mut self, program_id: &Pubkey) -> Result<()> {
        let idx = self.extensions.iter().position(|e| e.program_id == *program_id)
            .ok_or(AlchemeError::AccountNotFound)?;
        self.extensions.remove(idx);
        self.last_updated = Clock::get()?.unix_timestamp;
        Ok(())
    }

    /// 更新扩展权限
    pub fn update_extension_permissions(
        &mut self,
        program_id: &Pubkey,
        new_permissions: Vec<CpiPermission>,
    ) -> Result<()> {
        require!(
            new_permissions.len() <= Self::MAX_PERMISSIONS_PER_EXTENSION,
            AlchemeError::InvalidOperation
        );
        let ext = self.extensions.iter_mut().find(|e| e.program_id == *program_id)
            .ok_or(AlchemeError::AccountNotFound)?;
        ext.permissions = new_permissions;
        self.last_updated = Clock::get()?.unix_timestamp;
        Ok(())
    }

    /// 设置扩展启用/禁用
    pub fn set_extension_enabled(&mut self, program_id: &Pubkey, enabled: bool) -> Result<()> {
        let ext = self.extensions.iter_mut().find(|e| e.program_id == *program_id)
            .ok_or(AlchemeError::AccountNotFound)?;
        ext.enabled = enabled;
        self.last_updated = Clock::get()?.unix_timestamp;
        Ok(())
    }
}

/// 检查程序是否有权限进行 CPI 调用
/// 先查硬编码核心列表（零开销），再查链上 ExtensionRegistry
pub fn is_authorized_for_cpi(
    caller_program: &Pubkey,
    permission: CpiPermission,
) -> Result<bool> {
    // 1. 先查硬编码核心列表（编译时常量，零开销）
    let core_programs = get_core_programs();
    if let Some(authorized_caller) = core_programs.iter()
        .find(|caller| caller.program_id == *caller_program) 
    {
        return Ok(authorized_caller.enabled && 
                 authorized_caller.permissions.contains(&permission));
    }
    // 2. 核心列表没找到 → 返回 false（链上 Registry 由新函数处理）
    Ok(false)
}

/// 检查程序是否有权限进行 CPI 调用（含链上扩展注册表）
/// 用于 Extension Program 调用 Base Layer 的场景
pub fn is_authorized_for_cpi_with_registry(
    caller_program: &Pubkey,
    permission: CpiPermission,
    extension_registry: Option<&AccountInfo>,
) -> Result<bool> {
    // 1. 先查硬编码核心列表
    if is_authorized_for_cpi(caller_program, permission.clone())? {
        return Ok(true);
    }
    // 2. 查链上 ExtensionRegistry
    if let Some(registry_account) = extension_registry {
        // 验证 registry 账户 owner 是 registry-factory
        require!(
            *registry_account.owner == REGISTRY_FACTORY_ID,
            AlchemeError::InvalidAccountOwner
        );
        let data = registry_account.try_borrow_data()?;
        // 跳过 8 字节 discriminator
        if data.len() > 8 {
            let mut slice: &[u8] = &data[8..];
            if let Ok(registry) = ExtensionRegistry::deserialize(&mut slice) {
                return Ok(registry.is_authorized(caller_program, &permission));
            }
        }
    }
    Ok(false)
}

/// 获取核心程序列表（硬编码，Base Layer 程序间互信）
fn get_core_programs() -> Vec<AuthorizedCaller> {
    vec![
        AuthorizedCaller {
            program_id: CONTENT_MANAGER_ID,
            permissions: vec![
                CpiPermission::IdentityRead,
                CpiPermission::IdentityVerify,
                CpiPermission::AccessCheck,
                CpiPermission::EventEmit,
            ],
            enabled: true,
        },
        AuthorizedCaller {
            program_id: ACCESS_CONTROLLER_ID,
            permissions: vec![
                CpiPermission::IdentityRead,
                CpiPermission::IdentityVerify,
                CpiPermission::EventEmit,
            ],
            enabled: true,
        },
        AuthorizedCaller {
            program_id: EVENT_EMITTER_ID,
            permissions: vec![
                CpiPermission::IdentityRead,
                CpiPermission::ContentRead,
                CpiPermission::AccessRuleRead,
            ],
            enabled: true,
        },
        AuthorizedCaller {
            program_id: REGISTRY_FACTORY_ID,
            permissions: vec![
                CpiPermission::IdentityRead,
                CpiPermission::EventEmit,
                CpiPermission::RegistryDeploy,
                CpiPermission::RegistryUpgrade,
            ],
            enabled: true,
        },
        AuthorizedCaller {
            program_id: IDENTITY_REGISTRY_ID,
            permissions: vec![
                CpiPermission::EventEmit,
            ],
            enabled: true,
        },
        AuthorizedCaller {
            program_id: MESSAGING_MANAGER_ID,
            permissions: vec![
                CpiPermission::EventEmit,
            ],
            enabled: true,
        },
        AuthorizedCaller {
            program_id: CIRCLE_MANAGER_ID,
            permissions: vec![
                CpiPermission::EventEmit,
            ],
            enabled: true,
        },
    ]
}

/// CPI 权限检查宏 — 仅查核心程序列表
#[macro_export]
macro_rules! require_cpi_permission {
    ($caller_program:expr, $permission:expr) => {
        require!(
            is_authorized_for_cpi($caller_program, $permission)?,
            AlchemeError::UnauthorizedCpiCall
        );
    };
}

/// CPI 权限检查宏 — 含链上扩展注册表查询
#[macro_export]
macro_rules! require_cpi_permission_with_registry {
    ($caller_program:expr, $permission:expr, $registry:expr) => {
        require!(
            is_authorized_for_cpi_with_registry($caller_program, $permission, $registry)?,
            AlchemeError::UnauthorizedCpiCall
        );
    };
}

/// CPI 调用辅助函数
pub struct CpiHelper;

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug, PartialEq)]
pub struct CircleMembershipFact {
    pub circle_id: u8,
    pub member: Pubkey,
    pub status: CircleMemberStatus,
    pub role: CircleMemberRole,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug, PartialEq)]
struct CircleMemberAccountData {
    pub circle_id: u8,
    pub member: Pubkey,
    pub status: CircleMemberStatus,
    pub role: CircleMemberRole,
    pub joined_at: i64,
    pub updated_at: i64,
    pub bump: u8,
}

impl CpiHelper {
    fn deserialize_account_inner<T: AnchorDeserialize>(account: &AccountInfo) -> Result<T> {
        let data = account.try_borrow_data()?;
        require!(data.len() >= 8, AlchemeError::InvalidAccountData);
        let mut slice: &[u8] = &data[8..];
        T::deserialize(&mut slice).map_err(|_| AlchemeError::InvalidAccountData.into())
    }

    /// 验证身份 - 简化的 CPI 调用
    pub fn verify_identity_simple(
        identity_program: &AccountInfo,
        user_identity: &AccountInfo,
        caller_program: &Pubkey,
        identity_id: Pubkey,
    ) -> Result<bool> {
        require_cpi_permission!(caller_program, CpiPermission::IdentityRead);

        require!(
            *identity_program.key == IDENTITY_REGISTRY_ID,
            AlchemeError::InvalidProgramId
        );
        require!(
            user_identity.owner == &IDENTITY_REGISTRY_ID,
            AlchemeError::InvalidAccountOwner
        );

        let identity = Self::deserialize_account_inner::<UserIdentity>(user_identity)?;
        require!(
            identity.identity_id == identity_id,
            AlchemeError::IdentityNotFound
        );
        require!(
            !identity.primary_handle.trim().is_empty(),
            AlchemeError::InvalidAccountData
        );

        Ok(true)
    }

    /// 检查权限 - 简化的 CPI 调用
    pub fn check_permission_simple(
        access_program: &AccountInfo,
        access_controller: &AccountInfo,
        caller_program: &Pubkey,
        requester: Pubkey,
        target: Pubkey,
        permission: Permission,
    ) -> Result<bool> {
        require_cpi_permission!(caller_program, CpiPermission::AccessCheck);

        require!(
            *access_program.key == ACCESS_CONTROLLER_ID,
            AlchemeError::InvalidProgramId
        );
        require!(
            access_controller.owner == &ACCESS_CONTROLLER_ID,
            AlchemeError::InvalidAccountOwner
        );

        let mut controller = Self::deserialize_account_inner::<AccessController>(access_controller)?;
        let context = PermissionContext {
            requester,
            target,
            permission: permission.clone(),
            resource_type: ResourceType::Content,
            timestamp: Clock::get()?.unix_timestamp,
            source: "cpi_helper".to_string(),
            additional_data: Vec::new(),
        };

        controller.check_permission(&requester, &target, permission, &context)
    }

    pub fn check_follow_relationship_simple(
        access_program: &AccountInfo,
        follow_relationship: &AccountInfo,
        caller_program: &Pubkey,
        follower: Pubkey,
        followed: Pubkey,
    ) -> Result<bool> {
        require_cpi_permission!(caller_program, CpiPermission::AccessCheck);

        require!(
            *access_program.key == ACCESS_CONTROLLER_ID,
            AlchemeError::InvalidProgramId
        );

        if follow_relationship.owner != &ACCESS_CONTROLLER_ID {
            return Ok(false);
        }

        let data = follow_relationship.try_borrow_data()?;
        // Account layout: 8 discriminator + 1 bump + 32 follower + 32 followed + 8 created_at.
        const FOLLOW_RELATIONSHIP_FOLLOWER_OFFSET: usize = 8 + 1;
        const FOLLOW_RELATIONSHIP_FOLLOWED_OFFSET: usize =
            FOLLOW_RELATIONSHIP_FOLLOWER_OFFSET + 32;
        const FOLLOW_RELATIONSHIP_MIN_LEN: usize =
            FOLLOW_RELATIONSHIP_FOLLOWED_OFFSET + 32 + 8;
        require!(
            data.len() >= FOLLOW_RELATIONSHIP_MIN_LEN,
            AlchemeError::InvalidAccountData
        );

        let mut stored_follower = [0u8; 32];
        stored_follower.copy_from_slice(
            &data[FOLLOW_RELATIONSHIP_FOLLOWER_OFFSET..FOLLOW_RELATIONSHIP_FOLLOWED_OFFSET],
        );
        let mut stored_followed = [0u8; 32];
        stored_followed.copy_from_slice(
            &data[FOLLOW_RELATIONSHIP_FOLLOWED_OFFSET
                ..FOLLOW_RELATIONSHIP_FOLLOWED_OFFSET + 32],
        );

        Ok(
            Pubkey::new_from_array(stored_follower) == follower
                && Pubkey::new_from_array(stored_followed) == followed,
        )
    }

    pub fn read_circle_membership_simple(
        circle_membership: &AccountInfo,
        caller_program: &Pubkey,
        member: Pubkey,
    ) -> Result<Option<CircleMembershipFact>> {
        require_cpi_permission!(caller_program, CpiPermission::AccessCheck);

        if circle_membership.owner != &CIRCLE_MANAGER_ID {
            return Ok(None);
        }

        let membership =
            Self::deserialize_account_inner::<CircleMemberAccountData>(circle_membership)?;
        if membership.member != member || membership.status != CircleMemberStatus::Active {
            return Ok(None);
        }

        Ok(Some(CircleMembershipFact {
            circle_id: membership.circle_id,
            member: membership.member,
            status: membership.status,
            role: membership.role,
        }))
    }

    /// 发射事件 - 真实的 CPI 调用
    /// 
    /// 参数说明:
    /// - event_program: Event Emitter 程序账户
    /// - event_emitter: Event Emitter 状态账户（可变）
    /// - event_batch: EventBatch 账户（可变，init_if_needed）
    /// - payer: 支付账户（可变，用于支付租金）
    /// - system_program: 系统程序
    /// - caller_program: 调用程序的 program_id
    /// - event: 要发射的事件
    pub fn emit_event_simple<'info>(
        event_program: &AccountInfo<'info>,
        event_emitter: &mut AccountInfo<'info>,
        event_batch: &mut AccountInfo<'info>,
        payer: &AccountInfo<'info>,
        system_program: &AccountInfo<'info>,
        caller_program: &Pubkey,
        event: ProtocolEvent,
    ) -> Result<u64> {
        // 验证调用权限
        require_cpi_permission!(caller_program, CpiPermission::EventEmit);
        
        // 验证 event_program 是 EVENT_EMITTER_ID
        require!(
            *event_program.key == EVENT_EMITTER_ID,
            AlchemeError::InvalidProgramId
        );
        
        // 验证 event_emitter 账户所有者
        require!(
            event_emitter.owner == &EVENT_EMITTER_ID,
            AlchemeError::InvalidAccountOwner
        );
        
        // 验证 payer 是 signer
        require!(
            payer.is_signer,
            AlchemeError::SignerRequired
        );
        
        // 验证 system_program
        require!(
            *system_program.key == anchor_lang::solana_program::system_program::ID,
            AlchemeError::InvalidProgramId
        );

        let lightweight_v2_anchor = matches!(
            &event,
            ProtocolEvent::ContentAnchoredV2 { .. } | ProtocolEvent::ContentAnchorUpdatedV2 { .. }
        );
        if lightweight_v2_anchor {
            let ix = build_emit_content_anchor_v2_light_instruction(
                event_program.key,
                event_emitter.key,
                event,
            )?;
            solana_program::program::invoke(&ix, &[event_emitter.clone()])?;
        } else {
            // 其他事件保持原有 emit_event 路由
            let ix = build_emit_event_instruction(
                event_program.key,
                event_emitter.key,
                event_batch.key,
                payer.key,
                system_program.key,
                event,
                EventPriority::Normal,
            )?;
            solana_program::program::invoke(
                &ix,
                &[
                    event_emitter.clone(),
                    event_batch.clone(),
                    payer.clone(),
                    system_program.clone(),
                ],
            )?;
        }
        
        // 从 EventEmitter 账户读取最新的 event_sequence
        let event_sequence = read_event_sequence(&event_emitter.try_borrow_data()?)?;
        
        Ok(event_sequence)
    }

    /// 批量发射事件（复用单批次，避免多次 batch 初始化）
    pub fn batch_emit_events_simple<'info>(
        event_program: &AccountInfo<'info>,
        event_emitter: &mut AccountInfo<'info>,
        event_batch: &mut AccountInfo<'info>,
        payer: &AccountInfo<'info>,
        system_program: &AccountInfo<'info>,
        caller_program: &Pubkey,
        events: Vec<ProtocolEvent>,
    ) -> Result<Vec<u64>> {
        require_cpi_permission!(caller_program, CpiPermission::EventEmit);
        require!(
            *event_program.key == EVENT_EMITTER_ID,
            AlchemeError::InvalidProgramId
        );
        require!(
            event_emitter.owner == &EVENT_EMITTER_ID,
            AlchemeError::InvalidAccountOwner
        );
        require!(payer.is_signer, AlchemeError::SignerRequired);
        require!(
            *system_program.key == anchor_lang::solana_program::system_program::ID,
            AlchemeError::InvalidProgramId
        );
        require!(
            !events.is_empty() && events.len() <= MAX_BATCH_SIZE,
            AlchemeError::EventBatchFull
        );

        let ix = build_batch_emit_events_instruction(
            event_program.key,
            event_emitter.key,
            event_batch.key,
            payer.key,
            system_program.key,
            events.clone(),
            EventPriority::Normal,
        )?;
        solana_program::program::invoke(
            &ix,
            &[
                event_emitter.clone(),
                event_batch.clone(),
                payer.clone(),
                system_program.clone(),
            ],
        )?;

        let end_sequence = read_event_sequence(&event_emitter.try_borrow_data()?)?;
        let count = events.len() as u64;
        let start_sequence = end_sequence.saturating_sub(count).saturating_add(1);
        let mut result = Vec::with_capacity(events.len());
        for offset in 0..count {
            result.push(start_sequence + offset);
        }
        Ok(result)
    }
}

// ==================== 辅助函数 ====================

/// 构建 emit_content_anchor_v2_light 指令（用于轻量 v2 内容锚点事件）
fn build_emit_content_anchor_v2_light_instruction(
    event_program_id: &Pubkey,
    event_emitter: &Pubkey,
    event: ProtocolEvent,
) -> Result<solana_program::instruction::Instruction> {
    let discriminator = anchor_lang::solana_program::hash::hash(
        "global:emit_content_anchor_v2_light".as_bytes(),
    );
    let discriminator_bytes = &discriminator.to_bytes()[0..8];

    let mut instruction_data = discriminator_bytes.to_vec();
    event
        .serialize(&mut instruction_data)
        .map_err(|_| error!(AlchemeError::SerializationError))?;

    let accounts = vec![solana_program::instruction::AccountMeta::new(
        *event_emitter,
        false,
    )];

    Ok(solana_program::instruction::Instruction {
        program_id: *event_program_id,
        accounts,
        data: instruction_data,
    })
}

/// 构建 emit_event 指令
fn build_emit_event_instruction(
    event_program_id: &Pubkey,
    event_emitter: &Pubkey,
    event_batch: &Pubkey,
    payer: &Pubkey,
    system_program: &Pubkey,
    event: ProtocolEvent,
    priority: EventPriority,
) -> Result<solana_program::instruction::Instruction> {
    // Anchor 指令格式:
    // - 8 bytes: instruction discriminator (sighash("global:emit_event"))
    // - remaining: borsh serialized instruction parameters (event, priority)
    
    // 计算指令 discriminator
    // Anchor uses the first 8 bytes of the sha256 hash of "global:emit_event"
    let discriminator = anchor_lang::solana_program::hash::hash("global:emit_event".as_bytes());
    let discriminator_bytes = &discriminator.to_bytes()[0..8];
    
    // 序列化指令参数
    let mut instruction_data = discriminator_bytes.to_vec();
    event.serialize(&mut instruction_data)
        .map_err(|_| error!(AlchemeError::SerializationError))?;
    priority.serialize(&mut instruction_data)
        .map_err(|_| error!(AlchemeError::SerializationError))?;
    
    // 构建账户列表
    // EmitEvent context 定义的账户:
    // 1. event_emitter (mut)
    // 2. event_batch (mut, init_if_needed)
    // 3. payer (mut, signer)
    // 4. system_program
    let accounts = vec![
        solana_program::instruction::AccountMeta::new(*event_emitter, false),
        solana_program::instruction::AccountMeta::new(*event_batch, false),
        solana_program::instruction::AccountMeta::new(*payer, true),
        solana_program::instruction::AccountMeta::new_readonly(*system_program, false),
    ];
    
    Ok(solana_program::instruction::Instruction {
        program_id: *event_program_id,
        accounts,
        data: instruction_data,
    })
}

/// 构建 batch_emit_events 指令
fn build_batch_emit_events_instruction(
    event_program_id: &Pubkey,
    event_emitter: &Pubkey,
    event_batch: &Pubkey,
    payer: &Pubkey,
    system_program: &Pubkey,
    events: Vec<ProtocolEvent>,
    priority: EventPriority,
) -> Result<solana_program::instruction::Instruction> {
    let discriminator = anchor_lang::solana_program::hash::hash("global:batch_emit_events".as_bytes());
    let discriminator_bytes = &discriminator.to_bytes()[0..8];

    let mut instruction_data = discriminator_bytes.to_vec();
    events
        .serialize(&mut instruction_data)
        .map_err(|_| error!(AlchemeError::SerializationError))?;
    priority
        .serialize(&mut instruction_data)
        .map_err(|_| error!(AlchemeError::SerializationError))?;

    let accounts = vec![
        solana_program::instruction::AccountMeta::new(*event_emitter, false),
        solana_program::instruction::AccountMeta::new(*event_batch, false),
        solana_program::instruction::AccountMeta::new(*payer, true),
        solana_program::instruction::AccountMeta::new_readonly(*system_program, false),
    ];

    Ok(solana_program::instruction::Instruction {
        program_id: *event_program_id,
        accounts,
        data: instruction_data,
    })
}

/// 从 EventEmitter 账户数据读取 event_sequence
/// 
/// EventEmitterAccount 布局:
/// - 8 bytes: discriminator
/// - 1 byte: bump
/// - 32 bytes: admin (Pubkey)  
/// - 8 bytes: total_events (u64)
/// - 8 bytes: event_sequence (u64) ← 我们要读取这个
/// - ...
fn read_event_sequence(data: &[u8]) -> Result<u64> {
    // 验证账户数据长度
    const MIN_SIZE: usize = 8 + 1 + 32 + 8 + 8;
    require!(
        data.len() >= MIN_SIZE,
        AlchemeError::InvalidAccountData
    );
    
    // 计算 event_sequence 偏移量
    // offset = discriminator(8) + bump(1) + admin(32) + total_events(8)
    const OFFSET: usize = 8 + 1 + 32 + 8;
    
    // 读取 8 字节的 u64
    let bytes: [u8; 8] = data[OFFSET..OFFSET + 8]
        .try_into()
        .map_err(|_| error!(AlchemeError::InvalidAccountData))?;
    
    Ok(u64::from_le_bytes(bytes))
}

/// 简化的 CPI 结果类型
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct CpiResult<T> {
    pub success: bool,
    pub data: Option<T>,
    pub error_message: Option<String>,
}

impl<T> CpiResult<T> {
    pub fn success(data: T) -> Self {
        Self {
            success: true,
            data: Some(data),
            error_message: None,
        }
    }

    pub fn error(message: String) -> Self {
        Self {
            success: false,
            data: None,
            error_message: Some(message),
        }
    }
}
