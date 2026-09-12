export type ApiSurfaceRuntimeRole =
    | 'PUBLIC_NODE'
    | 'PRIVATE_SIDECAR'
    | 'INTERNAL_OPERATOR';

export type ApiSurfaceDataBoundary =
    | 'public_read'
    | 'private_plaintext'
    | 'private_custody'
    | 'hybrid_verified'
    | 'internal_operator';

export type ApiSurfaceFrontendFallbackTarget =
    | 'public'
    | 'sidecar'
    | 'fail_closed'
    | null;

export type ApiSurfaceAuthGate =
    | 'none'
    | 'session_cookie'
    | 'private_sidecar'
    | 'internal_token'
    | 'websocket_private_sidecar';

export type NodeApiSurface =
    | 'graphql'
    | 'extensions_capabilities'
    | 'membership'
    | 'discussion_protocol'
    | 'policy_profile'
    | 'circle_location_management'
    | 'location_discovery'
    | 'circle_agents'
    | 'posts_bind'
    | 'sync_status'
    | 'communication_runtime'
    | 'communication_sidecar'
    | 'voice_runtime'
    | 'voice_provider_webhook'
    | 'neutral_evaluation_lifecycle'
    | 'trend_prompt_lifecycle'
    | 'auth_session'
    | 'source_materials'
    | 'profile_avatar'
    | 'seeded'
    | 'discussion_runtime'
    | 'collab'
    | 'ghost_draft_private'
    | 'governance_bootstrap'
    | 'governance_execution'
    | 'platform_safety'
    | 'external_program_operator'
    | 'hosted_apps_runtime';

export type ApiSurfaceName = NodeApiSurface | 'ai_operating_layer_internal';

export interface ApiSurfaceContract {
    surface: ApiSurfaceName;
    runtimeRole: ApiSurfaceRuntimeRole;
    dataBoundary: ApiSurfaceDataBoundary;
    routePatterns: string[];
    operationKinds: string[];
    requestDataBoundary: string;
    publicReadable: boolean;
    privateWritable: boolean;
    exposedInCapabilities: boolean;
    frontendFallbackTarget: ApiSurfaceFrontendFallbackTarget;
    authGate: ApiSurfaceAuthGate;
    writerModels: string[];
    frontendSurface: string | null;
    testExpectation: string;
}

const topLevelPrivateSidecarSurfaces = new Set<NodeApiSurface>([
    'communication_sidecar',
    'voice_provider_webhook',
    'auth_session',
    'source_materials',
    'profile_avatar',
    'seeded',
    'discussion_runtime',
    'ghost_draft_private',
    'governance_bootstrap',
    'external_program_operator',
    'hosted_apps_runtime',
]);

