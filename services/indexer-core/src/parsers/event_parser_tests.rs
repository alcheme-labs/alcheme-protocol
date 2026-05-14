#[cfg(test)]
mod tests {
    use crate::parsers::event_parser::{
        build_get_account_info_params,
        content_post_snapshot_target_for_event, project_circle_membership_event,
        project_content_anchor_v2_event, decode_user_identity_account_snapshot,
        project_external_app_receipt_v2_event, project_external_app_registered_v2_event,
        project_identity_registration, EventProjectionContext,
    };
    use crate::database::db_writer::ProjectedUserProfile;
    use alcheme_shared::content::ContentAnchorRelation;
    use alcheme_shared::events::*;
    use alcheme_shared::types::*;
    use borsh::BorshSerialize;
    use solana_sdk::pubkey::Pubkey;

    // ==================== 事件提取测试 ====================

    #[test]
    fn test_extract_event_from_valid_log() {
        // 模拟一个有效的事件日志
        let log = "Program data: dGVzdA=="; // "test" in base64

        // 注意:实际的 Borsh 序列化数据需要是有效的 ProtocolEvent
        // 这里只是测试日志格式识别
        let result = extract_event_prefix(log);
        assert!(result.is_some());
        assert_eq!(result.unwrap(), "dGVzdA==");
    }

    #[test]
    fn test_extract_event_from_invalid_log() {
        let test_cases = vec![
            "Program log: Regular log message",
            "Some random text",
            "",
            "Program data:", // 空数据
        ];

        for log in test_cases {
            let result = extract_event_prefix(log);
            assert!(result.is_none(), "Should not extract from: {}", log);
        }
    }

    // Helper 函数用于测试
    fn extract_event_prefix(log: &str) -> Option<&str> {
        if !log.starts_with("Program data: ") {
            return None;
        }
        log.strip_prefix("Program data: ")
    }

    // ==================== 事件类型识别测试 ====================

    #[test]
    fn test_identity_event_classification() {
        let events = vec![
            ProtocolEvent::IdentityRegistered {
                identity_id: Pubkey::new_unique(),
                handle: "alice".to_string(),
                verification_level: VerificationLevel::Basic,
                timestamp: 1234567890,
                registry_id: Pubkey::new_unique(),
            },
            ProtocolEvent::HandleRegistered {
                handle: "bob".to_string(),
                identity_id: Pubkey::new_unique(),
                is_primary: true,
                timestamp: 1234567890,
            },
        ];

        for event in events {
            let event_type = get_event_category(&event);
            assert_eq!(event_type, "Identity");
        }
    }

    #[test]
    fn test_content_event_classification() {
        let content_event = ProtocolEvent::ContentCreated {
            content_id: Pubkey::new_unique(),
            author: Pubkey::new_unique(),
            content_type: ContentType::Text,
            storage_strategy: StorageStrategy::OnChain,
            visibility: AccessLevel::Public,
            timestamp: 1234567890,
        };

        let event_type = get_event_category(&content_event);
        assert_eq!(event_type, "Content");
    }

    #[test]
    fn test_v2_anchor_event_projection_for_post_upsert() {
        let parent_content = Pubkey::new_unique();
        let projection = project_content_anchor_v2_event(
            42,
            &ContentAnchorRelation::Reply { parent_content },
            &AccessLevel::Public,
            &V2AudienceKind::Public,
            0,
            &ContentStatus::Published,
        );

        assert_eq!(projection.content_id, "42");
        assert_eq!(projection.content_type, "Reply");
        assert_eq!(
            projection.reply_to.as_deref(),
            Some(parent_content.to_string().as_str())
        );
        assert_eq!(
            projection.thread_root.as_deref(),
            Some(parent_content.to_string().as_str())
        );
        assert_eq!(projection.repost_of, None);
        assert_eq!(projection.reply_depth, 1);
        assert_eq!(projection.visibility, "Public");
        assert_eq!(projection.status, "Published");
        assert_eq!(projection.v2_visibility_level, "Public");
        assert_eq!(projection.v2_audience_kind, "Public");
        assert_eq!(projection.v2_audience_ref, None);
        assert_eq!(projection.v2_status, "Published");
        assert!(!projection.is_v2_private);
        assert!(!projection.is_v2_draft);
    }

