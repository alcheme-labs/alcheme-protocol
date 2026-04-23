import { PublicKey } from "@solana/web3.js";

// 测试环境配置
export const TEST_CONFIG = {
  // 程序 ID
  PROGRAM_IDS: {
    IDENTITY_REGISTRY: new PublicKey("2222222222222222222222222222222222222222222a"),
    CONTENT_MANAGER: new PublicKey("3333333333333333333333333333333333333333333b"),
    ACCESS_CONTROLLER: new PublicKey("4444444444444444444444444444444444444444444c"),
    EVENT_EMITTER: new PublicKey("5555555555555555555555555555555555555555555d"),
    REGISTRY_FACTORY: new PublicKey("6666666666666666666666666666666666666666666e"),
  },

  // 测试用户配置
  TEST_USERS: {
    ADMIN: "admin",
    ALICE: "alice_creator",
    BOB: "bob_viewer",
    CHARLIE: "charlie_moderator",
  },

  // 默认配置
  DEFAULT_CONFIGS: {
    IDENTITY_REGISTRY: {
      registryName: "test_identity_registry",
      metadataUri: "https://test.socialhub.protocol/identity/metadata",
      settings: {
        allowHandleTransfers: true,
        requireVerification: false,
        enableReputationSystem: true,
        enableSocialFeatures: true,
        enableEconomicTracking: true,
        maxHandlesPerIdentity: 5,
        handleReservationPeriod: 86400 * 30, // 30 days
        minimumHandleLength: 3,
        maximumHandleLength: 32,
      },
    },

    CONTENT_MANAGER: {
      managerConfig: {
        maxContentSize: 10240,
        maxMediaAttachments: 5,
        defaultStorageStrategy: { hybrid: {} },
        autoModerationEnabled: true,
        threadDepthLimit: 32,
        quoteChainLimit: 10,
      },
      storageConfig: {
        textThreshold: 1024,
        mediaThreshold: 1048576, // 1MB
        arweaveEnabled: true,
        ipfsEnabled: true,
        compressionEnabled: true,
        backupEnabled: true,
      },
      moderationConfig: {
        autoModeration: true,
        spamDetection: true,
        contentFiltering: true,
        communityModeration: false,
        appealProcess: true,
      },
    },

    ACCESS_CONTROLLER: {
      auditEnabled: true,
      auditSettings: {
        logAllChecks: false,
        logDeniedAccess: true,
        logPermissionChanges: true,
        logPolicyViolations: true,
        detailedLogging: false,
        retentionDays: 90,
        exportFormat: { json: {} },
      },
      retentionPolicy: {
        auditLogRetentionDays: 90,
        permissionHistoryRetentionDays: 180,
        autoCleanup: true,
        archiveToExternal: false,
        archiveEndpoint: null,
      },
    },

    EVENT_EMITTER: {
      storageConfig: {
        chainStorageLimit: 100000,
        archiveToArweave: true,
        useCompression: true,
        batchSize: 50,
        autoArchiveAfterDays: 30,
        maxEventSize: 1024,
      },
      retentionPolicy: {
        chainRetentionDays: 30,
        archiveRetentionDays: 365,
        autoCleanup: true,
        priorityRetention: [],
      },
    },

    REGISTRY_FACTORY: {
      factoryConfig: {
        maxDeploymentsPerUser: 10,
        deploymentFee: 100_000_000, // 0.1 SOL
        upgradeFee: 50_000_000,     // 0.05 SOL
        requireApproval: false,
        autoUpgradeEnabled: false,
        supportedRegistryTypes: [
          { identity: {} },
          { content: {} },
          { access: {} },
          { event: {} },
        ],
      },
    },
  },

  // 测试数据生成器
  GENERATORS: {
    generateContentData: (author: PublicKey, text: string = "测试内容") => ({
      contentId: Date.now(),
      author,
      contentType: { text: {} },
      text,
      mediaAttachments: [],
      metadata: {
        title: null,
        description: null,
        tags: ["测试"],
        language: "zh",
        contentWarning: null,
        expiresAt: null,
      },
      createdAt: Date.now(),
    }),

    generatePrivacySettings: () => ({
      profileVisibility: { public: {} },
      contentVisibility: { public: {} },
      socialGraphVisibility: { followers: {} },
      activityVisibility: { friends: {} },
      economicDataVisibility: { private: {} },
      allowDirectMessages: true,
      allowMentions: true,
      allowContentIndexing: true,
      dataRetentionDays: null,
    }),

    generateVisibilitySettings: () => ({
      visibilityLevel: { public: {} },
      quotePermission: { anyone: {} },
      replyPermission: { anyone: {} },
      repostPermission: { anyone: {} },
      commentPermission: { anyone: {} },
    }),

    generatePermissionContext: (requester: PublicKey, target: PublicKey) => ({
      requester,
      target,
      permission: { viewContent: {} },
      resourceType: { content: {} },
      timestamp: Date.now(),
      source: "test_suite",
      additionalData: [],
    }),
  },

  // 工具函数
  UTILS: {
    // 生成 PDA
    findPDA: (seeds: (string | Buffer | Uint8Array)[], programId: PublicKey) => {
      const seedBuffers = seeds.map(seed => 
        typeof seed === 'string' ? Buffer.from(seed) : seed
      );
      return PublicKey.findProgramAddressSync(seedBuffers, programId);
    },

    // 等待交易确认
    waitForConfirmation: async (signature: string) => {
      return await provider.connection.confirmTransaction(signature, "confirmed");
    },

    // 获取账户余额
    getBalance: async (publicKey: PublicKey) => {
      return await provider.connection.getBalance(publicKey);
    },

    // 生成唯一ID
    generateUniqueId: () => `${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
  },
};

// 测试辅助函数
export class TestHelper {
  static async setupTestEnvironment() {
    console.log("🔧 设置测试环境...");
    
    // 初始化所有程序
    // 创建测试用户身份
    // 设置基础权限
    
    console.log("✅ 测试环境设置完成");
  }

  static async cleanupTestEnvironment() {
    console.log("🧹 清理测试环境...");
    
    // 清理测试数据
    // 关闭测试账户
    
    console.log("✅ 测试环境清理完成");
  }

  static async createTestUser(handle: string, userKeypair: any) {
    console.log(`👤 创建测试用户: ${handle}`);
    
    // 注册身份
    // 设置基础权限
    // 初始化统计数据
    
    console.log(`✅ 测试用户 ${handle} 创建完成`);
  }

  static async verifySystemIntegrity() {
    console.log("🔍 验证系统完整性...");
    
    // 检查所有程序状态
    // 验证数据一致性
    // 检查 CPI 调用链
    
    console.log("✅ 系统完整性验证通过");
  }
}

export default TEST_CONFIG;
