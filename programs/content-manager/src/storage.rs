use anchor_lang::prelude::*;
use alcheme_shared::*;

/// 存储协调器
pub struct StorageCoordinator;

impl StorageCoordinator {
    /// 确定存储策略
    pub fn determine_storage_strategy(
        content_data: &ContentData,
        storage_config: &StorageConfig,
    ) -> StorageStrategy {
        // 计算内容大小
        let text_size = content_data.text.len() as u32;
        let total_media_size: u64 = content_data.media_attachments.iter()
            .map(|m| m.file_size.unwrap_or(0))
            .sum();
        
        // 基于大小和类型选择策略
        match content_data.content_type {
            ContentType::Text => {
                if text_size <= storage_config.text_threshold {
                    StorageStrategy::OnChain
                } else {
                    StorageStrategy::IPFS
                }
            },
            ContentType::Image => {
                if total_media_size <= storage_config.media_threshold {
                    StorageStrategy::IPFS
                } else {
                    StorageStrategy::Arweave
                }
            },
            ContentType::Video | ContentType::Audio => {
                StorageStrategy::Arweave // 大文件永久存储
            },
            ContentType::Live => {
                StorageStrategy::IPFS // 临时/直播内容
            },
            ContentType::Document => {
                if total_media_size <= storage_config.media_threshold {
                    StorageStrategy::IPFS
                } else {
                    StorageStrategy::Arweave
                }
            },
            _ => {
                if storage_config.compression_enabled {
                    StorageStrategy::Hybrid
                } else {
                    StorageStrategy::IPFS
                }
            },
        }
    }

    /// 计算存储成本
    pub fn calculate_storage_cost(
        content_data: &ContentData,
        storage_strategy: &StorageStrategy,
    ) -> u64 {
        let text_size = content_data.text.len() as u64;
        let total_media_size: u64 = content_data.media_attachments.iter()
            .map(|m| m.file_size.unwrap_or(0))
            .sum();
        let total_size = text_size + total_media_size;
        
        match storage_strategy {
            StorageStrategy::OnChain => {
                // 链上存储成本较高
                total_size * 1000 // lamports per byte
            },
            StorageStrategy::Arweave => {
                // Arweave 永久存储成本
                total_size * 100 // lamports per byte
            },
            StorageStrategy::IPFS => {
                // IPFS 存储成本较低
                total_size * 10 // lamports per byte
            },
            StorageStrategy::Hybrid => {
                // 混合策略的平均成本
                total_size * 50 // lamports per byte
            },
            StorageStrategy::Custom(_) => {
                // 自定义策略的默认成本
                total_size * 25 // lamports per byte
            },
        }
    }

    /// 生成存储URI
    pub fn generate_storage_uri(
        author: &Pubkey,
        content_id: u64,
        storage_strategy: &StorageStrategy,
    ) -> String {
        match storage_strategy {
            StorageStrategy::OnChain => {
                format!("onchain://{}/{}", author, content_id)
            },
            StorageStrategy::Arweave => {
                format!("arweave://pending/{}/{}", author, content_id)
            },
            StorageStrategy::IPFS => {
                format!("ipfs://pending/{}/{}", author, content_id)
            },
            StorageStrategy::Hybrid => {
                format!("hybrid://{}/{}", author, content_id)
            },
            StorageStrategy::Custom(name) => {
                format!("{}://{}/{}", name, author, content_id)
            },
        }
    }

    /// 验证存储URI格式
    pub fn validate_storage_uri(uri: &str, expected_strategy: &StorageStrategy) -> Result<()> {
        let uri_prefix = match expected_strategy {
            StorageStrategy::OnChain => "onchain://",
            StorageStrategy::Arweave => "arweave://",
            StorageStrategy::IPFS => "ipfs://",
            StorageStrategy::Hybrid => "hybrid://",
            StorageStrategy::Custom(_) => return Ok(()), // 自定义策略跳过严格验证
        };
        
        require!(
            uri.starts_with(uri_prefix),
            AlchemeError::InvalidStorageStrategy
        );
        
        Ok(())
    }

    /// 估算检索速度
    pub fn estimate_retrieval_speed(storage_strategy: &StorageStrategy) -> StorageSpeed {
        match storage_strategy {
            StorageStrategy::OnChain => StorageSpeed::Instant,
            StorageStrategy::IPFS => StorageSpeed::Fast,
            StorageStrategy::Arweave => StorageSpeed::Medium,
            StorageStrategy::Hybrid => StorageSpeed::Fast,
            StorageStrategy::Custom(_) => StorageSpeed::Medium,
        }
    }

