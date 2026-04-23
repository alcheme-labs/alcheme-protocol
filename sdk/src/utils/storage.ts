/**
 * Storage Providers for Alcheme Protocol
 * 
 * This module provides concrete implementations of storage providers
 * for Arweave, IPFS, and custom solutions.
 */

import { StorageProvider } from "../modules/content";

/**
 * Arweave Storage Provider using Irys (formerly Bundlr)
 * Recommended for permanent storage of videos, audio, and large files
 * 
 * Installation: npm install @irys/sdk
 * 
 * @example
 * ```typescript
 * import Irys from "@irys/sdk";
 * const irys = new Irys({ url: "https://node2.irys.xyz", token: "solana", key: wallet });
 * const provider = new IrysArweaveProvider(irys);
 * ```
 */
export class IrysArweaveProvider implements StorageProvider {
    name = "Arweave (via Irys)";
    private irys: any;

    constructor(irysInstance: any) {
        this.irys = irysInstance;
    }

    /**
     * Initialize Irys with Solana wallet
     * Note: This is a helper method. You can also pass an initialized Irys instance directly.
     */
    static async create(wallet: any, network: "mainnet" | "devnet" = "mainnet"): Promise<IrysArweaveProvider> {
        try {
            // Dynamic import to avoid bundling if not used
            // @ts-ignore
            const Irys = (await import("@irys/sdk")).default;
            
            const url = network === "mainnet" 
                ? "https://node2.irys.xyz" 
                : "https://devnet.irys.xyz";
            
            const irys = new Irys({ 
                url,
                token: "solana", 
                key: wallet 
            });
            
            return new IrysArweaveProvider(irys);
        } catch (error) {
            throw new Error(`Failed to initialize Irys: ${error}. Make sure @irys/sdk is installed.`);
        }
    }

    async uploadFile(file: File | Buffer): Promise<string> {
        try {
            // Irys API: upload(data, options)
            const receipt = await this.irys.upload(file);
            
            // Return standard arweave:// URI format
            return `arweave://${receipt.id}`;
        } catch (error) {
            throw new Error(`Arweave upload failed: ${error}`);
        }
    }

    /**
     * Get the actual HTTP URL for accessing the content
     */
    static getHttpUrl(arweaveUri: string): string {
        const txId = arweaveUri.replace("arweave://", "");
        return `https://arweave.net/${txId}`;
    }

    /**
     * Estimate upload cost in lamports
     */
    async estimateCost(fileSize: number): Promise<number> {
        try {
            const price = await this.irys.getPrice(fileSize);
            return parseInt(price.toString());
        } catch (error) {
            throw new Error(`Failed to estimate cost: ${error}`);
        }
    }
}

/**
 * IPFS Storage Provider using Pinata
 * Recommended for images, temporary content, and live streams
 * 
 * Installation: npm install @pinata/sdk
 * 
 * @example
 * ```typescript
 * import { PinataSDK } from "@pinata/sdk";
 * const pinata = new PinataSDK({ pinataJwt: "YOUR_JWT" });
 * const provider = new PinataIPFSProvider(pinata);
 * ```
 */
export class PinataIPFSProvider implements StorageProvider {
    name = "IPFS (via Pinata)";
    private pinata: any;

    constructor(pinataInstance: any) {
        this.pinata = pinataInstance;
    }

    /**
     * Initialize Pinata with JWT token
     */
    static async create(jwt: string): Promise<PinataIPFSProvider> {
        try {
            // @ts-ignore
            const { PinataSDK } = await import("@pinata/sdk");
            const pinata = new PinataSDK({ pinataJwt: jwt });
            
            // Test authentication
            await pinata.testAuthentication();
            
            return new PinataIPFSProvider(pinata);
        } catch (error) {
            throw new Error(`Failed to initialize Pinata: ${error}. Make sure @pinata/sdk is installed and JWT is valid.`);
        }
    }

    async uploadFile(file: File | Buffer): Promise<string> {
        try {
            // Pinata API: upload.file(file)
            const upload = await this.pinata.upload.file(file);
            
            // Return standard ipfs:// URI format
            return `ipfs://${upload.IpfsHash}`;
        } catch (error) {
            throw new Error(`IPFS upload failed: ${error}`);
        }
    }

    /**
     * Get the actual HTTP URL for accessing the content via gateway
     */
    static getHttpUrl(ipfsUri: string, gateway: string = "https://gateway.pinata.cloud"): string {
        const cid = ipfsUri.replace("ipfs://", "");
        return `${gateway}/ipfs/${cid}`;
    }
}