    #[test]
    fn test_external_app_registered_v2_projection_keeps_hashes_and_tx_evidence() {
        let program_id = Pubkey::new_unique();
        let owner = Pubkey::new_unique();
        let context = EventProjectionContext {
            slot: Some(321),
            signature: Some("registration_signature".to_string()),
        };

        let projection = project_external_app_registered_v2_event(
            Some(program_id),
            [1_u8; 32],
            owner,
            [2_u8; 32],
            [3_u8; 32],
            [4_u8; 32],
            [5_u8; 32],
            9,
            [6_u8; 32],
            [7_u8; 32],
            [8_u8; 32],
            &context,
        );

        assert_eq!(projection.external_app_id, "01".repeat(32));
        assert_eq!(projection.app_id_hash, "01".repeat(32));
        assert_ne!(projection.record_pda, projection.app_id_hash);
        assert_eq!(projection.owner_pubkey, owner.to_string());
        assert_eq!(projection.manifest_hash, "02".repeat(32));
        assert_eq!(projection.server_key_hash, "03".repeat(32));
        assert_eq!(projection.owner_assertion_hash.as_deref(), Some("04".repeat(32).as_str()));
        assert_eq!(projection.policy_state_digest.as_deref(), Some("05".repeat(32).as_str()));
        assert_eq!(projection.review_circle_id, Some(9));
        assert_eq!(projection.review_policy_digest.as_deref(), Some("06".repeat(32).as_str()));
        assert_eq!(projection.decision_digest.as_deref(), Some("07".repeat(32).as_str()));
        assert_eq!(projection.execution_intent_digest.as_deref(), Some("08".repeat(32).as_str()));
        assert_eq!(projection.execution_receipt_digest, None);
        assert_eq!(projection.registry_status, "active");
        assert_eq!(projection.tx_signature.as_deref(), Some("registration_signature"));
        assert_eq!(projection.tx_slot, Some(321));
        assert_eq!(projection.receipt_tx_signature, None);
        assert_eq!(projection.receipt_tx_slot, None);
        assert_eq!(projection.finality_status, "confirmed");
        assert_eq!(projection.receipt_finality_status, "pending");
    }

    #[test]
    fn test_external_app_receipt_v2_projection_only_fills_receipt_evidence() {
        let context = EventProjectionContext {
            slot: Some(654),
            signature: Some("receipt_signature".to_string()),
        };

        let projection = project_external_app_receipt_v2_event(
            None,
            [10_u8; 32],
            [11_u8; 32],
            [12_u8; 32],
            [13_u8; 32],
            &context,
        );

        assert_eq!(projection.external_app_id, "0a".repeat(32));
        assert_eq!(projection.app_id_hash, "0a".repeat(32));
        assert_eq!(projection.record_pda, projection.app_id_hash);
        assert_eq!(projection.owner_pubkey, "");
        assert_eq!(projection.manifest_hash, "");
        assert_eq!(projection.server_key_hash, "");
        assert_eq!(projection.decision_digest.as_deref(), Some("0b".repeat(32).as_str()));
        assert_eq!(projection.execution_intent_digest.as_deref(), Some("0c".repeat(32).as_str()));
        assert_eq!(projection.execution_receipt_digest.as_deref(), Some("0d".repeat(32).as_str()));
        assert_eq!(projection.tx_signature, None);
        assert_eq!(projection.tx_slot, None);
        assert_eq!(projection.receipt_tx_signature.as_deref(), Some("receipt_signature"));
        assert_eq!(projection.receipt_tx_slot, Some(654));
        assert_eq!(projection.finality_status, "pending");
        assert_eq!(projection.receipt_finality_status, "confirmed");
    }

