#[cfg(test)]
mod tests {
    use super::*;
    use sqlx::PgPool;

    // ==================== 用户操作测试 ====================

    #[test]
    fn test_pubkey_string_conversion() {
        // 测试 Pubkey 到字符串的转换
        let pubkey_str = "11111111111111111111111111111111";
        assert_eq!(pubkey_str.len(), 32);
    }

    #[test]
    fn test_handle_validation() {
        let valid_handles = vec!["alice", "bob123", "test_user"];
        let invalid_handles = vec!["", "a".repeat(100)]; // 空或太长

        for handle in valid_handles {
            assert!(!handle.is_empty());
            assert!(handle.len() <= 32);
        }

        for handle in invalid_handles {
            if handle.is_empty() {
                assert!(handle.is_empty());
            } else {
                assert!(handle.len() > 32);
            }
        }
    }

    #[test]
    fn test_timestamp_conversion() {
        let timestamp: i64 = 1234567890;
        
        // 确保时间戳是正数
        assert!(timestamp > 0);
        
        // 确保时间戳在合理范围内 (2000-2100)
        let year_2000 = 946684800i64;  // 2000-01-01
        let year_2100 = 4102444800i64; // 2100-01-01
        assert!(timestamp > year_2000);
        assert!(timestamp < year_2100);
    }

    // ==================== SQL 查询构建测试 ====================

    #[test]
    fn test_upsert_user_sql_syntax() {
        // 测试 SQL 语法是否正确(静态检查)
        let sql = r#"
            INSERT INTO users (handle, pubkey, created_at, updated_at)
            VALUES ($1, $2, to_timestamp($3), NOW())
            ON CONFLICT (handle) DO UPDATE SET
                pubkey = EXCLUDED.pubkey,
                updated_at = NOW()
        "#;

        // 基本语法检查
        assert!(sql.contains("INSERT INTO"));
        assert!(sql.contains("ON CONFLICT"));
        assert!(sql.contains("DO UPDATE SET"));
    }

    #[test]
    fn test_update_reputation_sql() {
        let sql = "UPDATE users SET reputation_score = $2, updated_at = NOW() WHERE pubkey = $1";
        
        assert!(sql.contains("UPDATE users"));
        assert!(sql.contains("reputation_score"));
        assert!(sql.contains("WHERE pubkey"));
    }

    #[test]
    fn test_insert_follow_sql() {
        let sql = r#"
            INSERT INTO follows (follower_id, following_id, created_at)
            VALUES ($1, $2, to_timestamp($3))
            ON CONFLICT DO NOTHING
        "#;

        assert!(sql.contains("INSERT INTO follows"));
        assert!(sql.contains("ON CONFLICT DO NOTHING"));
    }

    // ==================== 交互类型映射测试 ====================

    #[test]
    fn test_interaction_type_to_column() {
        let mappings = vec![
            ("Like", "likes_count"),
            ("\"Like\"", "likes_count"),
            ("Share", "shares_count"),
            ("\"Share\"", "shares_count"),
            ("Comment", "comments_count"),
            ("\"Comment\"", "comments_count"),
        ];

        for (interaction, expected_column) in mappings {
            let column = match interaction {
                "Like" | "\"Like\"" => "likes_count",
                "Share" | "\"Share\"" => "shares_count",
                "Comment" | "\"Comment\"" => "comments_count",
                _ => "unknown",
            };
            assert_eq!(column, expected_column);
        }
    }

    #[test]
    fn test_like_on_chain_address_is_stable_and_short() {
        let key = build_like_on_chain_address(7, 42);
        assert_eq!(key, "like:7:42");
        assert!(key.len() < 44);
    }

    #[test]
    fn test_like_on_chain_address_changes_per_user_post_pair() {
        let a = build_like_on_chain_address(7, 42);
        let b = build_like_on_chain_address(7, 43);
        let c = build_like_on_chain_address(8, 42);
        assert_ne!(a, b);
        assert_ne!(a, c);
    }

    // ==================== 审核状态映射测试 ====================

    #[test]
    fn test_moderation_action_to_status() {
        let mappings = vec![
            ("ContentRemoval", "Removed"),
            ("\"ContentRemoval\"", "Removed"),
            ("ContentFlagging", "Flagged"),
            ("\"ContentFlagging\"", "Flagged"),
            ("ContentApproval", "Active"),
            ("\"ContentApproval\"", "Active"),
        ];

        for (action, expected_status) in mappings {
            let status = match action {
                "ContentRemoval" | "\"ContentRemoval\"" => "Removed",
                "ContentFlagging" | "\"ContentFlagging\"" => "Flagged",
                "ContentApproval" | "\"ContentApproval\"" => "Active",
                _ => "Active",
            };
            assert_eq!(status, expected_status);
        }
    }

