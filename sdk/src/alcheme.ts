import { Connection, PublicKey, Keypair } from "@solana/web3.js";
import { AnchorProvider, Wallet } from "@coral-xyz/anchor";
import { PdaUtils } from "./utils/pda";
import { IdentityModule } from "./modules/identity";
import { ContentModule } from "./modules/content";
import { AccessModule } from "./modules/access";
import { EventModule } from "./modules/event";
import { FactoryModule } from "./modules/factory";
import { MessagingModule } from "./modules/messaging";
import { CirclesModule } from "./modules/circles";
import { ContributionEngineModule } from "./modules/contribution-engine";
import { ExternalAppRegistryModule } from "./modules/external-app-registry";
import { installAlreadyProcessedSendAndConfirmRecovery } from "./utils/transactions";

export interface AlchemeConfig {
  connection: Connection;
  wallet?: Wallet; // Optional for read-only
  programIds: {
    identity: string;
    content: string;
    access: string;
    event: string;
    factory: string;
    messaging?: string;
    circles?: string;
    contributionEngine?: string;
    externalAppRegistry?: string;
  };
}

export class Alcheme {
  public provider: AnchorProvider;
  public pda: PdaUtils;
  public connection: Connection;

  // Modules
  public identity: IdentityModule;
  public content: ContentModule;
  public access: AccessModule;
  public event: EventModule;
  public factory: FactoryModule;
  public messaging: MessagingModule;
  public circles: CirclesModule;
  public contributionEngine?: ContributionEngineModule;
  public externalAppRegistry?: ExternalAppRegistryModule;

  constructor(config: AlchemeConfig) {
    this.connection = config.connection;
    
    // Use a dummy wallet if none provided (for read-only)
    const wallet = config.wallet || new Wallet(new Keypair());
    
    this.provider = new AnchorProvider(
      this.connection,
      wallet,
      AnchorProvider.defaultOptions()
    );
    installAlreadyProcessedSendAndConfirmRecovery(this.provider);

    const programIds = {
      identity: new PublicKey(config.programIds.identity),
      content: new PublicKey(config.programIds.content),
      access: new PublicKey(config.programIds.access),
      event: new PublicKey(config.programIds.event),
      factory: new PublicKey(config.programIds.factory),
      messaging: config.programIds.messaging 
        ? new PublicKey(config.programIds.messaging)
        : new PublicKey("FEDXa8waYWu7XaZbm1peEV6SQA5A8bdz1dWBBejmfJUZ"),
      circles: config.programIds.circles
        ? new PublicKey(config.programIds.circles)
        : new PublicKey("4sisPMeR1uY1wd6XKazN9VsXpXB764WeYYh14EDsujJ5"),
      contributionEngine: config.programIds.contributionEngine
        ? new PublicKey(config.programIds.contributionEngine)
        : null,
    };

    this.pda = new PdaUtils(programIds);

    // Initialize modules
    this.identity = new IdentityModule(this.provider, programIds.identity, this.pda);
    this.content = new ContentModule(this.provider, programIds.content, this.pda);
    this.access = new AccessModule(this.provider, programIds.access, this.pda);
    this.event = new EventModule(this.provider, programIds.event, this.pda);
    this.factory = new FactoryModule(this.provider, programIds.factory, this.pda);
    this.messaging = new MessagingModule(this.provider, programIds.messaging, this.pda);
    this.circles = new CirclesModule(this.provider, programIds.circles, this.pda);
    if (programIds.contributionEngine) {
      this.contributionEngine = new ContributionEngineModule(
        this.provider,
        programIds.contributionEngine,
        this.pda
      );
    }
    if (config.programIds.externalAppRegistry) {
      this.externalAppRegistry = new ExternalAppRegistryModule(
        new PublicKey(config.programIds.externalAppRegistry)
      );
    }
  }
}
