import * as anchor from "@coral-xyz/anchor";
import { PublicKey, Keypair, SystemProgram } from "@solana/web3.js";
import TEST_CONFIG, { TestHelper } from "./test-config";

/**
 * 测试环境设置脚本
 * 用于初始化所有程序和创建测试数据
 */

async function setupTestEnvironment() {
  console.log("🚀 开始设置 Alcheme Protocol 测试环境...");

  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  // 获取程序实例
  const programs = {
    identityRegistry: anchor.workspace.IdentityRegistry,
    contentManager: anchor.workspace.ContentManager,
    accessController: anchor.workspace.AccessController,
    eventEmitter: anchor.workspace.EventEmitter,
    registryFactory: anchor.workspace.RegistryFactory,
  };

  // 创建测试用户
  const users = {
    admin: Keypair.generate(),
    alice: Keypair.generate(),
    bob: Keypair.generate(),
    charlie: Keypair.generate(),
  };

  console.log("👥 测试用户公钥:");
  Object.entries(users).forEach(([name, keypair]) => {
    console.log(`  ${name}: ${keypair.publicKey.toString()}`);
  });

  try {
    // 1. 空投测试资金
    console.log("\n💰 空投测试资金...");
    await Promise.all(
      Object.values(users).map(async (user) => {
        const signature = await provider.connection.requestAirdrop(
          user.publicKey,
          2 * anchor.web3.LAMPORTS_PER_SOL
        );
        await provider.connection.confirmTransaction(signature);
      })
    );
    console.log("✅ 测试资金空投完成");

    // 2. 初始化所有程序
    console.log("\n🔧 初始化核心程序...");

    // 初始化 Identity Registry
    console.log("  📝 初始化 Identity Registry...");
    const [identityRegistryPDA] = PublicKey.findProgramAddressSync(
      [Buffer.from("identity_registry"), Buffer.from(TEST_CONFIG.DEFAULT_CONFIGS.IDENTITY_REGISTRY.registryName)],
      TEST_CONFIG.PROGRAM_IDS.IDENTITY_REGISTRY
    );

    await programs.identityRegistry.methods
      .initializeIdentityRegistry(
        TEST_CONFIG.DEFAULT_CONFIGS.IDENTITY_REGISTRY.registryName,
        TEST_CONFIG.DEFAULT_CONFIGS.IDENTITY_REGISTRY.metadataUri,
        TEST_CONFIG.DEFAULT_CONFIGS.IDENTITY_REGISTRY.settings
      )
      .accounts({
        identityRegistry: identityRegistryPDA,
        admin: users.admin.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([users.admin])
      .rpc();

    // 初始化 Access Controller
    console.log("  🔐 初始化 Access Controller...");
    const [accessControllerPDA] = PublicKey.findProgramAddressSync(
      [Buffer.from("access_controller")],
      TEST_CONFIG.PROGRAM_IDS.ACCESS_CONTROLLER
    );

    await programs.accessController.methods
      .initializeAccessController()
      .accounts({
        accessController: accessControllerPDA,
        admin: users.admin.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([users.admin])
      .rpc();

    // 初始化 Event Emitter
    console.log("  📡 初始化 Event Emitter...");
    const [eventEmitterPDA] = PublicKey.findProgramAddressSync(
      [Buffer.from("event_emitter")],
      TEST_CONFIG.PROGRAM_IDS.EVENT_EMITTER
    );

    await programs.eventEmitter.methods
      .initializeEventEmitter(
        TEST_CONFIG.DEFAULT_CONFIGS.EVENT_EMITTER.storageConfig,
        TEST_CONFIG.DEFAULT_CONFIGS.EVENT_EMITTER.retentionPolicy
      )
      .accounts({
        eventEmitter: eventEmitterPDA,
        admin: users.admin.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([users.admin])
      .rpc();

    // 初始化 Content Manager
    console.log("  📱 初始化 Content Manager...");
    const [contentManagerPDA] = PublicKey.findProgramAddressSync(
      [Buffer.from("content_manager")],
      TEST_CONFIG.PROGRAM_IDS.CONTENT_MANAGER
    );

    await programs.contentManager.methods
      .initializeContentManager(
        TEST_CONFIG.DEFAULT_CONFIGS.CONTENT_MANAGER.managerConfig,
        TEST_CONFIG.DEFAULT_CONFIGS.CONTENT_MANAGER.storageConfig,
        TEST_CONFIG.DEFAULT_CONFIGS.CONTENT_MANAGER.moderationConfig
      )
      .accounts({
        contentManager: contentManagerPDA,
        admin: users.admin.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([users.admin])
      .rpc();

    // 初始化 Registry Factory
    console.log("  🏭 初始化 Registry Factory...");
    const [registryFactoryPDA] = PublicKey.findProgramAddressSync(
      [Buffer.from("registry_factory")],
      TEST_CONFIG.PROGRAM_IDS.REGISTRY_FACTORY
    );

    await programs.registryFactory.methods
      .initializeRegistryFactory(TEST_CONFIG.DEFAULT_CONFIGS.REGISTRY_FACTORY.factoryConfig)
      .accounts({
        registryFactory: registryFactoryPDA,
        admin: users.admin.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([users.admin])
      .rpc();

    console.log("✅ 所有程序初始化完成");

    // 3. 创建测试用户身份
    console.log("\n👤 创建测试用户身份...");
    
    const testUsers = [
      { keypair: users.alice, handle: TEST_CONFIG.TEST_USERS.ALICE },
      { keypair: users.bob, handle: TEST_CONFIG.TEST_USERS.BOB },
      { keypair: users.charlie, handle: TEST_CONFIG.TEST_USERS.CHARLIE },
    ];

    for (const { keypair, handle } of testUsers) {
      console.log(`  创建用户: ${handle}`);
      
      const [userIdentityPDA] = PublicKey.findProgramAddressSync(
        [
          Buffer.from("user_identity"),
          identityRegistryPDA.toBuffer(),
          Buffer.from(handle),
        ],
        TEST_CONFIG.PROGRAM_IDS.IDENTITY_REGISTRY
      );

      const [handleMappingPDA] = PublicKey.findProgramAddressSync(
        [Buffer.from("handle_mapping"), Buffer.from(handle)],
        TEST_CONFIG.PROGRAM_IDS.IDENTITY_REGISTRY
      );

      await programs.identityRegistry.methods
        .registerIdentity(handle, TEST_CONFIG.GENERATORS.generatePrivacySettings())
        .accounts({
          identityRegistry: identityRegistryPDA,
          userIdentity: userIdentityPDA,
          handleMapping: handleMappingPDA,
          user: keypair.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .signers([keypair])
        .rpc();
    }

    console.log("✅ 测试用户身份创建完成");

    // 4. 设置基础权限
    console.log("\n🔑 设置基础权限配置...");
    
    // 为所有用户设置基础内容创建权限
    for (const { keypair, handle } of testUsers) {
      const defaultRule = {
        ruleId: `${handle}_default_permissions`,
        permission: { createContent: {} },
        accessLevel: { public: {} },
        conditions: null,
        exceptions: [],
        priority: 50,
        enabled: true,
        createdAt: Date.now(),
        expiresAt: null,
      };

      await programs.accessController.methods
        .setAccessRules(keypair.publicKey, { createContent: {} }, defaultRule)
        .accounts({
          accessController: accessControllerPDA,
          user: keypair.publicKey,
        })
        .signers([keypair])
        .rpc();
    }

    console.log("✅ 基础权限配置完成");

    // 5. 验证系统完整性
    console.log("\n🔍 验证系统完整性...");
    await TestHelper.verifySystemIntegrity();

    // 6. 保存测试环境信息
    const testEnvironmentInfo = {
      setupTime: new Date().toISOString(),
      programIds: TEST_CONFIG.PROGRAM_IDS,
      users: Object.fromEntries(
        Object.entries(users).map(([name, keypair]) => [name, keypair.publicKey.toString()])
      ),
      pdas: {
        identityRegistry: identityRegistryPDA.toString(),
        accessController: accessControllerPDA.toString(),
        eventEmitter: eventEmitterPDA.toString(),
        contentManager: contentManagerPDA.toString(),
        registryFactory: registryFactoryPDA.toString(),
      },
    };

    console.log("\n📋 测试环境信息:");
    console.log(JSON.stringify(testEnvironmentInfo, null, 2));

    console.log("\n🎉 测试环境设置完成！");
    console.log("现在可以运行测试了:");
    console.log("  npm run test:unit     - 运行单元测试");
    console.log("  npm run test:integration - 运行集成测试");
    console.log("  npm run test:all      - 运行所有测试");

  } catch (error) {
    console.error("❌ 测试环境设置失败:", error);
    throw error;
  }
}

// 如果直接运行此脚本
if (require.main === module) {
  setupTestEnvironment()
    .then(() => {
      console.log("✅ 测试环境设置脚本执行完成");
      process.exit(0);
    })
    .catch((error) => {
      console.error("❌ 测试环境设置失败:", error);
      process.exit(1);
    });
}

export { setupTestEnvironment };