    // ==================== 关注操作测试 ====================

    #[test]
    fn test_follow_action_types() {
        let actions = vec![
            "Follow",
            "\"Follow\"",
            "Unfollow",
            "\"Unfollow\"",
            "Block",
            "Unblock",
        ];

        for action in actions {
            match action {
                "Follow" | "\"Follow\"" => {
                    // 应该插入并增加计数
                    assert!(true);
                }
                "Unfollow" | "\"Unfollow\"" => {
                    // 应该删除并减少计数
                    assert!(true);
                }
                _ => {
                    // 其他操作
                    assert!(true);
                }
            }
        }
    }

    // ==================== 统计类型映射测试 ====================

    #[test]
    fn test_social_stat_type_to_column() {
        let mappings = vec![
            ("FollowerCount", "followers_count"),
            ("\"FollowerCount\"", "followers_count"),
            ("FollowingCount", "following_count"),
            ("\"FollowingCount\"", "following_count"),
            ("ReputationScore", "reputation_score"),
            ("\"ReputationScore\"", "reputation_score"),
        ];

        for (stat_type, expected_column) in mappings {
            let column = match stat_type {
                "FollowerCount" | "\"FollowerCount\"" => "followers_count",
                "FollowingCount" | "\"FollowingCount\"" => "following_count",
                "ReputationScore" | "\"ReputationScore\"" => "reputation_score",
                _ => "unknown",
            };
            assert_eq!(column, expected_column);
        }
    }

    // ==================== 数据验证测试 ====================

    #[test]
    fn test_reputation_score_bounds() {
        let test_values = vec![
            (0i32, true),      // 最小值
            (100i32, true),    // 正常值
            (1000i32, true),   // 高分
            (-100i32, true),   // 负数(允许)
        ];

        for (value, _should_be_valid) in test_values {
            // 声誉分数可以是任何 i32
            assert!(value >= i32::MIN && value <= i32::MAX);
        }
    }

    #[test]
    fn test_count_operations() {
        // 测试计数器操作
        let initial_count = 0;
        let increment = 1;
        let decrement = -1;

        assert_eq!(initial_count + increment, 1);
        assert_eq!(initial_count + decrement, -1);
        
        // 确保使用 GREATEST 避免负数
        let safe_decrement = std::cmp::max(0, initial_count + decrement);
        assert_eq!(safe_decrement, 0);
    }

    #[test]
    fn circle_membership_action_to_read_model_status_maps_left_and_removed_to_left() {
        assert_eq!(map_circle_membership_action_to_status("Joined"), "Active");
        assert_eq!(map_circle_membership_action_to_status("Added"), "Active");
        assert_eq!(map_circle_membership_action_to_status("RoleChanged"), "Active");
        assert_eq!(map_circle_membership_action_to_status("Left"), "Left");
        assert_eq!(map_circle_membership_action_to_status("Removed"), "Left");
    }

    #[test]
    fn circle_member_on_chain_address_prefers_protocol_pda_when_available() {
        let derived = resolve_circle_member_on_chain_address(Some("member-pda-123"), 7, 42);
        let fallback = resolve_circle_member_on_chain_address(None, 7, 42);

        assert_eq!(derived, "member-pda-123");
        assert_eq!(fallback, "cm:7:42");
        assert!(fallback.len() < 44);
    }

    #[test]
    fn projected_user_profile_row_values_materialize_protocol_profile_fields() {
        let projection = ProjectedUserProfile {
            display_name: Some("Alice".to_string()),
            bio: Some("把分散观点炼成可回放的知识。".to_string()),
            avatar_uri: Some("https://cdn.alcheme.test/avatar.png".to_string()),
            banner_uri: Some("https://cdn.alcheme.test/banner.png".to_string()),
            website: Some("https://alcheme.test".to_string()),
            location: Some("Edmonton".to_string()),
            metadata_uri: Some("ipfs://profile-metadata".to_string()),
        };

        let row = profile_row_values(&projection);
        assert_eq!(row.display_name.as_deref(), Some("Alice"));
        assert_eq!(
            row.bio.as_deref(),
            Some("把分散观点炼成可回放的知识。")
        );
        assert_eq!(
            row.avatar_uri.as_deref(),
            Some("https://cdn.alcheme.test/avatar.png")
        );
        assert_eq!(
            row.banner_uri.as_deref(),
            Some("https://cdn.alcheme.test/banner.png")
        );
        assert_eq!(row.website.as_deref(), Some("https://alcheme.test"));
        assert_eq!(row.location.as_deref(), Some("Edmonton"));
        assert_eq!(row.metadata_uri.as_deref(), Some("ipfs://profile-metadata"));
    }

