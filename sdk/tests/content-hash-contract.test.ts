import { createHash } from "node:crypto";
import { describe, expect, test } from "@jest/globals";
import { PublicKey } from "@solana/web3.js";

import { ContentModule } from "../src/modules/content";

const AUTHOR = new PublicKey("11111111111111111111111111111111");

function contractHash(input: {
  text: string;
  contentTypeDiscriminant: number;
  createdAt: bigint;
  author: PublicKey;
  mediaAttachments: Array<{ uri: string; fileSize?: bigint | null }>;
}): string {
  const hash = createHash("sha256");
  hash.update(Buffer.from(input.text, "utf8"));
  hash.update(Buffer.from([input.contentTypeDiscriminant]));

  const createdAtBytes = Buffer.alloc(8);
  createdAtBytes.writeBigInt64LE(input.createdAt);
  hash.update(createdAtBytes);
  hash.update(input.author.toBuffer());

  const mediaSizeBytes: number[] = [];
  for (const attachment of input.mediaAttachments) {
    hash.update(Buffer.from(attachment.uri, "utf8"));
    if (attachment.fileSize !== undefined && attachment.fileSize !== null) {
      const fileSizeBytes = Buffer.alloc(8);
      fileSizeBytes.writeBigUInt64LE(attachment.fileSize);
      mediaSizeBytes.push(...fileSizeBytes);
    }
  }
  if (mediaSizeBytes.length > 0) {
    hash.update(Buffer.from(mediaSizeBytes));
  }

  return hash.digest("hex");
}

describe("ContentModule contract hash compatibility", () => {
  test("validateContentIntegrity matches the contract-side content hash convention instead of text-only placeholder hashing", async () => {
    const module = Object.create(ContentModule.prototype) as ContentModule;
    const expectedHash = contractHash({
      text: "Seeded source material body",
      contentTypeDiscriminant: 4,
      createdAt: 1711234567n,
      author: AUTHOR,
      mediaAttachments: [
        { uri: "ipfs://seeded-reference.pdf", fileSize: 4096n },
      ],
    });

    const ok = await module.validateContentIntegrity({
      contentHash: Array.from(Buffer.from(expectedHash, "hex")),
      contentType: "Document",
      createdAt: "1711234567",
      authorIdentity: AUTHOR.toBase58(),
      mediaAttachments: [
        { uri: "ipfs://seeded-reference.pdf", fileSize: 4096 },
      ],
    }, "Seeded source material body");

    expect(ok).toBe(true);
  });

  test("validateContentIntegrity returns false when fetched text does not match the contract hash payload", async () => {
    const module = Object.create(ContentModule.prototype) as ContentModule;
    const expectedHash = contractHash({
      text: "Original body",
      contentTypeDiscriminant: 0,
      createdAt: 1711234567n,
      author: AUTHOR,
      mediaAttachments: [],
    });

    const ok = await module.validateContentIntegrity({
      contentHash: Array.from(Buffer.from(expectedHash, "hex")),
      contentType: "Text",
      createdAt: 1711234567,
      authorIdentity: AUTHOR,
      mediaAttachments: [],
    }, "Tampered body");

    expect(ok).toBe(false);
  });
});