    #[test]
    fn test_v2_anchor_event_projection_for_by_id_relations() {
        let reply_projection = project_content_anchor_v2_event(
            101,
            &ContentAnchorRelation::ReplyById {
                parent_content_id: 88,
            },
            &AccessLevel::Public,
            &V2AudienceKind::Public,
            0,
            &ContentStatus::Published,
        );
        assert_eq!(reply_projection.content_id, "101");
        assert_eq!(reply_projection.content_type, "Reply");
        assert_eq!(reply_projection.reply_to.as_deref(), Some("88"));
        assert_eq!(reply_projection.thread_root.as_deref(), Some("88"));
        assert_eq!(reply_projection.repost_of, None);
        assert_eq!(reply_projection.reply_depth, 1);
        assert_eq!(reply_projection.visibility, "Public");
        assert_eq!(reply_projection.status, "Published");
        assert_eq!(reply_projection.v2_visibility_level, "Public");
        assert_eq!(reply_projection.v2_audience_kind, "Public");
        assert_eq!(reply_projection.v2_audience_ref, None);
        assert_eq!(reply_projection.v2_status, "Published");
        assert!(!reply_projection.is_v2_private);
        assert!(!reply_projection.is_v2_draft);

        let repost_projection = project_content_anchor_v2_event(
            102,
            &ContentAnchorRelation::RepostById {
                original_content_id: 77,
            },
            &AccessLevel::Public,
            &V2AudienceKind::Public,
            0,
            &ContentStatus::Published,
        );
        assert_eq!(repost_projection.content_id, "102");
        assert_eq!(repost_projection.content_type, "Repost");
        assert_eq!(repost_projection.reply_to, None);
        assert_eq!(repost_projection.thread_root, None);
        assert_eq!(repost_projection.repost_of.as_deref(), Some("77"));
        assert_eq!(repost_projection.reply_depth, 0);
        assert_eq!(repost_projection.visibility, "Public");
        assert_eq!(repost_projection.status, "Published");
        assert_eq!(repost_projection.v2_visibility_level, "Public");
        assert_eq!(repost_projection.v2_audience_kind, "Public");
        assert_eq!(repost_projection.v2_audience_ref, None);
        assert_eq!(repost_projection.v2_status, "Published");
        assert!(!repost_projection.is_v2_private);
        assert!(!repost_projection.is_v2_draft);

        let quote_projection = project_content_anchor_v2_event(
            103,
            &ContentAnchorRelation::QuoteById {
                quoted_content_id: 66,
            },
            &AccessLevel::Public,
            &V2AudienceKind::Public,
            0,
            &ContentStatus::Published,
        );
        assert_eq!(quote_projection.content_id, "103");
        assert_eq!(quote_projection.content_type, "Quote");
        assert_eq!(quote_projection.reply_to, None);
        assert_eq!(quote_projection.thread_root, None);
        assert_eq!(quote_projection.repost_of.as_deref(), Some("66"));
        assert_eq!(quote_projection.reply_depth, 0);
        assert_eq!(quote_projection.visibility, "Public");
        assert_eq!(quote_projection.status, "Published");
        assert_eq!(quote_projection.v2_visibility_level, "Public");
        assert_eq!(quote_projection.v2_audience_kind, "Public");
        assert_eq!(quote_projection.v2_audience_ref, None);
        assert_eq!(quote_projection.v2_status, "Published");
        assert!(!quote_projection.is_v2_private);
        assert!(!quote_projection.is_v2_draft);
    }

    #[test]
    fn test_batch9_red_v2_private_draft_projection_requires_raw_fields_for_query_api() {
        let projection = project_content_anchor_v2_event(
            203,
            &ContentAnchorRelation::None,
            &AccessLevel::Private,
            &V2AudienceKind::Private,
            0,
            &ContentStatus::Draft,
        );

        assert_eq!(projection.visibility, "Private");
        assert_eq!(projection.status, "Draft");
        assert_eq!(projection.v2_visibility_level, "Private");
        assert_eq!(projection.v2_audience_kind, "Private");
        assert_eq!(projection.v2_audience_ref, None);
        assert_eq!(projection.v2_status, "Draft");
        assert!(projection.is_v2_private);
        assert!(projection.is_v2_draft);

        let debug_projection = format!("{:?}", projection);
        assert!(
            debug_projection.contains("v2_visibility_level"),
            "expected v2 private visibility raw field for downstream query-api, got: {}",
            debug_projection
        );
        assert!(
            debug_projection.contains("v2_status"),
            "expected v2 draft status raw field for downstream query-api, got: {}",
            debug_projection
        );
    }

