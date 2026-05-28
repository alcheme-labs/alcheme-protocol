import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { PublicKey, Keypair, SystemProgram } from "@solana/web3.js";
import { expect } from "chai";
import BN from "bn.js";
import fs from "fs";
import path from "path";
import EventTestHelper from "../../../tests/utils/event-test-helper";

type ContributionEngine = any;
type IdentityRegistry = any;
type RegistryFactory = any;

/**
 * Direction 3: 跨程序 CPI 集成测试
 *
 * 测试 contribution-engine::settle_reputation 通过 CPI 调用
 * identity-registry::update_reputation_by_extension 的完整流程。
 *
 * 策略：由于 Anchor test 在同一进程中运行所有测试文件（共享链上状态），
 * 本测试不依赖其他测试的初始化结果。对于单例 PDA（如 ContributionConfig），
 * 先尝试读取现有状态；若不存在则自行初始化。
 * 通过 fetch 现有 config 的 admin 来获取实际的 admin 公钥，
 * 并使用独立的 crystalId/handle 避免与其他测试冲突。
 */
describe("CPI Integration Tests: contribution-engine → identity-registry", () => {
    const provider = anchor.AnchorProvider.env();
    anchor.setProvider(provider);

    // Programs
    const ceProgram = anchor.workspace.ContributionEngine as Program<ContributionEngine>;
    const irProgram = anchor.workspace.IdentityRegistry as Program<IdentityRegistry>;
    const rfProgram = anchor.workspace.RegistryFactory as Program<RegistryFactory>;

    // We'll resolve the actual admin dynamically
    let admin: Keypair;
    const contributor = Keypair.generate();

    // Crystal ID — unique to this test
    const crystalId = Keypair.generate().publicKey;
    const uniqueTs = Date.now();

    // Identity config — unique names to avoid collision
    const registryName = `cpi_ir_${uniqueTs}`;
    const handle = `cpi_u_${uniqueTs}`;

    // PDA containers
    let configPda: PublicKey;
    let ledgerPda: PublicKey;
    let entryPda: PublicKey;
    let identityRegistryPda: PublicKey;
    let userIdentityPda: PublicKey;
    let handleMappingPda: PublicKey;
    let extensionRegistryPda: PublicKey;
    let factoryPda: PublicKey;

    // Flags to track whether we need to initialize programs ourselves
    let ceNeedsInit = false;
    let rfNeedsInit = false;
    let extRegNeedsInit = false;

    // ==================== PDA helpers ====================

    function findLedgerPda(crystal: PublicKey): PublicKey {
        return PublicKey.findProgramAddressSync(
            [Buffer.from("ledger"), crystal.toBuffer()],
            ceProgram.programId
        )[0];
    }

    function findEntryPda(crystal: PublicKey, contributorKey: PublicKey): PublicKey {
        return PublicKey.findProgramAddressSync(
            [Buffer.from("entry"), crystal.toBuffer(), contributorKey.toBuffer()],
            ceProgram.programId
        )[0];
    }

    function permissionLabel(permission: any): string {
        const [label] = Object.keys(permission || {});
        return label || "unknown";
    }

    async function setContributionEnginePermissions(permissions: any[]): Promise<void> {
        const extRegistry = await rfProgram.account.extensionRegistryAccount.fetch(extensionRegistryPda);
        const inner = extRegistry.inner || extRegistry;
        const extensions = inner.extensions || [];
        const existing = extensions.find(
            (ext: any) => ext.programId.toString() === ceProgram.programId.toString()
        );

        if (!existing) {
            await rfProgram.methods
                .registerExtension(ceProgram.programId, permissions)
                .accounts({
                    extensionRegistry: extensionRegistryPda,
                    admin: admin.publicKey,
                })
                .signers([admin])
                .rpc();
            return;
        }

        await rfProgram.methods
            .updateExtensionPermissions(ceProgram.programId, permissions)
            .accounts({
                extensionRegistry: extensionRegistryPda,
                admin: admin.publicKey,
            })
            .signers([admin])
            .rpc();
    }

    async function getContributionEnginePermissionLabels(): Promise<string[]> {
        const extRegistry = await rfProgram.account.extensionRegistryAccount.fetch(extensionRegistryPda);
        const inner = extRegistry.inner || extRegistry;
        const extensions = inner.extensions || [];
        const existing = extensions.find(
            (ext: any) => ext.programId.toString() === ceProgram.programId.toString()
        );
        if (!existing) return [];
        return existing.permissions.map(permissionLabel).sort();
    }

    function loadManifestPermissionLabels(): string[] {
        const manifestPath = path.resolve(__dirname, "../extension.manifest.json");
        const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
        return [...(manifest.required_permissions || [])].sort();
    }

    // ==================== Boot-strap ====================

    before(async () => {
        // Compute deterministic PDAs
        configPda = PublicKey.findProgramAddressSync(
            [Buffer.from("config")],
            ceProgram.programId
        )[0];

        [factoryPda] = PublicKey.findProgramAddressSync(
            [Buffer.from("registry_factory")],
            rfProgram.programId
        );

        [extensionRegistryPda] = PublicKey.findProgramAddressSync(
            [Buffer.from("extension_registry")],
            rfProgram.programId
        );

        ledgerPda = findLedgerPda(crystalId);
        entryPda = findEntryPda(crystalId, contributor.publicKey);

        // ---- Discover existing admin ----
        // Try to read ContributionConfig to see if it already exists
        // and if so, who the admin is. This determines whether we can reuse it.
        let existingConfigAdmin: PublicKey | null = null;
        try {
            const cfg = await ceProgram.account.contributionConfig.fetch(configPda);
            existingConfigAdmin = cfg.admin;
            console.log(`🔍 ContributionConfig 已存在, admin=${existingConfigAdmin.toString().slice(0, 8)}...`);
        } catch {
            ceNeedsInit = true;
            console.log("🔍 ContributionConfig 不存在, 需要自行初始化");
        }

        // RegistryFactory
        let existingFactoryAdmin: PublicKey | null = null;
        try {
            const factoryAccount = await rfProgram.account.registryFactoryAccount.fetch(factoryPda);
            const inner = factoryAccount.inner || factoryAccount;
            existingFactoryAdmin = inner.admin;
            console.log(`🔍 RegistryFactory 已存在, admin=${existingFactoryAdmin.toString().slice(0, 8)}...`);
        } catch {
            rfNeedsInit = true;
            console.log("🔍 RegistryFactory 不存在, 需要自行初始化");
        }

        // ExtensionRegistry
        try {
            await rfProgram.account.extensionRegistryAccount.fetch(extensionRegistryPda);
            console.log("🔍 ExtensionRegistry 已存在");
        } catch {
            extRegNeedsInit = true;
            console.log("🔍 ExtensionRegistry 不存在, 需要自行初始化");
        }

        // Use provider.wallet.payer as admin — same across all test files in the
        // Anchor test process. Unit tests also use this keypair, guaranteeing
        // consistent ownership of singleton PDAs like ContributionConfig & RegistryFactory.
        admin = (provider.wallet as any).payer as Keypair;

        // Airdrop to contributor
        await provider.connection.confirmTransaction(
            await provider.connection.requestAirdrop(contributor.publicKey, 5 * anchor.web3.LAMPORTS_PER_SOL)
        );

        // Identity Registry PDAs (unique to this test via registryName)
        [identityRegistryPda] = PublicKey.findProgramAddressSync(
            [Buffer.from("identity_registry"), Buffer.from(registryName)],
            irProgram.programId
        );

        [userIdentityPda] = PublicKey.findProgramAddressSync(
            [Buffer.from("user_identity"), identityRegistryPda.toBuffer(), Buffer.from(handle)],
            irProgram.programId
        );

        [handleMappingPda] = PublicKey.findProgramAddressSync(
            [Buffer.from("handle_mapping"), Buffer.from(handle)],
            irProgram.programId
        );
    });

    // ==================== Setup ====================

    describe("跨程序 Setup", () => {
        it("Step 1: 初始化 EventEmitter", async () => {
            await EventTestHelper.init();
            try {
                await EventTestHelper.initializeEventEmitter(admin);
            } catch (e: any) {
                // Already initialized by another test suite
                if (e.message?.includes("already in use") || e.message?.includes("custom program error")) {
                    console.log("⚠️  EventEmitter 已由其他测试初始化");
                } else {
                    throw e;
                }
            }
            console.log("✅ EventEmitter 就绪");
        });

        it("Step 2: 初始化 RegistryFactory", async () => {
            if (!rfNeedsInit) {
                // Already exists — check if admin matches
                const factoryAccount = await rfProgram.account.registryFactoryAccount.fetch(factoryPda);
                const inner = factoryAccount.inner || factoryAccount;
                if (inner.admin.toString() !== admin.publicKey.toString()) {
                    // Admin mismatch. We can't use this factory for ExtensionRegistry init.
                    // We'll need to handle this in Step 3.
                    console.log("⚠️  RegistryFactory 已存在但 admin 不匹配 — 将跳过 ExtensionRegistry admin 检查");
                }
                console.log("⚠️  RegistryFactory 已存在，跳过初始化");
                return;
            }

            const factoryConfig = {
                maxDeploymentsPerUser: 10,
                deploymentFee: new BN(1_000_000),
                upgradeFee: new BN(500_000),
                requireApproval: false,
                autoUpgradeEnabled: true,
                supportedRegistryTypes: [
                    { identity: {} },
                    { content: {} },
                    { access: {} },
                    { event: {} },
                ],
            };

            await rfProgram.methods
                .initializeRegistryFactory(factoryConfig)
                .accounts({
                    registryFactory: factoryPda,
                    admin: admin.publicKey,
                    systemProgram: SystemProgram.programId,
                })
                .signers([admin])
                .rpc();

            console.log("✅ RegistryFactory 初始化成功");
        });

        it("Step 3: 初始化 ExtensionRegistry", async function () {
            if (!extRegNeedsInit) {
                console.log("⚠️  ExtensionRegistry 已存在，跳过初始化");
                return;
            }

            // Check factoryPda admin — if it's not us, we can't initialize ExtensionRegistry
            const factoryAccount = await rfProgram.account.registryFactoryAccount.fetch(factoryPda);
            const inner = factoryAccount.inner || factoryAccount;

            if (inner.admin.toString() !== admin.publicKey.toString()) {
                console.log("⚠️  RegistryFactory admin 不匹配, 无法初始化 ExtensionRegistry");
                console.log("   factory.admin:", inner.admin.toString().slice(0, 12));
                console.log("   our admin:    ", admin.publicKey.toString().slice(0, 12));
                this.skip();
                return;
            }

            await rfProgram.methods
                .initializeExtensionRegistry(10)
                .accounts({
                    extensionRegistry: extensionRegistryPda,
                    registryFactory: factoryPda,
                    admin: admin.publicKey,
                    systemProgram: SystemProgram.programId,
                })
                .signers([admin])
                .rpc();

            console.log("✅ ExtensionRegistry 初始化成功");
        });

        it("Step 4: 注册 contribution-engine 为扩展并收敛到唯一权限 (ReputationWrite)", async function () {
            try {
                const extRegistry = await rfProgram.account.extensionRegistryAccount.fetch(extensionRegistryPda);
                const inner = extRegistry.inner || extRegistry;
                if (inner.admin.toString() !== admin.publicKey.toString()) {
                    console.log("⚠️  ExtensionRegistry admin 不匹配, 无法注册扩展");
                    this.skip();
                    return;
                }
            } catch {
                console.log("⚠️  ExtensionRegistry 不存在, 无法注册扩展");
                this.skip();
                return;
            }

            await setContributionEnginePermissions([{ reputationWrite: {} }]);

            const effectivePermissions = await getContributionEnginePermissionLabels();
            expect(effectivePermissions).to.deep.equal(["reputationWrite"]);

            console.log("✅ contribution-engine 权限已收敛到 ReputationWrite");
        });

        it("Step 4b: manifest 权限声明与已证明权限集合一致", async function () {
            const extRegistry = await rfProgram.account.extensionRegistryAccount.fetch(extensionRegistryPda);
            const inner = extRegistry.inner || extRegistry;
            if (inner.admin.toString() !== admin.publicKey.toString()) {
                this.skip();
                return;
            }

            const manifestPermissions = loadManifestPermissionLabels();
            const registeredPermissions = await getContributionEnginePermissionLabels();

            expect(manifestPermissions).to.deep.equal(["ReputationWrite"]);
            expect(registeredPermissions).to.deep.equal(["reputationWrite"]);
        });

        it("Step 5: 初始化 IdentityRegistry", async () => {
            const metadataUri = "https://test.example.com/cpi-test";
            const settings = {
                allowHandleTransfers: true,
                requireVerification: false,
                enableReputationSystem: true,
                enableSocialFeatures: true,
                enableEconomicTracking: true,
                maxHandlesPerIdentity: new BN(5),
                handleReservationPeriod: new BN(86400 * 30),
                minimumHandleLength: new BN(3),
                maximumHandleLength: new BN(32),
            };

            await irProgram.methods
                .initializeIdentityRegistry(registryName, metadataUri, settings)
                .accounts({
                    identityRegistry: identityRegistryPda,
                    admin: admin.publicKey,
                    systemProgram: SystemProgram.programId,
                    ...(await EventTestHelper.getEventAccounts()),
                })
                .signers([admin])
                .rpc();

            console.log("✅ IdentityRegistry 初始化成功");
        });

        it("Step 6: 注册用户身份 (UserIdentity)", async () => {
            const privacySettings = {
                profileVisibility: { public: {} },
                contentVisibility: { public: {} },
                socialGraphVisibility: { followers: {} },
                activityVisibility: { friends: {} },
                economicDataVisibility: { private: {} },
                allowDirectMessages: true,
                allowMentions: true,
                allowContentIndexing: true,
                dataRetentionDays: null,
            };

            await irProgram.methods
                .registerIdentity(handle, privacySettings)
                .accounts({
                    identityRegistry: identityRegistryPda,
                    userIdentity: userIdentityPda,
                    handleMapping: handleMappingPda,
                    user: contributor.publicKey,
                    systemProgram: SystemProgram.programId,
                    ...(await EventTestHelper.getEventAccounts()),
                })
                .signers([contributor])
                .rpc();

            const acct = await irProgram.account.userIdentityAccount.fetch(userIdentityPda);
            const identity = acct.inner;
            expect(identity.reputationScore).to.equal(50.0);
            expect(identity.trustScore).to.equal(50.0);

            console.log("✅ UserIdentity 注册成功 (reputation=50.0, trust=50.0)");
        });

        it("Step 7: 初始化 Contribution Engine", async () => {
            if (!ceNeedsInit) {
                // Config already exists — check if admin matches
                const cfg = await ceProgram.account.contributionConfig.fetch(configPda);
                if (cfg.admin.toString() === admin.publicKey.toString()) {
                    console.log("⚠️  ContributionConfig 已存在 (admin 匹配)");
                    return;
                }
                console.log("⚠️  ContributionConfig 已存在但 admin 不匹配");
                console.log("   config.admin:", cfg.admin.toString().slice(0, 12));
                console.log("   our admin:   ", admin.publicKey.toString().slice(0, 12));
                // This is a problem — we can't use settleReputation with the wrong admin
                // The unit tests used a random keypair as admin
                // Our only option: skip the CPI tests
                return;
            }

            await ceProgram.methods
                .initializeEngine(100, 0.01)
                .accounts({
                    config: configPda,
                    admin: admin.publicKey,
                    systemProgram: SystemProgram.programId,
                })
                .signers([admin])
                .rpc();

            console.log("✅ Contribution Engine 初始化成功 (admin=provider.wallet)");
        });
    });

    // ==================== CPI Integration Tests ====================

    describe("CPI 结算流程", () => {
        before(async () => {
            // Pre-check: can we use settleReputation?
            const cfg = await ceProgram.account.contributionConfig.fetch(configPda);
            if (cfg.admin.toString() !== admin.publicKey.toString()) {
                console.log("⚠️  ContributionConfig.admin 与当前 admin 不匹配, 跳过 CPI 结算测试");
                console.log("   提示: 确保 CPI 集成测试在单元测试之前运行，或使用相同的 admin");
            }
        });

        it("创建账本 → 记录贡献 → 关闭账本", async function () {
            const cfg = await ceProgram.account.contributionConfig.fetch(configPda);
            if (cfg.admin.toString() !== admin.publicKey.toString()) {
                this.skip();
                return;
            }

            // 创建账本
            await ceProgram.methods
                .createLedger(crystalId)
                .accounts({
                    config: configPda,
                    ledger: ledgerPda,
                    authority: admin.publicKey,
                    systemProgram: SystemProgram.programId,
                })
                .signers([admin])
                .rpc();

            // 记录 Author 贡献
            await ceProgram.methods
                .recordContribution({ author: {} }, 0.60)
                .accounts({
                    config: configPda,
                    ledger: ledgerPda,
                    entry: entryPda,
                    contributor: contributor.publicKey,
                    authority: admin.publicKey,
                    systemProgram: SystemProgram.programId,
                })
                .signers([admin])
                .rpc();

            // 关闭账本
            await ceProgram.methods
                .closeLedger()
                .accounts({
                    config: configPda,
                    ledger: ledgerPda,
                    admin: admin.publicKey,
                })
                .signers([admin])
                .rpc();

            const ledger = await ceProgram.account.contributionLedger.fetch(ledgerPda);
            expect(ledger.closed).to.be.true;
            expect(ledger.reputationSettled).to.be.false;

            console.log("✅ 账本创建 → 记录 → 关闭 完成");
        });

        it("CPI 结算: settle_reputation → update_reputation_by_extension", async function () {
            const cfg = await ceProgram.account.contributionConfig.fetch(configPda);
            if (cfg.admin.toString() !== admin.publicKey.toString()) {
                this.skip();
                return;
            }

            const authorityScore = 0.80;

            await ceProgram.methods
                .settleReputation(authorityScore)
                .accounts({
                    config: configPda,
                    ledger: ledgerPda,
                    entry: entryPda,
                    userIdentity: userIdentityPda,
                    identityRegistry: identityRegistryPda,
                    callerProgram: ceProgram.programId,
                    extensionRegistry: extensionRegistryPda,
                    identityRegistryProgram: irProgram.programId,
                    admin: admin.publicKey,
                })
                .signers([admin])
                .rpc();

            // 验证账本标记为已结算
            const ledger = await ceProgram.account.contributionLedger.fetch(ledgerPda);
            expect(ledger.reputationSettled).to.be.true;

            // 验证 UserIdentity 声誉已更新
            const acct = await irProgram.account.userIdentityAccount.fetch(userIdentityPda);
            const identity = acct.inner;

            // reputation_delta = weight(0.60) × authority_score(0.80) = 0.48
            const expectedReputation = 50.0 + (0.60 * authorityScore);
            expect(identity.reputationScore).to.be.closeTo(expectedReputation, 0.01);
            expect(identity.trustScore).to.equal(50.0); // trust 不变

            console.log(`✅ CPI 声誉结算成功!`);
            console.log(`   weight=0.60, authority=0.80, delta=0.48`);
            console.log(`   声誉: 50.00 → ${identity.reputationScore.toFixed(2)}`);
        });
    });

    // ==================== 权限测试 ====================

    describe("CPI 权限边界测试", () => {
        it("拒绝缺少 ReputationWrite 权限的扩展结算", async function () {
            const cfg = await ceProgram.account.contributionConfig.fetch(configPda);
            if (cfg.admin.toString() !== admin.publicKey.toString()) {
                this.skip();
                return;
            }

            const blockedCrystalId = Keypair.generate().publicKey;
            const blockedLedgerPda = findLedgerPda(blockedCrystalId);
            const blockedEntryPda = findEntryPda(blockedCrystalId, contributor.publicKey);

            await setContributionEnginePermissions([{ contributionRead: {} }]);

            await ceProgram.methods
                .createLedger(blockedCrystalId)
                .accounts({
                    config: configPda,
                    ledger: blockedLedgerPda,
                    authority: admin.publicKey,
                    systemProgram: SystemProgram.programId,
                })
                .signers([admin])
                .rpc();

            await ceProgram.methods
                .recordContribution({ reviewer: {} }, 0.25)
                .accounts({
                    config: configPda,
                    ledger: blockedLedgerPda,
                    entry: blockedEntryPda,
                    contributor: contributor.publicKey,
                    authority: admin.publicKey,
                    systemProgram: SystemProgram.programId,
                })
                .signers([admin])
                .rpc();

            await ceProgram.methods
                .closeLedger()
                .accounts({
                    config: configPda,
                    ledger: blockedLedgerPda,
                    admin: admin.publicKey,
                })
                .signers([admin])
                .rpc();

            try {
                await ceProgram.methods
                    .settleReputation(0.75)
                    .accounts({
                        config: configPda,
                        ledger: blockedLedgerPda,
                        entry: blockedEntryPda,
                        userIdentity: userIdentityPda,
                        identityRegistry: identityRegistryPda,
                        callerProgram: ceProgram.programId,
                        extensionRegistry: extensionRegistryPda,
                        identityRegistryProgram: irProgram.programId,
                        admin: admin.publicKey,
                    })
                    .signers([admin])
                    .rpc();

                expect.fail("缺少 ReputationWrite 权限不应允许结算");
            } catch (error: any) {
                expect(error.message).to.match(/(Unauthorized|InvalidOperation|custom program error)/i);
                console.log("✅ 正确拒绝缺少 ReputationWrite 权限的结算");
            } finally {
                await setContributionEnginePermissions([{ reputationWrite: {} }]);
            }
        });

        it("拒绝重复结算 (AlreadySettled)", async function () {
            const cfg = await ceProgram.account.contributionConfig.fetch(configPda);
            if (cfg.admin.toString() !== admin.publicKey.toString()) {
                this.skip();
                return;
            }

            try {
                await ceProgram.methods
                    .settleReputation(0.50)
                    .accounts({
                        config: configPda,
                        ledger: ledgerPda,
                        entry: entryPda,
                        userIdentity: userIdentityPda,
                        identityRegistry: identityRegistryPda,
                        callerProgram: ceProgram.programId,
                        extensionRegistry: extensionRegistryPda,
                        identityRegistryProgram: irProgram.programId,
                        admin: admin.publicKey,
                    })
                    .signers([admin])
                    .rpc();

                expect.fail("不应允许重复结算");
            } catch (error: any) {
                expect(error.message).to.match(/(AlreadySettled|custom program error|7042)/i);
                console.log("✅ 正确拒绝重复结算 (AlreadySettled)");
            }
        });

        it("拒绝未关闭账本结算 (LedgerNotClosed)", async function () {
            const cfg = await ceProgram.account.contributionConfig.fetch(configPda);
            if (cfg.admin.toString() !== admin.publicKey.toString()) {
                this.skip();
                return;
            }

            const openCrystalId = Keypair.generate().publicKey;
            const openLedgerPda = findLedgerPda(openCrystalId);
            const openEntryPda = findEntryPda(openCrystalId, contributor.publicKey);

            await ceProgram.methods
                .createLedger(openCrystalId)
                .accounts({
                    config: configPda,
                    ledger: openLedgerPda,
                    authority: admin.publicKey,
                    systemProgram: SystemProgram.programId,
                })
                .signers([admin])
                .rpc();

            await ceProgram.methods
                .recordContribution({ author: {} }, 0.50)
                .accounts({
                    config: configPda,
                    ledger: openLedgerPda,
                    entry: openEntryPda,
                    contributor: contributor.publicKey,
                    authority: admin.publicKey,
                    systemProgram: SystemProgram.programId,
                })
                .signers([admin])
                .rpc();

            try {
                await ceProgram.methods
                    .settleReputation(0.50)
                    .accounts({
                        config: configPda,
                        ledger: openLedgerPda,
                        entry: openEntryPda,
                        userIdentity: userIdentityPda,
                        identityRegistry: identityRegistryPda,
                        callerProgram: ceProgram.programId,
                        extensionRegistry: extensionRegistryPda,
                        identityRegistryProgram: irProgram.programId,
                        admin: admin.publicKey,
                    })
                    .signers([admin])
                    .rpc();

                expect.fail("未关闭账本不应允许结算");
            } catch (error: any) {
                expect(error.message).to.match(/(LedgerNotClosed|custom program error|7003)/i);
                console.log("✅ 正确拒绝未关闭账本结算 (LedgerNotClosed)");
            }
        });

        it("拒绝非 admin 执行结算 (Unauthorized)", async function () {
            const cfg = await ceProgram.account.contributionConfig.fetch(configPda);
            if (cfg.admin.toString() !== admin.publicKey.toString()) {
                this.skip();
                return;
            }

            const unauthCrystalId = Keypair.generate().publicKey;
            const unauthLedgerPda = findLedgerPda(unauthCrystalId);
            const unauthEntryPda = findEntryPda(unauthCrystalId, contributor.publicKey);

            await ceProgram.methods
                .createLedger(unauthCrystalId)
                .accounts({
                    config: configPda,
                    ledger: unauthLedgerPda,
                    authority: admin.publicKey,
                    systemProgram: SystemProgram.programId,
                })
                .signers([admin])
                .rpc();

            await ceProgram.methods
                .recordContribution({ author: {} }, 0.30)
                .accounts({
                    config: configPda,
                    ledger: unauthLedgerPda,
                    entry: unauthEntryPda,
                    contributor: contributor.publicKey,
                    authority: admin.publicKey,
                    systemProgram: SystemProgram.programId,
                })
                .signers([admin])
                .rpc();

            await ceProgram.methods
                .closeLedger()
                .accounts({
                    config: configPda,
                    ledger: unauthLedgerPda,
                    admin: admin.publicKey,
                })
                .signers([admin])
                .rpc();

            try {
                await ceProgram.methods
                    .settleReputation(0.50)
                    .accounts({
                        config: configPda,
                        ledger: unauthLedgerPda,
                        entry: unauthEntryPda,
                        userIdentity: userIdentityPda,
                        identityRegistry: identityRegistryPda,
                        callerProgram: ceProgram.programId,
                        extensionRegistry: extensionRegistryPda,
                        identityRegistryProgram: irProgram.programId,
                        admin: contributor.publicKey, // NOT the real admin
                    })
                    .signers([contributor])
                    .rpc();

                expect.fail("非 admin 不应能执行结算");
            } catch (error: any) {
                expect(error.message).to.match(/(Unauthorized|ConstraintHasOne|custom program error)/i);
                console.log("✅ 正确拒绝非 admin 结算 (Unauthorized)");
            }
        });
    });

    // ==================== 端到端验证 ====================

    describe("端到端声誉验证", () => {
        it("第二轮结算: 验证声誉持续累加", async function () {
            const cfg = await ceProgram.account.contributionConfig.fetch(configPda);
            if (cfg.admin.toString() !== admin.publicKey.toString()) {
                this.skip();
                return;
            }

            const crystal2 = Keypair.generate().publicKey;
            const ledger2 = findLedgerPda(crystal2);
            const entry2 = findEntryPda(crystal2, contributor.publicKey);

            await ceProgram.methods
                .createLedger(crystal2)
                .accounts({
                    config: configPda,
                    ledger: ledger2,
                    authority: admin.publicKey,
                    systemProgram: SystemProgram.programId,
                })
                .signers([admin])
                .rpc();

            await ceProgram.methods
                .recordContribution({ reviewer: {} }, 0.40)
                .accounts({
                    config: configPda,
                    ledger: ledger2,
                    entry: entry2,
                    contributor: contributor.publicKey,
                    authority: admin.publicKey,
                    systemProgram: SystemProgram.programId,
                })
                .signers([admin])
                .rpc();

            await ceProgram.methods
                .closeLedger()
                .accounts({
                    config: configPda,
                    ledger: ledger2,
                    admin: admin.publicKey,
                })
                .signers([admin])
                .rpc();

            const authority2 = 0.90;
            await ceProgram.methods
                .settleReputation(authority2)
                .accounts({
                    config: configPda,
                    ledger: ledger2,
                    entry: entry2,
                    userIdentity: userIdentityPda,
                    identityRegistry: identityRegistryPda,
                    callerProgram: ceProgram.programId,
                    extensionRegistry: extensionRegistryPda,
                    identityRegistryProgram: irProgram.programId,
                    admin: admin.publicKey,
                })
                .signers([admin])
                .rpc();

            const acct = await irProgram.account.userIdentityAccount.fetch(userIdentityPda);
            const identity = acct.inner;

            // 第一轮: 50.0 + (0.60 × 0.80) = 50.48
            // 第二轮: 50.48 + (0.40 × 0.90) = 50.84
            const expectedReputation = 50.0 + (0.60 * 0.80) + (0.40 * authority2);
            expect(identity.reputationScore).to.be.closeTo(expectedReputation, 0.01);
            expect(identity.trustScore).to.equal(50.0);

            console.log(`✅ 声誉持续累加验证通过!`);
            console.log(`   第一轮: +0.48 (Author 0.60 × 0.80)`);
            console.log(`   第二轮: +0.36 (Reviewer 0.40 × 0.90)`);
            console.log(`   最终声誉: ${identity.reputationScore.toFixed(2)}`);
        });
    });
});