export const apiSurfaceContracts: readonly ApiSurfaceContract[] = [
    {
        surface: 'graphql',
        runtimeRole: 'PUBLIC_NODE',
        dataBoundary: 'public_read',
        routePatterns: ['/graphql'],
        operationKinds: ['read', 'resolver_guarded_mutation'],
        requestDataBoundary: 'public reads; private mutations must fail closed in resolvers',
        publicReadable: true,
        privateWritable: false,
        exposedInCapabilities: true,
        frontendFallbackTarget: 'public',
        authGate: 'none',
        writerModels: [],
        frontendSurface: 'graphql',
        testExpectation: 'public GraphQL reads remain public; private mutations keep resolver gates',
    },
    {
        surface: 'extensions_capabilities',
        runtimeRole: 'PUBLIC_NODE',
        dataBoundary: 'public_read',
        routePatterns: ['/extensions/capabilities'],
        operationKinds: ['capability_discovery'],
        requestDataBoundary: 'public node metadata',
        publicReadable: true,
        privateWritable: false,
        exposedInCapabilities: true,
        frontendFallbackTarget: 'public',
        authGate: 'none',
        writerModels: [],
        frontendSurface: 'extensions_capabilities',
        testExpectation: 'node capabilities expose only public and private-sidecar surfaces',
    },
    {
        surface: 'membership',
        runtimeRole: 'PUBLIC_NODE',
        dataBoundary: 'hybrid_verified',
        routePatterns: ['/membership'],
        operationKinds: ['membership_read', 'membership_current_api_write'],
        requestDataBoundary: 'membership runtime rows under current route rules',
        publicReadable: true,
        privateWritable: false,
        exposedInCapabilities: true,
        frontendFallbackTarget: 'public',
        authGate: 'none',
        writerModels: ['Membership'],
        frontendSurface: 'membership',
        testExpectation: 'membership surface remains public-safe',
    },
    {
        surface: 'discussion_protocol',
        runtimeRole: 'PUBLIC_NODE',
        dataBoundary: 'hybrid_verified',
        routePatterns: ['/discussion/circles/:circleId/messages', '/discussion/stream'],
        operationKinds: ['signed_discussion_protocol_read', 'public_stream_read'],
        requestDataBoundary: 'signed protocol/read contract',
        publicReadable: true,
        privateWritable: false,
        exposedInCapabilities: true,
        frontendFallbackTarget: 'public',
        authGate: 'none',
        writerModels: ['DiscussionMessage'],
        frontendSurface: 'discussion_protocol',
        testExpectation: 'public discussion stream stays compatible and omits private signed payloads',
    },
    {
        surface: 'policy_profile',
        runtimeRole: 'PUBLIC_NODE',
        dataBoundary: 'public_read',
        routePatterns: ['/policy'],
        operationKinds: ['policy_metadata_read'],
        requestDataBoundary: 'policy metadata',
        publicReadable: true,
        privateWritable: false,
        exposedInCapabilities: true,
        frontendFallbackTarget: 'public',
        authGate: 'none',
        writerModels: [],
        frontendSurface: 'policy_profile',
        testExpectation: 'policy profile remains public-safe metadata',
    },
    {
        surface: 'circle_agents',
        runtimeRole: 'PUBLIC_NODE',
        dataBoundary: 'public_read',
        routePatterns: ['/circles/:circleId/agents'],
        operationKinds: ['circle_agent_metadata'],
        requestDataBoundary: 'agent metadata',
        publicReadable: true,
        privateWritable: false,
        exposedInCapabilities: true,
        frontendFallbackTarget: 'public',
        authGate: 'none',
        writerModels: ['CircleAgent'],
        frontendSurface: 'circle_agents',
        testExpectation: 'circle agent metadata remains public-safe',
    },
    {
        surface: 'circle_location_management',
        runtimeRole: 'PUBLIC_NODE',
        dataBoundary: 'hybrid_verified',
        routePatterns: [
            '/circle-locations/circles/:circleId/primary-anchor',
            '/circle-locations/circles/:circleId/primary-anchor/archive',
        ],
        operationKinds: ['circle_geo_anchor_manage'],
        requestDataBoundary: 'session and wallet-signed circle location management; no user location custody',
        publicReadable: true,
        privateWritable: false,
        exposedInCapabilities: true,
        frontendFallbackTarget: 'public',
        authGate: 'session_cookie',
        writerModels: [
            'CircleGeoAnchor',
            'CircleGeoAnchorAuditEvent',
            'CircleLocationDiscoveryIndex',
        ],
        frontendSurface: 'circle_location_management',
        testExpectation: 'circle geo anchor management remains public-node safe with session, signature, governance, and audit gates',
    },
    {
        surface: 'location_discovery',
        runtimeRole: 'PUBLIC_NODE',
        dataBoundary: 'public_read',
        routePatterns: ['/location-discovery/nearby'],
        operationKinds: ['nearby_circle_location_read'],
        requestDataBoundary: 'foreground request coordinates in POST body only; coordinates are not persisted or echoed',
        publicReadable: true,
        privateWritable: false,
        exposedInCapabilities: true,
        frontendFallbackTarget: 'public',
        authGate: 'none',
        writerModels: [],
        frontendSurface: 'location_discovery',
        testExpectation: 'nearby location discovery returns public circle anchors without storing or echoing user coordinates',
    },
    {
        surface: 'posts_bind',
        runtimeRole: 'PUBLIC_NODE',
        dataBoundary: 'hybrid_verified',
        routePatterns: ['/posts'],
        operationKinds: ['post_binding'],
        requestDataBoundary: 'post/read-model binding',
        publicReadable: true,
        privateWritable: false,
        exposedInCapabilities: true,
        frontendFallbackTarget: 'public',
        authGate: 'none',
        writerModels: ['Post'],
        frontendSurface: 'posts_bind',
        testExpectation: 'post binding route remains public-safe under current rules',
    },
    {
        surface: 'sync_status',
        runtimeRole: 'PUBLIC_NODE',
        dataBoundary: 'public_read',
        routePatterns: ['/sync/status'],
        operationKinds: ['read_model_status'],
        requestDataBoundary: 'read-model metadata',
        publicReadable: true,
        privateWritable: false,
        exposedInCapabilities: true,
        frontendFallbackTarget: 'public',
        authGate: 'none',
        writerModels: [],
        frontendSurface: 'sync_status',
        testExpectation: 'sync status remains public-readable metadata',
    },
    {
        surface: 'communication_runtime',
        runtimeRole: 'PUBLIC_NODE',
        dataBoundary: 'hybrid_verified',
        routePatterns: ['/communication'],
        operationKinds: ['communication_runtime_read', 'communication_runtime_basic_operation'],
        requestDataBoundary: 'public-safe communication runtime',
        publicReadable: true,
        privateWritable: false,
        exposedInCapabilities: true,
        frontendFallbackTarget: 'public',
        authGate: 'none',
        writerModels: ['CommunicationRoom', 'CommunicationMessage'],
        frontendSurface: 'communication_runtime',
        testExpectation: 'communication runtime reads/basic operations remain public-safe',
    },
    {
        surface: 'voice_runtime',
        runtimeRole: 'PUBLIC_NODE',
        dataBoundary: 'hybrid_verified',
        routePatterns: ['/voice'],
        operationKinds: ['voice_runtime_read', 'voice_runtime_basic_operation'],
        requestDataBoundary: 'public-safe voice runtime',
        publicReadable: true,
        privateWritable: false,
        exposedInCapabilities: true,
        frontendFallbackTarget: 'public',
        authGate: 'none',
        writerModels: ['VoiceSession'],
        frontendSurface: 'voice_runtime',
        testExpectation: 'voice runtime reads/basic operations remain public-safe',
    },
    {
        surface: 'neutral_evaluation_lifecycle',
        runtimeRole: 'PUBLIC_NODE',
        dataBoundary: 'hybrid_verified',
        routePatterns: [
            '/ai/evaluations (subjectType=post create only)',
            '/ai/evaluations/:artifactId/publish (post/public artifact only; draft/source sidecar-gated)',
            '/ai/evaluations/:artifactId/retract (post/public artifact only; draft/source sidecar-gated)',
            '/ai/evaluations/:artifactId/appeals (post/public artifact only; draft/source sidecar-gated)',
            '/ai/evaluations/:artifactId/reviews (post/public artifact only; draft/source sidecar-gated)',
        ],
        operationKinds: [
            'neutral_evaluation_post_create',
            'neutral_evaluation_post_visibility_lifecycle',
            'neutral_evaluation_post_appeal',
            'neutral_evaluation_post_review',
        ],
        requestDataBoundary: 'authorized post/public neutral evaluation lifecycle; draft/source create/read/lifecycle remains router-local sidecar-gated',
        publicReadable: true,
        privateWritable: false,
        exposedInCapabilities: true,
        frontendFallbackTarget: 'public',
        authGate: 'none',
        writerModels: [
            'EvaluationArtifact',
            'EvaluationReview',
            'EvaluationAppeal',
            'AiContextCapsule',
            'AiJob',
        ],
        frontendSurface: 'neutral_evaluation_lifecycle',
        testExpectation: 'neutral post create/lifecycle remains public-authorized while draft/source artifacts remain sidecar-gated',
    },
    {
        surface: 'trend_prompt_lifecycle',
        runtimeRole: 'PUBLIC_NODE',
        dataBoundary: 'hybrid_verified',
        routePatterns: [
            '/ai/trend-prompts',
            '/ai/trend-prompts/:promptId',
        ],
        operationKinds: [
            'trend_prompt_public_seed_request',
            'trend_prompt_status_read',
        ],
        requestDataBoundary: 'authenticated public seed prompt generation; no SourceMaterial or private draft plaintext',
        publicReadable: true,
        privateWritable: false,
        exposedInCapabilities: true,
        frontendFallbackTarget: 'public',
        authGate: 'session_cookie',
        writerModels: [
            'AiJob',
            'AiProposalArtifact',
            'TrendSource',
            'TrendReceipt',
            'TrendPromptCache',
        ],
        frontendSurface: 'trend_prompt_lifecycle',
        testExpectation: 'trend prompt create/read remains a public-authorized product operation with explicit writer-model custody',
    },
    {
        surface: 'communication_sidecar',
        runtimeRole: 'PRIVATE_SIDECAR',
        dataBoundary: 'private_custody',
        routePatterns: ['/communication/rooms/:roomKey/end', '/communication/messages/:envelopeId'],
        operationKinds: ['communication_room_end', 'communication_message_mutation'],
        requestDataBoundary: 'private communication writer boundary',
        publicReadable: false,
        privateWritable: true,
        exposedInCapabilities: true,
        frontendFallbackTarget: null,
        authGate: 'private_sidecar',
        writerModels: ['CommunicationRoom', 'CommunicationMessage'],
        frontendSurface: null,
        testExpectation: 'public node returns private_sidecar_required',
    },
    {
        surface: 'voice_provider_webhook',
        runtimeRole: 'PRIVATE_SIDECAR',
        dataBoundary: 'private_custody',
        routePatterns: ['/voice/providers'],
        operationKinds: ['provider_webhook'],
        requestDataBoundary: 'provider callback/private voice data',
        publicReadable: false,
        privateWritable: true,
        exposedInCapabilities: true,
        frontendFallbackTarget: null,
        authGate: 'private_sidecar',
        writerModels: ['VoiceProviderEvent', 'VoiceSession'],
        frontendSurface: null,
        testExpectation: 'provider webhooks remain sidecar-only',
    },
    {
        surface: 'auth_session',
        runtimeRole: 'PRIVATE_SIDECAR',
        dataBoundary: 'private_custody',
        routePatterns: ['/auth/session'],
        operationKinds: ['session_cookie'],
        requestDataBoundary: 'session cookie/signature custody',
        publicReadable: false,
        privateWritable: true,
        exposedInCapabilities: true,
        frontendFallbackTarget: 'sidecar',
        authGate: 'private_sidecar',
        writerModels: ['AuthSession'],
        frontendSurface: 'auth_session',
        testExpectation: 'auth session route remains private-sidecar-only',
    },
    {
        surface: 'source_materials',
        runtimeRole: 'PRIVATE_SIDECAR',
        dataBoundary: 'private_custody',
        routePatterns: [
            '/circles/:circleId/source-materials',
            '/external-apps/:appId/source-materials',
        ],
        operationKinds: ['source_material_materialization', 'source_material_lifecycle'],
        requestDataBoundary: 'private custody/materialized source data',
        publicReadable: false,
        privateWritable: true,
        exposedInCapabilities: true,
        frontendFallbackTarget: 'sidecar',
        authGate: 'private_sidecar',
        writerModels: ['SourceMaterial', 'SourceMaterialChunk'],
        frontendSurface: 'source_materials',
        testExpectation: 'all SourceMaterial materialization routes fail closed on public nodes',
    },
    {
        surface: 'profile_avatar',
        runtimeRole: 'PRIVATE_SIDECAR',
        dataBoundary: 'private_custody',
        routePatterns: [
            '/users/me/avatar',
            '/users/:handle/avatar',
        ],
        operationKinds: ['profile_avatar_object_upload', 'profile_avatar_public_read'],
        requestDataBoundary: 'profile avatar object bytes; public-safe read projection',
        publicReadable: false,
        privateWritable: true,
        exposedInCapabilities: true,
        frontendFallbackTarget: 'sidecar',
        authGate: 'private_sidecar',
        writerModels: [],
        frontendSurface: 'profile_avatar',
        testExpectation: 'profile avatar object upload and byte read fail closed on public nodes',
    },
    {
        surface: 'seeded',
        runtimeRole: 'PRIVATE_SIDECAR',
        dataBoundary: 'private_custody',
        routePatterns: ['/circles/:circleId/seeded'],
        operationKinds: ['seeded_source_intake'],
        requestDataBoundary: 'private seeded source intake',
        publicReadable: false,
        privateWritable: true,
        exposedInCapabilities: true,
        frontendFallbackTarget: 'sidecar',
        authGate: 'private_sidecar',
        writerModels: ['SeededSource'],
        frontendSurface: 'seeded',
        testExpectation: 'seeded source routes remain private-sidecar-only',
    },
    {
        surface: 'discussion_runtime',
        runtimeRole: 'PRIVATE_SIDECAR',
        dataBoundary: 'private_custody',
        routePatterns: [
            '/discussion/drafts',
            '/discussion/circles/:id/drafts',
            '/discussion/admin',
            '/discussion/sessions',
            '/discussion/stream/export',
            '/discussion/circles/:id/interactions/suggestion-decisions',
            '/revision-directions',
            '/temporary-edit-grants',
            '/storage',
        ],
        operationKinds: ['draft_runtime', 'discussion_admin', 'private_stream_export', 'anchored_suggestion_ai_job', 'temporary_grant', 'storage_upload'],
        requestDataBoundary: 'private draft/discussion runtime',
        publicReadable: false,
        privateWritable: true,
        exposedInCapabilities: true,
        frontendFallbackTarget: 'sidecar',
        authGate: 'private_sidecar',
        writerModels: ['DiscussionDraft', 'AiContextCapsule', 'AiJob', 'TemporaryEditGrant', 'StorageObject'],
        frontendSurface: 'discussion_runtime',
        testExpectation: 'discussion private runtime routes remain private-sidecar-only',
    },
    {
        surface: 'collab',
        runtimeRole: 'PRIVATE_SIDECAR',
        dataBoundary: 'private_custody',
        routePatterns: ['/collab'],
        operationKinds: ['websocket_collaboration'],
        requestDataBoundary: 'WebSocket private collaboration state',
        publicReadable: false,
        privateWritable: true,
        exposedInCapabilities: true,
        frontendFallbackTarget: 'sidecar',
        authGate: 'websocket_private_sidecar',
        writerModels: ['CollabDocument'],
        frontendSurface: 'collab',
        testExpectation: 'public node websocket upgrade returns private_sidecar_required',
    },
    {
        surface: 'ghost_draft_private',
        runtimeRole: 'PRIVATE_SIDECAR',
        dataBoundary: 'private_plaintext',
        routePatterns: [
            '/ai/ghost-drafts',
            '/ai/style-advisor',
            '/style-preferences',
        ],
        operationKinds: [
            'private_plaintext_ai_job',
            'configuration_copilot_private_proposal',
            'configuration_copilot_private_event',
            'settings_text_assist_private_proposal',
            'source_grounded_private_answer',
            'neutral_evaluation_private_artifact',
            'style_advisor_private_proposal',
            'style_advisor_private_event',
            'circle_growth_advisor_private_proposal',
            'circle_growth_advisor_private_action',
            'guardian_finding_private_diagnose',
            'guardian_finding_private_action',
        ],
        requestDataBoundary: 'private plaintext AI task',
        publicReadable: false,
        privateWritable: true,
        exposedInCapabilities: true,
        frontendFallbackTarget: 'sidecar',
        authGate: 'private_sidecar',
        writerModels: [
            'AiJob',
            'GhostDraftGeneration',
            'AiContextCapsule',
            'AiProposalArtifact',
            'AiProposalEvent',
            'SourceGroundedAnswer',
            'EvaluationArtifact',
            'CircleGrowthSignal',
            'CircleEvolutionProposal',
            'CircleEvolutionProposalEvent',
            'GuardianFinding',
            'GuardianFindingEvent',
            'StylePreference',
            'StylePreferenceEvent',
        ],
        frontendSurface: 'ghost_draft_private',
        testExpectation: 'private plaintext AI proposal routes remain private-sidecar-only',
    },
    {
        surface: 'governance_bootstrap',
        runtimeRole: 'PRIVATE_SIDECAR',
        dataBoundary: 'private_custody',
        routePatterns: [
            '/circles/:circleId/governance-bootstrap/ceremony-preview',
            '/circles/:circleId/governance-bootstrap/ceremonies',
        ],
        operationKinds: [
            'governance_bootstrap_preview',
            'governance_bootstrap_signature_open',
            'governance_bootstrap_activation',
            'governance_bootstrap_audit_read',
        ],
        requestDataBoundary: 'session-authenticated Circle owner signature and bootstrap activation custody',
        publicReadable: false,
        privateWritable: true,
        exposedInCapabilities: true,
        frontendFallbackTarget: 'sidecar',
        authGate: 'private_sidecar',
        writerModels: [
            'GovernanceConfigurationBundle',
            'GovernanceBootstrapCeremony',
            'GovernanceBootstrapCeremonyEvent',
            'GovernanceBootstrapDelivery',
            'GovernanceActivationState',
            'GovernanceHomeIdentityBinding',
        ],
        frontendSurface: null,
        testExpectation: 'public nodes reject ceremony signature, activation, and audit routes before Circle router execution',
    },
    {
        surface: 'governance_execution',
        runtimeRole: 'PRIVATE_SIDECAR',
        dataBoundary: 'hybrid_verified',
        routePatterns: [
            '/governance/requests/:requestId/execute',
            '/governance/requests/:requestId/execution-receipts',
            '/governance/cases/:caseId/external-credentials/provider-admission',
            '/governance/circles/:circleId/provider-admission/candidates',
            '/governance/circles/:circleId/provider-admission/candidates/:candidateRef/snapshot',
            '/governance/cases/:caseId/manual-execution/completions',
            '/governance/cases/:caseId/manual-execution/reviews',
            '/circles/:circleId/operation-receipts/:receiptId/appeals',
            '/circles/:circleId/governed-action-appeals/:appealId/resolution',
        ],
        operationKinds: [
            'governance_execution_retry',
            'governance_execution_receipt',
            'governance_external_credential_issue_readback',
            'governance_external_action_candidate_resolve',
            'governance_manual_execution_completion',
            'governance_manual_execution_review',
            'governed_action_appeal_open',
            'governed_action_appeal_resolution',
        ],
        requestDataBoundary: 'private execution receipt/action/appeal evidence custody',
        publicReadable: false,
        privateWritable: true,
        exposedInCapabilities: true,
        frontendFallbackTarget: null,
        authGate: 'private_sidecar',
        writerModels: [
            'GovernanceExecutionReceipt',
            'HostedAppCredential',
            'HostedAppOfflineVerificationBundle',
            'GovernedActionContractVersion',
            'GovernedActionInvocation',
            'ActionAuthorityPolicyBinding',
            'ResolvedActionAuthoritySnapshot',
            'GovernedActionAppeal',
            'AppealResolutionReceipt',
            'OperationEffect',
            'OperationEffectEvent',
        ],
        frontendSurface: null,
        testExpectation: 'governance execution and private appeal evidence keep router-local private sidecar gates',
    },
    {
        surface: 'platform_safety',
        runtimeRole: 'PUBLIC_NODE',
        dataBoundary: 'hybrid_verified',
        routePatterns: [
            '/platform-safety/policy',
            '/platform-safety/bootstrap',
            '/platform-safety/workspace',
            '/platform-safety/quarantines',
        ],
        operationKinds: [
            'public_safety_policy_read',
            'signed_sandbox_role_bootstrap',
            'role_restricted_incident_read',
            'role_restricted_temporary_quarantine',
            'author_or_role_restricted_original_content_read',
        ],
        requestDataBoundary: 'signed US adult demo admission and exact Platform Safety system role binding; public policy projection contains no restricted evidence',
        publicReadable: true,
        privateWritable: false,
        exposedInCapabilities: true,
        frontendFallbackTarget: 'public',
        authGate: 'session_cookie',
        writerModels: [
            'GovernancePolicy',
            'GovernancePolicyVersion',
            'SystemGovernanceRoleBinding',
            'GovernedActionInvocation',
            'OperationReceipt',
            'OperationEffect',
            'OperationEffectEvent',
            'Post',
        ],
        frontendSurface: 'platform_safety',
        testExpectation: 'public feeds hide active quarantines while only the author or bound Platform Safety roles can read original content',
    },
    {
        surface: 'external_program_operator',
        runtimeRole: 'PRIVATE_SIDECAR',
        dataBoundary: 'private_custody',
        routePatterns: [
            '/external-apps/operator',
            '/external-apps/operator/provisioning',
        ],
        operationKinds: [
            'external_program_governance_execution',
            'external_program_provisioning_mutation',
            'external_program_provisioning_health_write',
        ],
        requestDataBoundary: 'private operator custody for External Program execution and provisioning state',
        publicReadable: false,
        privateWritable: true,
        exposedInCapabilities: true,
        frontendFallbackTarget: null,
        authGate: 'private_sidecar',
        writerModels: [
            'GovernanceExecutionReceipt',
            'ExternalAppProvisioningGrant',
            'ExternalAppProvisioningEvent',
        ],
        frontendSurface: null,
        testExpectation: 'External Program operator mutations remain private-sidecar-only and never use admin-token fallback',
    },
    {
        surface: 'hosted_apps_runtime',
        runtimeRole: 'PRIVATE_SIDECAR',
        dataBoundary: 'private_custody',
        routePatterns: [
            '/hosted-apps/:appId/session',
            '/hosted-apps/:appId/query-capability',
            '/hosted-apps/:appId/action-intents',
            '/hosted-apps/:appId/runtime-attestations',
            '/hosted-apps/:appId/offline-verification-bundle',
            '/hosted-apps/:appId/audit-export',
        ],
        operationKinds: [
            'hosted_app_runtime',
            'hosted_app_capability_query',
            'hosted_app_action_intent',
            'hosted_app_signature_intent',
            'hosted_app_grant_publish',
            'hosted_app_audit_export',
            'hosted_app_chain_anchor',
        ],
        requestDataBoundary: 'sandbox runtime capability/action/credential traffic; no public-node direct access',
        publicReadable: false,
        privateWritable: true,
        exposedInCapabilities: true,
        frontendFallbackTarget: 'sidecar',
        authGate: 'private_sidecar',
        writerModels: [
            'HostedAppAccessReceipt',
            'HostedAppActionReceipt',
            'HostedAppAuditExportBundle',
            'HostedAppCredential',
            'HostedAppGovernanceDecisionReceipt',
            'HostedAppUserConsent',
        ],
        frontendSurface: 'hosted_apps_runtime',
        testExpectation: 'hosted app runtime remains disabled by default and private-sidecar-only when enabled',
    },
    {
        surface: 'ai_operating_layer_internal',
        runtimeRole: 'INTERNAL_OPERATOR',
        dataBoundary: 'internal_operator',
        routePatterns: ['/ai-operating-layer/internal'],
        operationKinds: ['operator_task_enqueue', 'operator_proposal_review'],
        requestDataBoundary: 'internal operator/private proposal operations',
        publicReadable: false,
        privateWritable: true,
        exposedInCapabilities: false,
        frontendFallbackTarget: null,
        authGate: 'internal_token',
        writerModels: ['AiProposalArtifact', 'AiRuntimeTask'],
        frontendSurface: null,
        testExpectation: 'internal operator routes require INTERNAL_API_TOKEN and are not public capabilities',
    },
];