    #[test]
    fn test_profile_updated_snapshot_extracts_concrete_protocol_profile_values_from_account_data() {
        let wallet = Pubkey::new_unique();
        let identity_account = Pubkey::new_unique();
        let mut identity = sample_identity(wallet, "alice");
        identity
            .write_protocol_profile(&ProtocolProfile {
                display_name: Some("Alice".to_string()),
                bio: Some("把分散观点炼成可回放的知识。".to_string()),
                avatar_uri: Some("https://cdn.alcheme.test/avatar.png".to_string()),
                banner_uri: Some("https://cdn.alcheme.test/banner.png".to_string()),
                website: Some("https://alcheme.test".to_string()),
                location: Some("Edmonton".to_string()),
                metadata_uri: "ipfs://profile-metadata".to_string(),
                custom_attributes: vec![KeyValue {
                    key: "theme".to_string(),
                    value: "amber".to_string(),
                }],
            })
            .expect("protocol profile should serialize");

        let mut account_data = vec![0u8; 8];
        account_data.extend(identity.try_to_vec().expect("serialize user identity"));

        let snapshot = decode_user_identity_account_snapshot(&identity_account, &account_data)
            .expect("identity account snapshot should decode");

        assert_eq!(snapshot.wallet_pubkey, wallet.to_string());
        assert_eq!(snapshot.handle, "alice".to_string());
        assert_eq!(snapshot.profile.display_name.as_deref(), Some("Alice"));
        assert_eq!(
            snapshot.profile.bio.as_deref(),
            Some("把分散观点炼成可回放的知识。")
        );
        assert_eq!(
            snapshot.profile.avatar_uri.as_deref(),
            Some("https://cdn.alcheme.test/avatar.png")
        );
        assert_eq!(
            snapshot.profile.banner_uri.as_deref(),
            Some("https://cdn.alcheme.test/banner.png")
        );
        assert_eq!(snapshot.profile.website.as_deref(), Some("https://alcheme.test"));
        assert_eq!(snapshot.profile.location.as_deref(), Some("Edmonton"));
        assert_eq!(
            snapshot.profile.metadata_uri.as_deref(),
            Some("ipfs://profile-metadata")
        );
    }

    #[test]
    fn test_get_account_info_params_include_min_context_slot_for_snapshot_consistency() {
        let identity_account = Pubkey::new_unique();
        let params = build_get_account_info_params(&identity_account, Some(912_345));

        assert_eq!(params[0].as_str(), Some(identity_account.to_string().as_str()));
        assert_eq!(params[1]["encoding"].as_str(), Some("base64"));
        assert_eq!(params[1]["commitment"].as_str(), Some("confirmed"));
        assert_eq!(params[1]["minContextSlot"].as_u64(), Some(912_345));
    }

    #[test]
    fn test_v2_anchor_does_not_require_content_snapshot() {
        let event = ProtocolEvent::ContentAnchoredV2 {
            content_id: 7,
            author: Pubkey::new_unique(),
            content_hash: [1u8; 32],
            uri_ref: "ipfs://cid".to_string(),
            relation: ContentAnchorRelation::None,
            visibility: AccessLevel::Public,
            audience_kind: V2AudienceKind::Public,
            audience_ref: 0,
            status: ContentStatus::Published,
            timestamp: 1_700_000_001,
        };

        assert_eq!(content_post_snapshot_target_for_event(&event), None);
    }

    fn sample_identity(wallet: Pubkey, handle: &str) -> UserIdentity {
        UserIdentity {
            identity_id: wallet,
            primary_handle: handle.to_string(),
            alternative_handles: Vec::new(),
            created_at: 1_700_000_000,
            last_active: 1_700_000_000,
            verification_level: VerificationLevel::None,
            verified_attributes: Vec::new(),
            verification_history: Vec::new(),
            follower_count: 0,
            following_count: 0,
            connection_strength: 0.0,
            social_rank: 0,
            content_created: 0,
            total_interactions: 0,
            content_quality_score: 0.0,
            reputation_score: 50.0,
            trust_score: 50.0,
            community_standing: CommunityStanding::NewMember,
            tokens_earned: 0,
            tokens_spent: 0,
            economic_activity_score: 0.0,
            last_economic_activity: 0,
            privacy_settings: PrivacyConfig {
                profile_visibility: AccessLevel::Public,
                content_visibility: AccessLevel::Public,
                social_graph_visibility: AccessLevel::Public,
                activity_visibility: AccessLevel::Public,
                economic_data_visibility: AccessLevel::Public,
                allow_direct_messages: true,
                allow_mentions: true,
                allow_content_indexing: true,
                data_retention_days: None,
            },
            notification_preferences: NotificationConfig::default(),
            display_preferences: DisplayConfig::default(),
            metadata_uri: String::new(),
            custom_attributes: Vec::new(),
            app_specific_data: Vec::new(),
        }
    }

