import { PublicKey, SystemProgram } from "@solana/web3.js";
import { BN } from "@coral-xyz/anchor";
import { BaseModule } from "./base";
import * as idl from "../idl/registry_factory.json";
import { Idl } from "@coral-xyz/anchor";

export class FactoryModule extends BaseModule<Idl> {
  constructor(provider: any, programId: PublicKey, pda: any) {
    super(provider, programId, pda, idl as unknown as Idl);
  }

  async deployIdentityRegistry(
    name: string,
    admin: PublicKey
  ) {
      const registryFactoryPda = this.pda.findRegistryFactoryPda();
      const deployedRegistryPda = this.pda.findDeployedRegistryPda(name);

      return this.program.methods
        .deployIdentityRegistry(name, {
            registryName: name,
            maxEntries: new BN(1000),
            registrationFee: new BN(0),
            admin,
            moderators: [],
            settings: [],
            featureFlags: []
        }, null)
        .accounts({
            registryFactory: registryFactoryPda,
            deployedRegistry: deployedRegistryPda,
            deployer: this.provider.publicKey,
            systemProgram: SystemProgram.programId,
        })
        .rpc();
  }

  async getFactoryInfo() {
    const registryFactoryPda = this.pda.findRegistryFactoryPda();
    // @ts-ignore
    // @ts-ignore
    return this.program.account.registryFactory.fetch(registryFactoryPda);
  }

  async deployContentManager(name: string, admin: PublicKey, config: any) {
    const registryFactoryPda = this.pda.findRegistryFactoryPda();
    const deployedRegistryPda = this.pda.findDeployedRegistryPda(name);

    return this.program.methods
      .deployContentManager(name, config, null)
      .accounts({
        registryFactory: registryFactoryPda,
        deployedRegistry: deployedRegistryPda,
        deployer: this.provider.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .rpc();
  }

  async upgradeRegistry(registryId: PublicKey, newVersion: string, upgradeData: any) {
    const registryFactoryPda = this.pda.findRegistryFactoryPda();

    return this.program.methods
      .upgradeRegistry(newVersion, upgradeData)
      .accounts({
        registryFactory: registryFactoryPda,
        deployedRegistry: registryId,
        upgrader: this.provider.publicKey,
      })
      .rpc();
  }
}