function isNodeApiSurface(surface: ApiSurfaceName): surface is NodeApiSurface {
    return surface !== 'ai_operating_layer_internal';
}

export const publicNodeSafeApis: NodeApiSurface[] = apiSurfaceContracts
    .filter((contract) =>
        contract.exposedInCapabilities
        && contract.runtimeRole === 'PUBLIC_NODE'
        && contract.publicReadable
        && isNodeApiSurface(contract.surface),
    )
    .map((contract) => contract.surface as NodeApiSurface);

export const sidecarOwnedApis: NodeApiSurface[] = apiSurfaceContracts
    .filter((contract) =>
        contract.exposedInCapabilities
        && contract.runtimeRole === 'PRIVATE_SIDECAR'
        && contract.privateWritable
        && isNodeApiSurface(contract.surface),
    )
    .map((contract) => contract.surface as NodeApiSurface);

function escapeRegexSegment(segment: string): string {
    return segment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function routePatternToRegExp(pattern: string): RegExp {
    const normalized = pattern.replace(/\/+$/, '') || '/';
    const source = normalized
        .split('/')
        .map((segment, index) => {
            if (index === 0) return '';
            return segment.startsWith(':') ? '[^/]+' : escapeRegexSegment(segment);
        })
        .join('\\/');
    return new RegExp(`^${source}(?:\\/|$)`);
}

export const sidecarHttpRouteMatchers: Array<{
    route: NodeApiSurface;
    pattern: RegExp;
}> = apiSurfaceContracts
    .filter((contract) =>
        isNodeApiSurface(contract.surface)
        && topLevelPrivateSidecarSurfaces.has(contract.surface)
        && contract.authGate === 'private_sidecar',
    )
    .flatMap((contract) =>
        contract.routePatterns.map((routePattern) => ({
            route: contract.surface as NodeApiSurface,
            pattern: routePatternToRegExp(routePattern),
        })),
    );