    #[test]
    fn test_v1_content_snapshot_targets_do_not_regress() {
        let created_id = Pubkey::new_unique();
        let updated_id = Pubkey::new_unique();
        let status_id = Pubkey::new_unique();

        let created = ProtocolEvent::ContentCreated {
            content_id: created_id,
            author: Pubkey::new_unique(),
            content_type: ContentType::Text,
            storage_strategy: StorageStrategy::OnChain,
            visibility: AccessLevel::Public,
            timestamp: 1_700_000_002,
        };
        let updated = ProtocolEvent::ContentUpdated {
            content_id: updated_id,
            author: Pubkey::new_unique(),
            updated_fields: vec!["text".to_string()],
            timestamp: 1_700_000_003,
        };
        let status_changed = ProtocolEvent::ContentStatusChanged {
            content_id: status_id,
            old_status: ContentStatus::Draft,
            new_status: ContentStatus::Published,
            changed_by: Pubkey::new_unique(),
            timestamp: 1_700_000_004,
        };

        assert_eq!(
            content_post_snapshot_target_for_event(&created),
            Some(created_id.to_string())
        );
        assert_eq!(
            content_post_snapshot_target_for_event(&updated),
            Some(updated_id.to_string())
        );
        assert_eq!(
            content_post_snapshot_target_for_event(&status_changed),
            Some(status_id.to_string())
        );
    }

    #[test]
    fn test_v2_status_changed_is_classified_as_content_without_snapshot_dependency() {
        let event = ProtocolEvent::ContentStatusChangedV2 {
            content_id: 42,
            old_status: ContentStatus::Draft,
            new_status: ContentStatus::Published,
            changed_by: Pubkey::new_unique(),
            audience_kind: V2AudienceKind::Public,
            audience_ref: 0,
            timestamp: 1_700_000_005,
        };

        assert_eq!(get_event_category(&event), "Content");
        assert_eq!(content_post_snapshot_target_for_event(&event), None);
    }

    #[test]
    fn test_v2_status_changed_route_is_not_missing_from_event_parser() {
        let parser_source = include_str!("event_parser.rs");

        assert!(
            parser_source.contains("ProtocolEvent::ContentStatusChangedV2 {"),
            "expected route_event to handle ContentStatusChangedV2 explicitly"
        );
        assert!(
            parser_source.contains("update_content_status(\n                        &content_id.to_string()")
                || parser_source.contains("update_content_status(\r\n                        &content_id.to_string()"),
            "expected ContentStatusChangedV2 route to write status updates by content_id"
        );
    }

    #[test]
    fn test_v2_anchor_create_and_update_routes_drive_storage_uri_projection() {
        let parser_source = include_str!("event_parser.rs");

        assert!(
            parser_source.contains("ProtocolEvent::ContentAnchoredV2 {"),
            "expected route_event to handle ContentAnchoredV2 explicitly"
        );
        assert!(
            parser_source.contains("Some(uri_ref.as_str()),"),
            "expected v2 create route to project uri_ref into posts.storage_uri"
        );
        assert!(
            parser_source.contains("ProtocolEvent::ContentAnchorUpdatedV2 {"),
            "expected route_event to handle ContentAnchorUpdatedV2 explicitly"
        );
        assert!(
            parser_source.contains(".update_v2_content_anchor("),
            "expected v2 anchor update route to write latest uri_ref into the post row"
        );
    }

    #[test]
    fn test_contributor_proof_bound_route_projects_binding_event() {
        let parser_source = include_str!("event_parser.rs");

        assert!(
            parser_source.contains("ProtocolEvent::ContributorProofBound {"),
            "expected route_event to handle ContributorProofBound explicitly"
        );
        assert!(
            parser_source.contains(".upsert_knowledge_binding("),
            "expected ContributorProofBound route to project binding data into read model"
        );
    }

    #[test]
    fn test_messaging_event_classification() {
        let message_event = ProtocolEvent::MessageSent {
            message_id: Pubkey::new_unique(),
            conversation_id: Pubkey::new_unique(),
            sender: Pubkey::new_unique(),
            message_type: MessageType::Text,
            reply_to: None,
            timestamp: 1234567890,
        };

        let event_type = get_event_category(&message_event);
        assert_eq!(event_type, "Messaging");
    }

