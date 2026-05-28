import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { PublicKey, Keypair, SystemProgram } from "@solana/web3.js";
import { expect } from "chai";

type ContributionEngine = any;

describe("Contribution Engine Unit Tests", () => {
    const provider = anchor.AnchorProvider.env();
    anchor.setProvider(provider);

    const program = anchor.workspace.ContributionEngine as Program<ContributionEngine>;
    // Use provider.wallet.payer as admin so the singleton ContributionConfig PDA
    // is shared consistently across unit tests and CPI integration tests
    const admin = (provider.wallet as any).payer as Keypair;
    const contributor1 = Keypair.generate();
    const contributor2 = Keypair.generate();
    const contributor3 = Keypair.generate();
    const unauthorizedUser = Keypair.generate();

    // Crystal IDs (模拟内容 ID)
    const crystalId = Keypair.generate().publicKey;
    const crystalId2 = Keypair.generate().publicKey;

    // Source/Target 内容 ID (用于引用测试)
    const sourceContent = Keypair.generate();
    const targetContent = Keypair.generate();
    const targetContent2 = Keypair.generate();
    let baselineTotalLedgers = 0;
    let baselineTotalReferences = 0;

    // PDA Seeds
    const CONFIG_SEED = Buffer.from("config");
    const LEDGER_SEED = Buffer.from("ledger");
    const ENTRY_SEED = Buffer.from("entry");
    const REF_SEED = Buffer.from("ref");

    function findConfigPda(): [PublicKey, number] {
        return PublicKey.findProgramAddressSync(
            [CONFIG_SEED],
            program.programId
        );
    }

    function findLedgerPda(crystalKey: PublicKey): [PublicKey, number] {
        return PublicKey.findProgramAddressSync(
            [LEDGER_SEED, crystalKey.toBuffer()],
            program.programId
        );
    }

    function findEntryPda(crystalKey: PublicKey, contributorKey: PublicKey): [PublicKey, number] {
        return PublicKey.findProgramAddressSync(
            [ENTRY_SEED, crystalKey.toBuffer(), contributorKey.toBuffer()],
            program.programId
        );
    }

    function findReferencePda(source: PublicKey, target: PublicKey): [PublicKey, number] {
        return PublicKey.findProgramAddressSync(
            [REF_SEED, source.toBuffer(), target.toBuffer()],
            program.programId
        );
    }

    before(async () => {
        // 空投测试资金
        const airdropPromises = [admin, contributor1, contributor2, contributor3, unauthorizedUser].map(
            async (kp) => {
                await provider.connection.confirmTransaction(
                    await provider.connection.requestAirdrop(kp.publicKey, 5 * anchor.web3.LAMPORTS_PER_SOL)
                );
            }
        );
        await Promise.all(airdropPromises);

        // Keep tests re-runnable against a pre-initialized local validator.
        const [configPda] = findConfigPda();
        try {
            const existing = await program.account.contributionConfig.fetch(configPda);
            baselineTotalLedgers = existing.totalLedgers.toNumber();
            baselineTotalReferences = existing.totalReferences.toNumber();
        } catch {
            baselineTotalLedgers = 0;
            baselineTotalReferences = 0;
        }
    });

    // ==================== 引擎初始化 ====================

    describe("引擎初始化", () => {
        it("成功初始化 Contribution Engine", async () => {
            const [configPda] = findConfigPda();
            let initializedInThisRun = false;

            try {
                await program.methods
                    .initializeEngine(100, 0.01) // max_entries=100, min_weight=0.01
                    .accounts({
                        config: configPda,
                        admin: admin.publicKey,
                        systemProgram: SystemProgram.programId,
                    })
                    .signers([admin])
                    .rpc();
                initializedInThisRun = true;
            } catch (error: any) {
                const message = String(error?.message || error);
                // Re-runs on the same local validator hit "already initialized".
                expect(message).to.match(/(already in use|custom program error|Error Number:\s*0)/i);
            }

            const config = await program.account.contributionConfig.fetch(configPda);
            expect(config.admin.toString()).to.equal(admin.publicKey.toString());
            if (initializedInThisRun) {
                expect(config.maxEntriesPerCrystal).to.equal(100);
                expect(config.minWeight).to.equal(0.01);
                expect(config.roleWeights[0]).to.equal(0.50); // Author
                expect(config.roleWeights[1]).to.equal(0.25); // Discussant
                expect(config.roleWeights[2]).to.equal(0.20); // Reviewer
                expect(config.roleWeights[3]).to.equal(0.05); // Cited
            } else {
                expect(config.maxEntriesPerCrystal).to.be.greaterThan(0);
                expect(config.minWeight).to.be.greaterThan(0);
            }
            baselineTotalLedgers = config.totalLedgers.toNumber();
            baselineTotalReferences = config.totalReferences.toNumber();

            console.log("✅ Contribution Engine 初始化成功");
        });

        it("验证重复初始化被拒绝", async () => {
            const [configPda] = findConfigPda();

            try {
                await program.methods
                    .initializeEngine(50, 0.02)
                    .accounts({
                        config: configPda,
                        admin: admin.publicKey,
                        systemProgram: SystemProgram.programId,
                    })
                    .signers([admin])
                    .rpc();

                expect.fail("不应允许重复初始化");
            } catch (error: any) {
                // 账户已存在，init 约束会失败
                expect(error.message).to.match(/(already in use|custom program error)/i);
                console.log("✅ 正确拒绝重复初始化");
            }
        });
    });

    // ==================== 配置更新 ====================

    describe("配置更新", () => {
        it("admin 成功更新配置", async () => {
            const [configPda] = findConfigPda();

            await program.methods
                .updateConfig(200, 0.005, null)
                .accounts({
                    config: configPda,
                    admin: admin.publicKey,
                })
                .signers([admin])
                .rpc();

            const config = await program.account.contributionConfig.fetch(configPda);
            expect(config.maxEntriesPerCrystal).to.equal(200);
            expect(config.minWeight).to.equal(0.005);

            console.log("✅ 配置更新成功");
        });

        it("admin 更新角色权重", async () => {
            const [configPda] = findConfigPda();

            // 自定义权重 (总和 = 1.0)
            const newWeights = [0.45, 0.30, 0.15, 0.10];

            await program.methods
                .updateConfig(null, null, newWeights)
                .accounts({
                    config: configPda,
                    admin: admin.publicKey,
                })
                .signers([admin])
                .rpc();

            const config = await program.account.contributionConfig.fetch(configPda);
            expect(config.roleWeights[0]).to.equal(0.45);
            expect(config.roleWeights[1]).to.equal(0.30);
            expect(config.roleWeights[2]).to.equal(0.15);
            expect(config.roleWeights[3]).to.equal(0.10);

            console.log("✅ 角色权重更新成功");

            // 恢复默认权重
            await program.methods
                .updateConfig(null, null, [0.50, 0.25, 0.20, 0.05])
                .accounts({
                    config: configPda,
                    admin: admin.publicKey,
                })
                .signers([admin])
                .rpc();
        });

        it("拒绝权重总和不为 1.0 的配置", async () => {
            const [configPda] = findConfigPda();
            const badWeights = [0.50, 0.30, 0.30, 0.10]; // 总和 1.20

            try {
                await program.methods
                    .updateConfig(null, null, badWeights)
                    .accounts({
                        config: configPda,
                        admin: admin.publicKey,
                    })
                    .signers([admin])
                    .rpc();

                expect.fail("不应允许权重总和 ≠ 1.0");
            } catch (error: any) {
                expect(error.message).to.match(/(WeightOverflow|custom program error)/i);
                console.log("✅ 正确拒绝无效权重");
            }
        });

        it("拒绝非 admin 更新配置", async () => {
            const [configPda] = findConfigPda();

            try {
                await program.methods
                    .updateConfig(50, null, null)
                    .accounts({
                        config: configPda,
                        admin: unauthorizedUser.publicKey,
                    })
                    .signers([unauthorizedUser])
                    .rpc();

                expect.fail("非 admin 不应能更新配置");
            } catch (error: any) {
                expect(error.message).to.match(/(Unauthorized|ConstraintHasOne|custom program error)/i);
                console.log("✅ 正确拒绝未授权用户");
            }
        });
    });

    // ==================== 账本管理 ====================

    describe("账本管理", () => {
        it("成功创建贡献账本", async () => {
            const [configPda] = findConfigPda();
            const [ledgerPda] = findLedgerPda(crystalId);

            await program.methods
                .createLedger(crystalId)
                .accounts({
                    config: configPda,
                    ledger: ledgerPda,
                    authority: admin.publicKey,
                    systemProgram: SystemProgram.programId,
                })
                .signers([admin])
                .rpc();

            const ledger = await program.account.contributionLedger.fetch(ledgerPda);
            expect(ledger.crystalId.toString()).to.equal(crystalId.toString());
            expect(ledger.totalContributors).to.equal(0);
            expect(ledger.closed).to.be.false;
            expect(ledger.totalWeight).to.equal(0.0);
            expect(ledger.reputationSettled).to.be.false;

            const config = await program.account.contributionConfig.fetch(configPda);
            expect(config.totalLedgers.toNumber()).to.equal(baselineTotalLedgers + 1);

            console.log("✅ 贡献账本创建成功");
        });

        it("验证重复创建账本被拒绝", async () => {
            const [configPda] = findConfigPda();
            const [ledgerPda] = findLedgerPda(crystalId);

            try {
                await program.methods
                    .createLedger(crystalId)
                    .accounts({
                        config: configPda,
                        ledger: ledgerPda,
                        authority: admin.publicKey,
                        systemProgram: SystemProgram.programId,
                    })
                    .signers([admin])
                    .rpc();

                expect.fail("不应允许重复创建同一 Crystal 的账本");
            } catch (error: any) {
                expect(error.message).to.match(/(LedgerAlreadyExists|贡献账本已存在|Error Number:\s*7000|already in use|custom program error)/i);
                console.log("✅ 正确拒绝重复创建账本");
            }
        });

        it("创建第二个 Crystal 的账本", async () => {
            const [configPda] = findConfigPda();
            const [ledgerPda] = findLedgerPda(crystalId2);

            await program.methods
                .createLedger(crystalId2)
                .accounts({
                    config: configPda,
                    ledger: ledgerPda,
                    authority: admin.publicKey,
                    systemProgram: SystemProgram.programId,
                })
                .signers([admin])
                .rpc();

            const config = await program.account.contributionConfig.fetch(configPda);
            expect(config.totalLedgers.toNumber()).to.equal(baselineTotalLedgers + 2);

            console.log("✅ 第二个账本创建成功");
        });
    });

    // ==================== 贡献记录 ====================

    describe("贡献记录", () => {
        it("记录 Author 贡献 (contributor1)", async () => {
            const [configPda] = findConfigPda();
            const [ledgerPda] = findLedgerPda(crystalId);
            const [entryPda] = findEntryPda(crystalId, contributor1.publicKey);

            await program.methods
                .recordContribution({ author: {} }, 0.50)
                .accounts({
                    config: configPda,
                    ledger: ledgerPda,
                    entry: entryPda,
                    contributor: contributor1.publicKey,
                    authority: admin.publicKey,
                    systemProgram: SystemProgram.programId,
                })
                .signers([admin])
                .rpc();

            const entry = await program.account.contributionEntry.fetch(entryPda);
            expect(entry.crystalId.toString()).to.equal(crystalId.toString());
            expect(entry.contributor.toString()).to.equal(contributor1.publicKey.toString());
            expect(entry.role).to.deep.equal({ author: {} });
            expect(entry.weight).to.equal(0.50);

            const ledger = await program.account.contributionLedger.fetch(ledgerPda);
            expect(ledger.totalContributors).to.equal(1);
            expect(ledger.totalWeight).to.equal(0.50);

            console.log("✅ Author 贡献记录成功");
        });

        it("记录 Discussant 贡献 (contributor2)", async () => {
            const [configPda] = findConfigPda();
            const [ledgerPda] = findLedgerPda(crystalId);
            const [entryPda] = findEntryPda(crystalId, contributor2.publicKey);

            await program.methods
                .recordContribution({ discussant: {} }, 0.25)
                .accounts({
                    config: configPda,
                    ledger: ledgerPda,
                    entry: entryPda,
                    contributor: contributor2.publicKey,
                    authority: admin.publicKey,
                    systemProgram: SystemProgram.programId,
                })
                .signers([admin])
                .rpc();

            const entry = await program.account.contributionEntry.fetch(entryPda);
            expect(entry.role).to.deep.equal({ discussant: {} });
            expect(entry.weight).to.equal(0.25);

            const ledger = await program.account.contributionLedger.fetch(ledgerPda);
            expect(ledger.totalContributors).to.equal(2);
            expect(ledger.totalWeight).to.be.closeTo(0.75, 0.001);

            console.log("✅ Discussant 贡献记录成功");
        });

        it("记录 Reviewer 贡献 (contributor3)", async () => {
            const [configPda] = findConfigPda();
            const [ledgerPda] = findLedgerPda(crystalId);
            const [entryPda] = findEntryPda(crystalId, contributor3.publicKey);

            await program.methods
                .recordContribution({ reviewer: {} }, 0.20)
                .accounts({
                    config: configPda,
                    ledger: ledgerPda,
                    entry: entryPda,
                    contributor: contributor3.publicKey,
                    authority: admin.publicKey,
                    systemProgram: SystemProgram.programId,
                })
                .signers([admin])
                .rpc();

            const entry = await program.account.contributionEntry.fetch(entryPda);
            expect(entry.role).to.deep.equal({ reviewer: {} });

            const ledger = await program.account.contributionLedger.fetch(ledgerPda);
            expect(ledger.totalContributors).to.equal(3);
            expect(ledger.totalWeight).to.be.closeTo(0.95, 0.001);

            console.log("✅ Reviewer 贡献记录成功");
        });

        it("拒绝重复记录同一贡献者", async () => {
            const [configPda] = findConfigPda();
            const [ledgerPda] = findLedgerPda(crystalId);
            const [entryPda] = findEntryPda(crystalId, contributor1.publicKey);

            try {
                await program.methods
                    .recordContribution({ author: {} }, 0.30)
                    .accounts({
                        config: configPda,
                        ledger: ledgerPda,
                        entry: entryPda,
                        contributor: contributor1.publicKey,
                        authority: admin.publicKey,
                        systemProgram: SystemProgram.programId,
                    })
                    .signers([admin])
                    .rpc();

                expect.fail("不应允许重复记录同一贡献者");
            } catch (error: any) {
                expect(error.message).to.match(/(already in use|custom program error)/i);
                console.log("✅ 正确拒绝重复贡献记录");
            }
        });

        it("拒绝权重低于最小值", async () => {
            const [configPda] = findConfigPda();
            const [ledgerPda] = findLedgerPda(crystalId);
            const tinyContributor = Keypair.generate();
            const [entryPda] = findEntryPda(crystalId, tinyContributor.publicKey);

            try {
                await program.methods
                    .recordContribution({ cited: {} }, 0.001) // min_weight=0.005
                    .accounts({
                        config: configPda,
                        ledger: ledgerPda,
                        entry: entryPda,
                        contributor: tinyContributor.publicKey,
                        authority: admin.publicKey,
                        systemProgram: SystemProgram.programId,
                    })
                    .signers([admin])
                    .rpc();

                expect.fail("低于最小权重的贡献不应被记录");
            } catch (error: any) {
                expect(error.message).to.match(/(InvalidWeight|custom program error)/i);
                console.log("✅ 正确拒绝低权重贡献");
            }
        });
    });

    // ==================== 贡献分数更新 ====================

    describe("贡献分数更新", () => {
        it("admin 更新贡献分数", async () => {
            const [configPda] = findConfigPda();
            const [ledgerPda] = findLedgerPda(crystalId);
            const [entryPda] = findEntryPda(crystalId, contributor1.publicKey);

            const ledgerBefore = await program.account.contributionLedger.fetch(ledgerPda);

            await program.methods
                .updateContributionScore(0.40)
                .accounts({
                    config: configPda,
                    ledger: ledgerPda,
                    entry: entryPda,
                    admin: admin.publicKey,
                })
                .signers([admin])
                .rpc();

            const entry = await program.account.contributionEntry.fetch(entryPda);
            expect(entry.weight).to.equal(0.40);

            // 总权重应该从 0.95 变为 0.85 (0.95 - 0.50 + 0.40)
            const ledger = await program.account.contributionLedger.fetch(ledgerPda);
            expect(ledger.totalWeight).to.be.closeTo(
                ledgerBefore.totalWeight - 0.50 + 0.40, 0.001
            );

            console.log("✅ 贡献分数更新成功");

            // 恢复原来的权重
            await program.methods
                .updateContributionScore(0.50)
                .accounts({
                    config: configPda,
                    ledger: ledgerPda,
                    entry: entryPda,
                    admin: admin.publicKey,
                })
                .signers([admin])
                .rpc();
        });

        it("拒绝非 admin 更新贡献分数", async () => {
            const [configPda] = findConfigPda();
            const [ledgerPda] = findLedgerPda(crystalId);
            const [entryPda] = findEntryPda(crystalId, contributor1.publicKey);

            try {
                await program.methods
                    .updateContributionScore(0.30)
                    .accounts({
                        config: configPda,
                        ledger: ledgerPda,
                        entry: entryPda,
                        admin: unauthorizedUser.publicKey,
                    })
                    .signers([unauthorizedUser])
                    .rpc();

                expect.fail("非 admin 不应能更新分数");
            } catch (error: any) {
                expect(error.message).to.match(/(Unauthorized|ConstraintHasOne|custom program error)/i);
                console.log("✅ 正确拒绝非 admin 更新分数");
            }
        });
    });

    // ==================== 引用管理 ====================

    describe("引用管理", () => {
        it("添加 Import (硬依赖) 引用", async () => {
            const [configPda] = findConfigPda();
            const [refPda] = findReferencePda(sourceContent.publicKey, targetContent.publicKey);

            await program.methods
                .addReference({ import: {} })
                .accounts({
                    config: configPda,
                    reference: refPda,
                    sourceContent: sourceContent.publicKey,
                    targetContent: targetContent.publicKey,
                    authority: admin.publicKey,
                    systemProgram: SystemProgram.programId,
                })
                .signers([admin])
                .rpc();

            const ref = await program.account.reference.fetch(refPda);
            expect(ref.sourceId.toString()).to.equal(sourceContent.publicKey.toString());
            expect(ref.targetId.toString()).to.equal(targetContent.publicKey.toString());
            expect(ref.refType).to.deep.equal({ import: {} });
            expect(ref.weight).to.equal(1.0);
            expect(ref.creator.toString()).to.equal(admin.publicKey.toString());

            const config = await program.account.contributionConfig.fetch(configPda);
            expect(config.totalReferences.toNumber()).to.equal(baselineTotalReferences + 1);

            console.log("✅ Import 引用添加成功 (weight=1.0)");
        });

        it("添加 Citation (软引用) 引用", async () => {
            const [configPda] = findConfigPda();
            const [refPda] = findReferencePda(sourceContent.publicKey, targetContent2.publicKey);

            await program.methods
                .addReference({ citation: {} })
                .accounts({
                    config: configPda,
                    reference: refPda,
                    sourceContent: sourceContent.publicKey,
                    targetContent: targetContent2.publicKey,
                    authority: admin.publicKey,
                    systemProgram: SystemProgram.programId,
                })
                .signers([admin])
                .rpc();

            const ref = await program.account.reference.fetch(refPda);
            expect(ref.refType).to.deep.equal({ citation: {} });
            expect(ref.weight).to.equal(0.5);

            console.log("✅ Citation 引用添加成功 (weight=0.5)");
        });

        it("拒绝自引用", async () => {
            const [configPda] = findConfigPda();
            const selfContent = Keypair.generate();
            const [refPda] = findReferencePda(selfContent.publicKey, selfContent.publicKey);

            try {
                await program.methods
                    .addReference({ mention: {} })
                    .accounts({
                        config: configPda,
                        reference: refPda,
                        sourceContent: selfContent.publicKey,
                        targetContent: selfContent.publicKey,
                        authority: admin.publicKey,
                        systemProgram: SystemProgram.programId,
                    })
                    .signers([admin])
                    .rpc();

                expect.fail("不应允许自引用");
            } catch (error: any) {
                // PDA seeds 相同会导致 init 冲突，或程序内的 SelfReferenceNotAllowed 错误
                expect(error.message).to.match(/(SelfReferenceNotAllowed|ConstraintSeeds|custom program error)/i);
                console.log("✅ 正确拒绝自引用");
            }
        });

        it("拒绝重复引用", async () => {
            const [configPda] = findConfigPda();
            const [refPda] = findReferencePda(sourceContent.publicKey, targetContent.publicKey);

            try {
                await program.methods
                    .addReference({ citation: {} })
                    .accounts({
                        config: configPda,
                        reference: refPda,
                        sourceContent: sourceContent.publicKey,
                        targetContent: targetContent.publicKey,
                        authority: admin.publicKey,
                        systemProgram: SystemProgram.programId,
                    })
                    .signers([admin])
                    .rpc();

                expect.fail("不应允许重复引用");
            } catch (error: any) {
                expect(error.message).to.match(/(already in use|custom program error)/i);
                console.log("✅ 正确拒绝重复引用");
            }
        });
    });

    // ==================== 账本关闭 ====================

    describe("账本关闭", () => {
        it("admin 成功关闭账本", async () => {
            const [configPda] = findConfigPda();
            const [ledgerPda] = findLedgerPda(crystalId);

            await program.methods
                .closeLedger()
                .accounts({
                    config: configPda,
                    ledger: ledgerPda,
                    admin: admin.publicKey,
                })
                .signers([admin])
                .rpc();

            const ledger = await program.account.contributionLedger.fetch(ledgerPda);
            expect(ledger.closed).to.be.true;
            expect(ledger.totalContributors).to.equal(3);

            console.log("✅ 账本关闭成功");
        });

        it("拒绝重复关闭账本", async () => {
            const [configPda] = findConfigPda();
            const [ledgerPda] = findLedgerPda(crystalId);

            try {
                await program.methods
                    .closeLedger()
                    .accounts({
                        config: configPda,
                        ledger: ledgerPda,
                        admin: admin.publicKey,
                    })
                    .signers([admin])
                    .rpc();

                expect.fail("不应允许重复关闭已关闭的账本");
            } catch (error: any) {
                const message = String(error?.message || error);
                // Anchor/Solana versions may surface the same on-chain error in
                // different formats: code name, numeric code, or localized msg.
                expect(message).to.match(/(LedgerClosed|账本已关闭|Error Number:\s*7002|0x1b5a|custom program error|Simulation failed)/i);
                console.log("✅ 正确拒绝重复关闭");
            }
        });

        it("关闭账本后拒绝新贡献", async () => {
            const [configPda] = findConfigPda();
            const [ledgerPda] = findLedgerPda(crystalId);
            const newContributor = Keypair.generate();
            const [entryPda] = findEntryPda(crystalId, newContributor.publicKey);

            try {
                await program.methods
                    .recordContribution({ cited: {} }, 0.05)
                    .accounts({
                        config: configPda,
                        ledger: ledgerPda,
                        entry: entryPda,
                        contributor: newContributor.publicKey,
                        authority: admin.publicKey,
                        systemProgram: SystemProgram.programId,
                    })
                    .signers([admin])
                    .rpc();

                expect.fail("关闭后的账本不应接受新贡献");
            } catch (error: any) {
                expect(error.message).to.match(/(LedgerClosed|custom program error)/i);
                console.log("✅ 正确拒绝关闭后的贡献记录");
            }
        });

        it("拒绝非 admin 关闭账本", async () => {
            const [configPda] = findConfigPda();
            const [ledgerPda] = findLedgerPda(crystalId2); // 使用第二个未关闭的账本

            try {
                await program.methods
                    .closeLedger()
                    .accounts({
                        config: configPda,
                        ledger: ledgerPda,
                        admin: unauthorizedUser.publicKey,
                    })
                    .signers([unauthorizedUser])
                    .rpc();

                expect.fail("非 admin 不应能关闭账本");
            } catch (error: any) {
                expect(error.message).to.match(/(Unauthorized|ConstraintHasOne|custom program error)/i);
                console.log("✅ 正确拒绝非 admin 关闭账本");
            }
        });
    });

    // ==================== 声誉结算 ====================
    // NOTE: settle_reputation 现在通过 CPI 调用 identity-registry::update_reputation_by_extension
    // 需要初始化 identity-registry + ExtensionRegistry 才能测试
    // → 完整测试在 Direction 3 (跨程序集成测试) 中实现

    describe("声誉结算 (CPI — 需要 Direction 3 集成测试)", () => {
        it.skip("成功结算声誉 — 需要 identity-registry 初始化 (Direction 3)", async () => {
            // Direction 3 will initialize identity-registry, create ExtensionRegistry,
            // register contribution-engine with ReputationWrite permission,
            // then call settleReputation with all required CPI accounts:
            // userIdentity, identityRegistry, callerProgram, extensionRegistry,
            // identityRegistryProgram
        });

        it.skip("拒绝非 admin 执行声誉结算 — 需要 identity-registry 初始化 (Direction 3)", async () => {
            // Will test unauthorized settle with full CPI account context
        });
    });

    // ==================== 查询功能 ====================

    describe("查询功能", () => {
        it("查询贡献详情", async () => {
            const [ledgerPda] = findLedgerPda(crystalId);
            const [entryPda] = findEntryPda(crystalId, contributor1.publicKey);

            const result = await program.methods
                .queryContribution()
                .accounts({
                    ledger: ledgerPda,
                    entry: entryPda,
                })
                .view();

            expect(result.crystalId.toString()).to.equal(crystalId.toString());
            expect(result.contributor.toString()).to.equal(contributor1.publicKey.toString());
            expect(result.role).to.deep.equal({ author: {} });
            expect(result.weight).to.equal(0.50);
            expect(result.ledgerClosed).to.be.true;
            expect(result.totalContributors).to.equal(3);
            // reputationSettled = false (settle 测试已跳过，等 Direction 3)
            expect(result.reputationSettled).to.be.false;

            console.log("✅ 贡献详情查询成功");
        });

        it("查询账本摘要", async () => {
            const [ledgerPda] = findLedgerPda(crystalId);

            const result = await program.methods
                .queryLedgerSummary()
                .accounts({
                    ledger: ledgerPda,
                })
                .view();

            expect(result.crystalId.toString()).to.equal(crystalId.toString());
            expect(result.totalContributors).to.equal(3);
            expect(result.totalWeight).to.be.closeTo(0.95, 0.001);
            expect(result.closed).to.be.true;
            // reputationSettled = false (settle 测试已跳过，等 Direction 3)
            expect(result.reputationSettled).to.be.false;

            console.log("✅ 账本摘要查询成功");
        });
    });

    // ==================== 端到端流程 ====================

    describe("端到端流程: Crystal2 完整生命周期", () => {
        it("完整贡献流程: 创建 → 记录 → 关闭", async () => {
            const [configPda] = findConfigPda();
            const [ledgerPda] = findLedgerPda(crystalId2);

            // 账本已在之前创建，记录贡献
            const [entry1Pda] = findEntryPda(crystalId2, contributor1.publicKey);
            await program.methods
                .recordContribution({ author: {} }, 0.60)
                .accounts({
                    config: configPda,
                    ledger: ledgerPda,
                    entry: entry1Pda,
                    contributor: contributor1.publicKey,
                    authority: admin.publicKey,
                    systemProgram: SystemProgram.programId,
                })
                .signers([admin])
                .rpc();

            const [entry2Pda] = findEntryPda(crystalId2, contributor2.publicKey);
            await program.methods
                .recordContribution({ reviewer: {} }, 0.30)
                .accounts({
                    config: configPda,
                    ledger: ledgerPda,
                    entry: entry2Pda,
                    contributor: contributor2.publicKey,
                    authority: admin.publicKey,
                    systemProgram: SystemProgram.programId,
                })
                .signers([admin])
                .rpc();

            const [entry3Pda] = findEntryPda(crystalId2, contributor3.publicKey);
            await program.methods
                .recordContribution({ cited: {} }, 0.10)
                .accounts({
                    config: configPda,
                    ledger: ledgerPda,
                    entry: entry3Pda,
                    contributor: contributor3.publicKey,
                    authority: admin.publicKey,
                    systemProgram: SystemProgram.programId,
                })
                .signers([admin])
                .rpc();

            // 验证账本状态
            let ledger = await program.account.contributionLedger.fetch(ledgerPda);
            expect(ledger.totalContributors).to.equal(3);
            expect(ledger.totalWeight).to.be.closeTo(1.0, 0.001);
            expect(ledger.closed).to.be.false;

            // 关闭账本
            await program.methods
                .closeLedger()
                .accounts({
                    config: configPda,
                    ledger: ledgerPda,
                    admin: admin.publicKey,
                })
                .signers([admin])
                .rpc();

            ledger = await program.account.contributionLedger.fetch(ledgerPda);
            expect(ledger.closed).to.be.true;
            expect(ledger.reputationSettled).to.be.false;

            console.log("✅ 完整贡献生命周期测试通过 (创建 → 记录 → 关闭)");
            console.log("   Author(0.60) + Reviewer(0.30) + Cited(0.10) = 1.00");
        });

        // 结算步骤需要 identity-registry CPI，在 Direction 3 中测试
        it.skip("端到端 CPI 结算 — 需要 identity-registry 初始化 (Direction 3)", async () => {
            // Direction 3 will add the full settle flow:
            // settleReputation(0.75) with all CPI accounts
            // → verify reputation_delta = 0.60 × 0.75 = 0.45 written to UserIdentity
        });
    });
});