    /// 估算持久性评分
    pub fn estimate_durability_score(storage_strategy: &StorageStrategy) -> f64 {
        match storage_strategy {
            StorageStrategy::OnChain => 1.0,      // 最高持久性
            StorageStrategy::Arweave => 0.99,     // 永久存储
            StorageStrategy::IPFS => 0.95,        // 分布式存储
            StorageStrategy::Hybrid => 0.97,      // 混合存储
            StorageStrategy::Custom(_) => 0.9,    // 自定义策略
        }
    }
}

/// 存储迁移管理器
pub struct StorageMigrationManager;

impl StorageMigrationManager {
    /// 计划存储迁移
    pub fn plan_migration(
        current_strategy: &StorageStrategy,
        target_strategy: &StorageStrategy,
        content_size: u64,
    ) -> MigrationPlan {
        let migration_cost = Self::calculate_migration_cost(current_strategy, target_strategy, content_size);
        let estimated_time = Self::estimate_migration_time(current_strategy, target_strategy, content_size);
        let risk_level = Self::assess_migration_risk(current_strategy, target_strategy);
        
        MigrationPlan {
            from_strategy: current_strategy.clone(),
            to_strategy: target_strategy.clone(),
            migration_cost,
            estimated_time_seconds: estimated_time,
            risk_level: risk_level.clone(),
            backup_required: risk_level != MigrationRisk::Low,
            rollback_plan: Self::create_rollback_plan(current_strategy),
        }
    }

    /// 计算迁移成本
    fn calculate_migration_cost(
        from: &StorageStrategy,
        to: &StorageStrategy,
        size: u64,
    ) -> u64 {
        let from_cost = StorageCoordinator::calculate_storage_cost(
            &ContentData {
                content_id: 0,
                author: Pubkey::default(),
                content_type: ContentType::Text,
                text: "x".repeat(size as usize),
                media_attachments: vec![],
                metadata: ContentMetadata {
                    title: None,
                    description: None,
                    tags: vec![],
                    language: None,
                    content_warning: None,
                    expires_at: None,
                },
                created_at: 0,
            },
            from,
        );
        
        let to_cost = StorageCoordinator::calculate_storage_cost(
            &ContentData {
                content_id: 0,
                author: Pubkey::default(),
                content_type: ContentType::Text,
                text: "x".repeat(size as usize),
                media_attachments: vec![],
                metadata: ContentMetadata {
                    title: None,
                    description: None,
                    tags: vec![],
                    language: None,
                    content_warning: None,
                    expires_at: None,
                },
                created_at: 0,
            },
            to,
        );
        
        // 迁移成本 = 新存储成本 + 迁移操作成本
        to_cost + (size * 5) // 5 lamports per byte 迁移成本
    }

    /// 估算迁移时间
    fn estimate_migration_time(
        from: &StorageStrategy,
        to: &StorageStrategy,
        size: u64,
    ) -> u64 {
        let base_time = match (from, to) {
            (StorageStrategy::OnChain, StorageStrategy::Arweave) => 300,    // 5分钟
            (StorageStrategy::OnChain, StorageStrategy::IPFS) => 60,        // 1分钟
            (StorageStrategy::IPFS, StorageStrategy::Arweave) => 600,       // 10分钟
            (StorageStrategy::Arweave, StorageStrategy::IPFS) => 900,       // 15分钟
            _ => 180, // 3分钟默认
        };
        
        // 基于大小调整时间
        let size_factor = (size / 1_000_000).max(1); // 每MB额外时间
        base_time + (size_factor * 30)
    }

    /// 评估迁移风险
    fn assess_migration_risk(
        from: &StorageStrategy,
        to: &StorageStrategy,
    ) -> MigrationRisk {
        match (from, to) {
            // 从永久存储到临时存储：高风险
            (StorageStrategy::Arweave, StorageStrategy::IPFS) => MigrationRisk::High,
            (StorageStrategy::OnChain, StorageStrategy::IPFS) => MigrationRisk::Medium,
            
            // 从临时存储到永久存储：低风险
            (StorageStrategy::IPFS, StorageStrategy::Arweave) => MigrationRisk::Low,
            (StorageStrategy::IPFS, StorageStrategy::OnChain) => MigrationRisk::Low,
            
            // 同类型迁移：中等风险
            _ => MigrationRisk::Medium,
        }
    }