    // Helper 函数
    fn get_event_category(event: &ProtocolEvent) -> &'static str {
        match event {
            ProtocolEvent::IdentityRegistered { .. }
            | ProtocolEvent::HandleRegistered { .. }
            | ProtocolEvent::HandleTransferred { .. } => "Identity",

            ProtocolEvent::ContentCreated { .. }
            | ProtocolEvent::ContentUpdated { .. }
            | ProtocolEvent::ContentStatusChanged { .. }
            | ProtocolEvent::ContentStatusChangedV2 { .. } => "Content",

            ProtocolEvent::MessageSent { .. }
            | ProtocolEvent::MessageRead { .. }
            | ProtocolEvent::MessageRecalled { .. }
            | ProtocolEvent::ConversationCreated { .. } => "Messaging",

            ProtocolEvent::FollowAction { .. } | ProtocolEvent::SocialStatsUpdated { .. } => {
                "Social"
            }

            _ => "Other",
        }
    }

    // ==================== 批量处理测试 ====================

    #[test]
    fn test_batch_event_processing_count() {
        let events = vec![
            create_dummy_identity_event(),
            create_dummy_content_event(),
            create_dummy_message_event(),
        ];

        assert_eq!(events.len(), 3);

        // 验证每个事件都有时间戳
        for event in &events {
            assert!(get_event_timestamp(event) > 0);
        }
    }

    #[test]
    fn test_empty_batch_processing() {
        let events: Vec<ProtocolEvent> = vec![];
        assert_eq!(events.len(), 0);
    }

    // ==================== Helper 函数 ====================

    fn create_dummy_identity_event() -> ProtocolEvent {
        ProtocolEvent::IdentityRegistered {
            identity_id: Pubkey::new_unique(),
            handle: "test_user".to_string(),
            verification_level: VerificationLevel::Basic,
            timestamp: 1234567890,
            registry_id: Pubkey::new_unique(),
        }
    }

    fn create_dummy_content_event() -> ProtocolEvent {
        ProtocolEvent::ContentCreated {
            content_id: Pubkey::new_unique(),
            author: Pubkey::new_unique(),
            content_type: ContentType::Text,
            storage_strategy: StorageStrategy::OnChain,
            visibility: AccessLevel::Public,
            timestamp: 1234567891,
        }
    }

    fn create_dummy_message_event() -> ProtocolEvent {
        ProtocolEvent::MessageSent {
            message_id: Pubkey::new_unique(),
            conversation_id: Pubkey::new_unique(),
            sender: Pubkey::new_unique(),
            message_type: MessageType::Text,
            reply_to: None,
            timestamp: 1234567892,
        }
    }

    fn get_event_timestamp(event: &ProtocolEvent) -> i64 {
        match event {
            ProtocolEvent::IdentityRegistered { timestamp, .. }
            | ProtocolEvent::HandleRegistered { timestamp, .. }
            | ProtocolEvent::ContentCreated { timestamp, .. }
            | ProtocolEvent::MessageSent { timestamp, .. }
            | ProtocolEvent::FollowAction { timestamp, .. } => *timestamp,
            _ => 0,
        }
    }

    // ==================== 错误处理测试 ====================

    #[test]
    fn test_malformed_base64_handling() {
        let invalid_base64 = "Program data: !!!invalid!!!";
        let encoded = invalid_base64.strip_prefix("Program data: ").unwrap();

        // base64 解码应该失败
        let result = base64::decode(encoded);
        assert!(result.is_err());
    }

    #[test]
    fn test_pubkey_to_string_conversion() {
        let pubkey = Pubkey::new_unique();
        let pubkey_str = pubkey.to_string();

        // Solana pubkey 应该是 base58 编码,长度通常是 32-44 字符
        assert!(!pubkey_str.is_empty());
        assert!(pubkey_str.len() >= 32);
    }

    // ==================== 事件数据完整性测试 ====================

    #[test]
    fn test_identity_registered_event_fields() {
        let identity_id = Pubkey::new_unique();
        let handle = "alice".to_string();
        let timestamp = 1234567890i64;
        let registry_id = Pubkey::new_unique();

        let event = ProtocolEvent::IdentityRegistered {
            identity_id,
            handle: handle.clone(),
            verification_level: VerificationLevel::Basic,
            timestamp,
            registry_id,
        };

        // 验证字段可以被提取
        match event {
            ProtocolEvent::IdentityRegistered {
                identity_id: id,
                handle: h,
                timestamp: t,
                ..
            } => {
                assert_eq!(id, identity_id);
                assert_eq!(h, handle);
                assert_eq!(t, timestamp);
            }
            _ => panic!("Wrong event type"),
        }
    }

    #[test]
    fn test_identity_registered_projection_prefers_snapshot_profile_over_db_residue() {
        let identity_id = Pubkey::new_unique();
        let projection = project_identity_registration(
            &identity_id,
            "fallback_handle".to_string(),
            Some(crate::parsers::event_parser::ResolvedIdentitySnapshot {
                wallet_pubkey: "wallet_pubkey_123".to_string(),
                handle: "fresh_handle".to_string(),
                profile: ProjectedUserProfile {
                    display_name: None,
                    bio: None,
                    avatar_uri: None,
                    banner_uri: None,
                    website: None,
                    location: None,
                    metadata_uri: None,
                },
            }),
        );

        assert_eq!(projection.wallet_pubkey, "wallet_pubkey_123");
        assert_eq!(projection.handle, "fresh_handle");
        assert_eq!(
            projection.profile,
            Some(ProjectedUserProfile {
                display_name: None,
                bio: None,
                avatar_uri: None,
                banner_uri: None,
                website: None,
                location: None,
                metadata_uri: None,
            })
        );
    }

    #[test]
    fn test_identity_registered_projection_falls_back_when_snapshot_unavailable() {
        let identity_id = Pubkey::new_unique();
        let projection = project_identity_registration(
            &identity_id,
            "fallback_handle".to_string(),
            None,
        );

        assert_eq!(projection.wallet_pubkey, identity_id.to_string());
        assert_eq!(projection.handle, "fallback_handle");
        assert_eq!(projection.profile, None);
    }

    #[test]
    fn test_follow_action_event_variants() {
        use alcheme_shared::events::FollowActionType;

        let actions = vec![
            FollowActionType::Follow,
            FollowActionType::Unfollow,
            FollowActionType::Block,
            FollowActionType::Unblock,
            FollowActionType::Mute,
            FollowActionType::Unmute,
        ];

        // 每个动作类型都应该可以被格式化
        for action in actions {
            let formatted = format!("{:?}", action);
            assert!(!formatted.is_empty());
        }
    }

    // ==================== 交互类型处理测试 ====================

    #[test]
    fn test_interaction_type_mapping() {
        use alcheme_shared::types::InteractionType;

        let interactions = vec![
            (InteractionType::Like, "likes_count"),
            (InteractionType::Share, "shares_count"),
            (InteractionType::Comment, "comments_count"),
        ];

        for (interaction, expected_field) in interactions {
            let field = match interaction {
                InteractionType::Like => "likes_count",
                InteractionType::Share => "shares_count",
                InteractionType::Comment => "comments_count",
                _ => "unknown",
            };
            assert_eq!(field, expected_field);
        }
    }

    #[test]
    fn test_circle_membership_role_change_projection_keeps_active_status_and_derives_pda() {
        let program_id =
            "GZswb1rGbZfoiapkvatDuMZrptVAX2p1pEVDSrMuyLqQ".parse::<Pubkey>().expect("valid pubkey");
        let member = Pubkey::new_unique();
        let projection = project_circle_membership_event(
            Some(program_id),
            7,
            &member,
            &CircleMemberRole::Moderator,
            &CircleMemberStatus::Active,
            &CircleMembershipAction::RoleChanged,
            1_700_000_000,
        );

        assert_eq!(projection.circle_id, 7);
        assert_eq!(projection.member_pubkey, member.to_string());
        assert_eq!(projection.role, "Moderator");
        assert_eq!(projection.status, "Active");
        assert_eq!(projection.changed_at, 1_700_000_000);
        assert!(projection.on_chain_address.is_some());
    }

    #[test]
    fn test_circle_membership_leave_projection_maps_to_left_read_model_status() {
        let member = Pubkey::new_unique();
        let projection = project_circle_membership_event(
            None,
            9,
            &member,
            &CircleMemberRole::Member,
            &CircleMemberStatus::Inactive,
            &CircleMembershipAction::Left,
            1_700_000_111,
        );

        assert_eq!(projection.role, "Member");
        assert_eq!(projection.status, "Left");
        assert_eq!(projection.on_chain_address, None);
    }
}