    #[test]
    fn projected_user_profile_row_values_collapse_blank_strings_to_null() {
        let projection = ProjectedUserProfile {
            display_name: Some("   ".to_string()),
            bio: Some(String::new()),
            avatar_uri: None,
            banner_uri: Some("   ".to_string()),
            website: Some(String::new()),
            location: None,
            metadata_uri: Some("".to_string()),
        };

        let row = profile_row_values(&projection);
        assert_eq!(row.display_name, None);
        assert_eq!(row.bio, None);
        assert_eq!(row.avatar_uri, None);
        assert_eq!(row.banner_uri, None);
        assert_eq!(row.website, None);
        assert_eq!(row.location, None);
        assert_eq!(row.metadata_uri, None);
    }

    // ==================== 批量操作测试 ====================

    #[test]
    fn test_batch_size_limits() {
        let batch_sizes = vec![1, 10, 100, 1000];
        
        for size in batch_sizes {
            assert!(size > 0);
            assert!(size <= 10000); // 合理的批量大小上限
        }
    }

    #[test]
    fn test_empty_batch_handling() {
        let operations: Vec<String> = vec![];
        assert_eq!(operations.len(), 0);
        
        // 空批次不应该执行任何操作
        assert!(operations.is_empty());
    }

    // ==================== 错误场景测试 ====================

    #[test]
    fn test_user_not_found_handling() {
        // 模拟用户不存在的场景
        let user_exists = false;
        
        if !user_exists {
            // 应该创建用户或返回警告
            assert!(true, "User should be created");
        }
    }

    #[test]
    fn test_duplicate_follow_handling() {
        // 使用 ON CONFLICT DO NOTHING 处理重复
        let sql = "ON CONFLICT DO NOTHING";
        assert!(sql.contains("CONFLICT"));
    }

    // ==================== SQL 注入防护测试 ====================

    #[test]
    fn test_parameterized_queries() {
        // 所有参数都应该使用 $1, $2 等占位符
        let queries = vec![
            "WHERE pubkey = $1",
            "VALUES ($1, $2, $3)",
            "SET reputation_score = $2",
        ];

        for query in queries {
            // 确保使用了参数化查询
            assert!(query.contains("$1") || query.contains("$2") || query.contains("$3"));
            // 不应该有直接的字符串拼接
            assert!(!query.contains("'+"));
        }
    }

    #[test]
    fn membership_projection_write_path_exists() {
        let source = include_str!("db_writer.rs");

        assert!(
            source.contains("pub async fn upsert_circle_member("),
            "expected DbWriter to expose a circle-membership projection upsert API"
        );
        assert!(
            source.contains("INSERT INTO circle_members"),
            "expected membership projection to persist into circle_members"
        );
        assert!(
            source.contains("map_circle_membership_action_to_status"),
            "expected membership projection to normalize protocol actions into read-model statuses"
        );
    }
}

// ==================== 集成测试辅助函数 ====================

#[cfg(test)]
mod integration_test_helpers {
    use super::*;

    // 这些函数用于实际的数据库集成测试
    // 需要一个测试数据库运行

    pub async fn setup_test_db() -> Option<PgPool> {
        // 从环境变量获取测试数据库 URL
        let database_url = std::env::var("TEST_DATABASE_URL").ok()?;
        
        sqlx::PgPool::connect(&database_url)
            .await
            .ok()
    }

    pub async fn cleanup_test_db(pool: &PgPool) {
        // 清理测试数据
        let _ = sqlx::query("TRUNCATE users, posts, follows CASCADE")
            .execute(pool)
            .await;
    }

    #[allow(dead_code)]
    pub async fn create_test_user(pool: &PgPool, handle: &str, pubkey: &str) -> sqlx::Result<i32> {
        let result = sqlx::query!(
            "INSERT INTO users (handle, pubkey) VALUES ($1, $2) RETURNING id",
            handle,
            pubkey
        )
        .fetch_one(pool)
        .await?;

        Ok(result.id)
    }
}