    /// 创建回滚计划
    fn create_rollback_plan(original_strategy: &StorageStrategy) -> RollbackPlan {
        RollbackPlan {
            target_strategy: original_strategy.clone(),
            backup_required: true,
            estimated_rollback_time: 300, // 5分钟
            risk_mitigation_steps: vec![
                "Verify backup integrity".to_string(),
                "Test rollback procedure".to_string(),
                "Monitor system health".to_string(),
            ],
        }
    }
}

/// 迁移计划
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct MigrationPlan {
    pub from_strategy: StorageStrategy,
    pub to_strategy: StorageStrategy,
    pub migration_cost: u64,
    pub estimated_time_seconds: u64,
    pub risk_level: MigrationRisk,
    pub backup_required: bool,
    pub rollback_plan: RollbackPlan,
}

/// 迁移风险
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug, PartialEq)]
pub enum MigrationRisk {
    Low,
    Medium,
    High,
}

/// 回滚计划
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct RollbackPlan {
    pub target_strategy: StorageStrategy,
    pub backup_required: bool,
    pub estimated_rollback_time: u64,
    pub risk_mitigation_steps: Vec<String>,
}

/// 内容缓存管理器
pub struct ContentCacheManager;

impl ContentCacheManager {
    /// 确定是否应该缓存内容
    pub fn should_cache_content(
        content_post: &ContentPost,
        content_stats: &ContentStats,
    ) -> bool {
        // 基于多个因素决定是否缓存
        
        // 1. 高互动内容应该缓存
        let high_engagement = content_stats.engagement_score > 70.0;
        
        // 2. 趋势内容应该缓存
        let trending = content_stats.trending_score > 50.0;
        
        // 3. 最近活跃的内容应该缓存
        let current_time = Clock::get().unwrap().unix_timestamp;
        let recent_activity = (current_time - content_stats.last_updated) < 3600; // 1小时内
        
        // 4. 高质量内容应该缓存
        let high_quality = content_stats.quality_score > 80.0;
        
        high_engagement || trending || recent_activity || high_quality
    }

    /// 计算缓存优先级
    pub fn calculate_cache_priority(
        content_post: &ContentPost,
        content_stats: &ContentStats,
    ) -> CachePriority {
        let mut priority_score = 0.0;
        
        // 基于参与度的优先级
        priority_score += content_stats.engagement_score * 0.3;
        
        // 基于趋势的优先级
        priority_score += content_stats.trending_score * 0.3;
        
        // 基于质量的优先级
        priority_score += content_stats.quality_score * 0.2;
        
        // 基于新鲜度的优先级
        let current_time = Clock::get().unwrap().unix_timestamp;
        let hours_since_creation = (current_time - content_post.created_at) / 3600;
        let freshness_score = match hours_since_creation {
            0..=6 => 100.0,
            7..=24 => 80.0,
            25..=72 => 60.0,
            _ => 40.0,
        };
        priority_score += freshness_score * 0.2;
        
        match priority_score {
            score if score >= 80.0 => CachePriority::High,
            score if score >= 60.0 => CachePriority::Medium,
            score if score >= 40.0 => CachePriority::Low,
            _ => CachePriority::None,
        }
    }

    /// 生成缓存键
    pub fn generate_cache_key(content_id: &Pubkey, cache_type: CacheType) -> String {
        match cache_type {
            CacheType::FullContent => format!("content:full:{}", content_id),
            CacheType::Preview => format!("content:preview:{}", content_id),
            CacheType::Stats => format!("content:stats:{}", content_id),
            CacheType::Metadata => format!("content:metadata:{}", content_id),
        }
    }
}

/// 缓存优先级
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug, PartialEq)]
pub enum CachePriority {
    None,
    Low,
    Medium,
    High,
}

/// 缓存类型
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug, PartialEq)]
pub enum CacheType {
    FullContent,
    Preview,
    Stats,
    Metadata,
}

/// 存储性能监控器
pub struct StoragePerformanceMonitor;

impl StoragePerformanceMonitor {
    /// 记录存储操作性能
    pub fn record_storage_operation(
        storage_strategy: &StorageStrategy,
        operation_type: StorageOperationType,
        content_size: u64,
        duration_ms: u64,
        success: bool,
    ) -> StorageMetrics {
        StorageMetrics {
            strategy: storage_strategy.clone(),
            operation: operation_type,
            content_size,
            duration_ms,
            success,
            timestamp: Clock::get().unwrap().unix_timestamp,
            throughput_bps: if duration_ms > 0 {
                (content_size * 8 * 1000) / duration_ms // bits per second
            } else {
                0
            },
        }
    }