/**
 * Custom Self-Hosted Storage Provider
 * For users who want to run their own storage infrastructure
 * 
 * @example
 * ```typescript
 * const provider = new CustomStorageProvider({
 *     name: "MyServer",
 *     uploadEndpoint: "https://api.myserver.com/upload",
 *     headers: { "Authorization": "Bearer TOKEN" }
 * });
 * ```
 */
export class CustomStorageProvider implements StorageProvider {
    name: string;
    private uploadEndpoint: string;
    private headers: Record<string, string>;

    constructor(config: {
        name: string;
        uploadEndpoint: string;
        headers?: Record<string, string>;
    }) {
        this.name = config.name;
        this.uploadEndpoint = config.uploadEndpoint;
        this.headers = config.headers || {};
    }

    async uploadFile(file: File | Buffer): Promise<string> {
        try {
            const formData = new FormData();
            formData.append("file", file as any);

            const response = await fetch(this.uploadEndpoint, {
                method: "POST",
                body: formData,
                headers: this.headers,
            });

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }

            const data = await response.json();
            
            // Expecting the server to return { url: "https://..." }
            if (!data.url) {
                throw new Error("Server response missing 'url' field");
            }

            return data.url;
        } catch (error) {
            throw new Error(`Custom storage upload failed: ${error}`);
        }
    }
}

/**
 * Hybrid Storage Provider
 * Uploads to Arweave (permanent) and IPFS (fast CDN) simultaneously
 * 
 * @example
 * ```typescript
 * const hybrid = await StorageProviderFactory.createHybrid(wallet, pinataJwt);
 * const { primary, cdn } = await hybrid.uploadWithBoth(file);
 * ```
 */
export class HybridStorageProvider implements StorageProvider {
    name = "Hybrid (Arweave + IPFS)";
    private arweaveProvider: IrysArweaveProvider;
    private ipfsProvider: PinataIPFSProvider;

    constructor(arweaveProvider: IrysArweaveProvider, ipfsProvider: PinataIPFSProvider) {
        this.arweaveProvider = arweaveProvider;
        this.ipfsProvider = ipfsProvider;
    }

    async uploadFile(file: File | Buffer): Promise<string> {
        // Upload to both in parallel
        const [arweaveUri, ipfsUri] = await Promise.all([
            this.arweaveProvider.uploadFile(file),
            this.ipfsProvider.uploadFile(file),
        ]);

        // Return Arweave as primary (permanent storage)
        // IPFS URI will be stored in cdn_uri field via update_storage_info
        return arweaveUri;
    }

    /**
     * Upload to both and return both URIs
     * Use this when you want to set cdn_uri immediately
     */
    async uploadWithBoth(file: File | Buffer): Promise<{ primary: string; cdn: string }> {
        const [arweaveUri, ipfsUri] = await Promise.all([
            this.arweaveProvider.uploadFile(file),
            this.ipfsProvider.uploadFile(file),
        ]);

        return {
            primary: arweaveUri,
            cdn: ipfsUri,
        };
    }
}

/**
 * Storage Provider Factory
 * Convenience methods for creating providers
 */
export class StorageProviderFactory {
    /**
     * Create Arweave provider
     * @param wallet - Solana wallet instance or private key
     * @param network - "mainnet" or "devnet"
     */
    static async createArweave(wallet: any, network: "mainnet" | "devnet" = "mainnet"): Promise<IrysArweaveProvider> {
        return IrysArweaveProvider.create(wallet, network);
    }

    /**
     * Create IPFS provider
     * @param pinataJwt - Pinata JWT token (get from https://pinata.cloud)
     */
    static async createIPFS(pinataJwt: string): Promise<PinataIPFSProvider> {
        return PinataIPFSProvider.create(pinataJwt);
    }

    /**
     * Create custom provider
     * @param config - Configuration for custom storage endpoint
     */
    static createCustom(config: {
        name: string;
        uploadEndpoint: string;
        headers?: Record<string, string>;
    }): CustomStorageProvider {
        return new CustomStorageProvider(config);
    }

    /**
     * Create hybrid provider (Arweave + IPFS)
     * @param wallet - Solana wallet for Arweave
     * @param pinataJwt - Pinata JWT for IPFS
     * @param network - Network for Arweave
     */
    static async createHybrid(
        wallet: any,
        pinataJwt: string,
        network: "mainnet" | "devnet" = "mainnet"
    ): Promise<HybridStorageProvider> {
        const arweave = await IrysArweaveProvider.create(wallet, network);
        const ipfs = await PinataIPFSProvider.create(pinataJwt);
        return new HybridStorageProvider(arweave, ipfs);
    }
}