    /// 分析存储性能趋势
    pub fn analyze_performance_trends(
        metrics: &[StorageMetrics],
        time_window: u64,
    ) -> PerformanceTrends {
        let current_time = Clock::get().unwrap().unix_timestamp;
        let relevant_metrics: Vec<_> = metrics.iter()
            .filter(|m| current_time - m.timestamp <= time_window as i64)
            .collect();
        
        if relevant_metrics.is_empty() {
            return PerformanceTrends::default();
        }
        
        let total_operations = relevant_metrics.len() as u64;
        let successful_operations = relevant_metrics.iter()
            .filter(|m| m.success)
            .count() as u64;
        
        let success_rate = (successful_operations as f64 / total_operations as f64) * 100.0;
        
        let average_duration = relevant_metrics.iter()
            .map(|m| m.duration_ms)
            .sum::<u64>() / total_operations;
        
        let average_throughput = relevant_metrics.iter()
            .map(|m| m.throughput_bps)
            .sum::<u64>() / total_operations;
        
        PerformanceTrends {
            total_operations,
            success_rate,
            average_duration_ms: average_duration,
            average_throughput_bps: average_throughput,
            peak_duration_ms: relevant_metrics.iter().map(|m| m.duration_ms).max().unwrap_or(0),
            min_duration_ms: relevant_metrics.iter().map(|m| m.duration_ms).min().unwrap_or(0),
            analysis_window_seconds: time_window,
        }
    }
}

/// 存储操作类型
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug, PartialEq)]
pub enum StorageOperationType {
    Store,
    Retrieve,
    Update,
    Delete,
    Migrate,
}

/// 存储指标
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct StorageMetrics {
    pub strategy: StorageStrategy,
    pub operation: StorageOperationType,
    pub content_size: u64,
    pub duration_ms: u64,
    pub success: bool,
    pub timestamp: i64,
    pub throughput_bps: u64,             // 吞吐量 (bits per second)
}

/// 性能趋势
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct PerformanceTrends {
    pub total_operations: u64,
    pub success_rate: f64,
    pub average_duration_ms: u64,
    pub average_throughput_bps: u64,
    pub peak_duration_ms: u64,
    pub min_duration_ms: u64,
    pub analysis_window_seconds: u64,
}

impl Default for PerformanceTrends {
    fn default() -> Self {
        Self {
            total_operations: 0,
            success_rate: 0.0,
            average_duration_ms: 0,
            average_throughput_bps: 0,
            peak_duration_ms: 0,
            min_duration_ms: 0,
            analysis_window_seconds: 0,
        }
    }
}

/// 内容压缩管理器
pub struct ContentCompressionManager;

impl ContentCompressionManager {
    /// 确定是否应该压缩
    pub fn should_compress_content(
        content_data: &ContentData,
        storage_strategy: &StorageStrategy,
    ) -> bool {
        let content_size = content_data.text.len() + 
                          content_data.media_attachments.iter()
                              .map(|m| m.file_size.unwrap_or(0) as usize)
                              .sum::<usize>();
        
        // 基于大小和策略决定是否压缩
        match storage_strategy {
            StorageStrategy::OnChain => content_size > 512,     // 链上存储，512字节以上压缩
            StorageStrategy::IPFS => content_size > 1024,       // IPFS，1KB以上压缩
            StorageStrategy::Arweave => content_size > 2048,    // Arweave，2KB以上压缩
            StorageStrategy::Hybrid => content_size > 1024,     // 混合策略，1KB以上压缩
            StorageStrategy::Custom(_) => content_size > 1024,  // 自定义策略，1KB以上压缩
        }
    }

    /// 估算压缩比例
    pub fn estimate_compression_ratio(content_type: &ContentType) -> f64 {
        match content_type {
            ContentType::Text => 0.6,       // 文本压缩比60%
            ContentType::Image => 0.8,      // 图片压缩比80%
            ContentType::Video => 0.9,      // 视频压缩比90%
            ContentType::Audio => 0.85,     // 音频压缩比85%
            ContentType::Document => 0.7,   // 文档压缩比70%
            _ => 0.75,                      // 默认压缩比75%
        }
    }
}

// ContentType 扩展方法移动到共享库中实现
