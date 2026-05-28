const { test } = require('@jest/globals');
const assert = require('node:assert/strict');
const { Ed25519Program, PublicKey, SYSVAR_INSTRUCTIONS_PUBKEY, SystemProgram } = require('@solana/web3.js');
const { CirclesModule } = require('../dist/modules/circles.js');

test('predictNextKnowledgePda derives the next knowledge PDA from circle knowledge count', async () => {
  const circleProgramId = new PublicKey('GZswb1rGbZfoiapkvatDuMZrptVAX2p1pEVDSrMuyLqQ');
  const circlePda = PublicKey.findProgramAddressSync(
    [Buffer.from('circle'), Buffer.from([7])],
    circleProgramId,
  )[0];

  const fake = {
    programId: circleProgramId,
    findCirclePda: CirclesModule.prototype.findCirclePda,
    toBN: CirclesModule.prototype.toBN,
    async getCircle(circleId) {
      assert.equal(circleId, 7);
      return {
        knowledgeCount: 3n,
      };
    },
  };

  const actual = await CirclesModule.prototype.predictNextKnowledgePda.call(fake, 7);
  const expected = PublicKey.findProgramAddressSync(
    [
      Buffer.from('knowledge'),
      circlePda.toBuffer(),
      Buffer.from([3, 0, 0, 0, 0, 0, 0, 0]),
    ],
    circleProgramId,
  )[0];

  assert.equal(actual.toBase58(), expected.toBase58());
});

test('updateContributors sends update_contributors with event accounts and normalized root', async () => {
  const knowledgePda = new PublicKey('6vQbd3i5xk4vV8zWq41W8KkkH4A9s2gA89cWQW3Fz7Eg');
  const circlePda = new PublicKey('9NwT91mM1qKQ8FQx8M8vNm2A2Sk9g1FQyN1xwH1iT6EY');
  const authority = new PublicKey('11111111111111111111111111111111');
  const eventProgram = new PublicKey('HRv5Fn4DLKfZ9pBBgHMknP9tAMXaN1bnuZyXfVE4sjkF');
  const eventEmitter = new PublicKey('8ZiyjNgn5wYxgQjN5x1aM5q1Q12u3S7n9L8yb9o8FQ7r');
  const eventBatch = new PublicKey('6m6J8y4e6u4Yv6Ew6D1jFJfM1Fh3h6gW5L2aR7x8q9pT');
  const proofPackageHash = 'cd'.repeat(32);
  const rootHex = 'ab'.repeat(32);

  const calls = [];
  const fake = {
    provider: { publicKey: authority },
    programId: new PublicKey('GZswb1rGbZfoiapkvatDuMZrptVAX2p1pEVDSrMuyLqQ'),
    findCirclePda: CirclesModule.prototype.findCirclePda,
    pda: {
      findKnowledgeBindingPda(knowledge) {
        return PublicKey.findProgramAddressSync(
          [Buffer.from('knowledge_binding'), knowledge.toBuffer()],
          fake.programId,
        )[0];
      },
    },
    async resolveEventAccounts() {
      return { eventProgram, eventEmitter, eventBatch };
    },
    normalizeContentHash(value) {
      return CirclesModule.prototype.normalizeContentHash.call(this, value);
    },
    validateContributorsInput(circleId, contributorsCount) {
      return CirclesModule.prototype.validateContributorsInput.call(this, circleId, contributorsCount);
    },
    program: {
      methods: {
        updateContributors(hash, root, count) {
          calls.push({ hash, root, count });
          return {
            accounts(input) {
              calls.push({ accounts: input });
              return {
                rpc: async () => 'mock_tx_signature',
              };
            },
          };
        },
      },
    },
  };

  const signature = await CirclesModule.prototype.updateContributors.call(fake, {
    circleId: 7,
    knowledgePda,
    proofPackageHash,
    contributorsRoot: rootHex,
    contributorsCount: 4,
  });

  const derivedCirclePda = PublicKey.findProgramAddressSync(
    [Buffer.from('circle'), Buffer.from([7])],
    fake.programId,
  )[0];
  const derivedKnowledgeBindingPda = PublicKey.findProgramAddressSync(
    [Buffer.from('knowledge_binding'), knowledgePda.toBuffer()],
    fake.programId,
  )[0];

  assert.equal(signature, 'mock_tx_signature');
  assert.deepEqual(calls[0], {
    hash: Array.from(Buffer.from(proofPackageHash, 'hex')),
    root: Array.from(Buffer.from(rootHex, 'hex')),
    count: 4,
  });
  assert.deepEqual(calls[1], {
    accounts: {
      knowledge: knowledgePda,
      circle: derivedCirclePda,
      knowledgeBinding: derivedKnowledgeBindingPda,
      authority,
      eventProgram,
      eventEmitter,
      eventBatch,
      systemProgram: SystemProgram.programId,
    },
  });
});

test('submitKnowledge reuses explicit knowledge PDA when provided', async () => {
  const knowledgePda = new PublicKey('F9n4H7z4tBgfAiMEV4f7LmmtmXGDu4uGDC7Ka3rUn6Qu');
  const authority = new PublicKey('11111111111111111111111111111111');
  const eventProgram = new PublicKey('HRv5Fn4DLKfZ9pBBgHMknP9tAMXaN1bnuZyXfVE4sjkF');
  const eventEmitter = new PublicKey('8ZiyjNgn5wYxgQjN5x1aM5q1Q12u3S7n9L8yb9o8FQ7r');
  const eventBatch = new PublicKey('6m6J8y4e6u4Yv6Ew6D1jFJfM1Fh3h6gW5L2aR7x8q9pT');
  const calls = [];

  const fake = {
    provider: { publicKey: authority },
    programId: new PublicKey('GZswb1rGbZfoiapkvatDuMZrptVAX2p1pEVDSrMuyLqQ'),
    findCirclePda: CirclesModule.prototype.findCirclePda,
    normalizeContentHash(value) {
      return CirclesModule.prototype.normalizeContentHash.call(this, value);
    },
    async predictNextKnowledgePda() {
      throw new Error('predictNextKnowledgePda should not be called when knowledgePda is explicit');
    },
    async resolveEventAccounts() {
      return { eventProgram, eventEmitter, eventBatch };
    },
    program: {
      methods: {
        submitKnowledge(ipfsCid, contentHash, title, description) {
          calls.push({ ipfsCid, contentHash, title, description });
          return {
            accounts(input) {
              calls.push({ accounts: input });
              return {
                rpc: async () => 'knowledge_tx_signature',
              };
            },
          };
        },
      },
    },
  };

  const signature = await CirclesModule.prototype.submitKnowledge.call(fake, {
    circleId: 7,
    knowledgePda,
    ipfsCid: 'bafybeibfexplicitknowledgecid123456789',
    contentHash: 'cd'.repeat(32),
    title: 'Explicit PDA',
    description: 'Uses the caller-provided PDA',
  });

  const derivedCirclePda = PublicKey.findProgramAddressSync(
    [Buffer.from('circle'), Buffer.from([7])],
    fake.programId,
  )[0];

  assert.equal(signature, 'knowledge_tx_signature');
  assert.deepEqual(calls[0], {
    ipfsCid: 'bafybeibfexplicitknowledgecid123456789',
    contentHash: Array.from(Buffer.from('cd'.repeat(32), 'hex')),
    title: 'Explicit PDA',
    description: 'Uses the caller-provided PDA',
  });
  assert.deepEqual(calls[1], {
    accounts: {
      knowledge: knowledgePda,
      circle: derivedCirclePda,
      circleManager: PublicKey.findProgramAddressSync(
        [Buffer.from('circle_manager')],
        fake.programId,
      )[0],
      author: authority,
      eventProgram,
      eventEmitter,
      eventBatch,
      systemProgram: SystemProgram.programId,
    },
  });
});

test('submitKnowledge clamps multibyte title and description to on-chain byte limits before rpc', async () => {
  const knowledgePda = new PublicKey('F9n4H7z4tBgfAiMEV4f7LmmtmXGDu4uGDC7Ka3rUn6Qu');
  const authority = new PublicKey('11111111111111111111111111111111');
  const eventProgram = new PublicKey('HRv5Fn4DLKfZ9pBBgHMknP9tAMXaN1bnuZyXfVE4sjkF');
  const eventEmitter = new PublicKey('8ZiyjNgn5wYxgQjN5x1aM5q1Q12u3S7n9L8yb9o8FQ7r');
  const eventBatch = new PublicKey('6m6J8y4e6u4Yv6Ew6D1jFJfM1Fh3h6gW5L2aR7x8q9pT');
  const calls = [];

  const fake = {
    provider: { publicKey: authority },
    programId: new PublicKey('GZswb1rGbZfoiapkvatDuMZrptVAX2p1pEVDSrMuyLqQ'),
    findCirclePda: CirclesModule.prototype.findCirclePda,
    normalizeContentHash(value) {
      return CirclesModule.prototype.normalizeContentHash.call(this, value);
    },
    async predictNextKnowledgePda() {
      throw new Error('predictNextKnowledgePda should not be called when knowledgePda is explicit');
    },
    async resolveEventAccounts() {
      return { eventProgram, eventEmitter, eventBatch };
    },
    program: {
      methods: {
        submitKnowledge(ipfsCid, contentHash, title, description) {
          calls.push({ ipfsCid, contentHash, title, description });
          return {
            accounts(input) {
              calls.push({ accounts: input });
              return {
                rpc: async () => 'knowledge_tx_signature',
              };
            },
          };
        },
      },
    },
  };

  const longTitle = '标题很长'.repeat(20);
  const longDescription = '这是一个非常长的中文描述，用来验证字节长度裁剪是否真的在调用链上生效。'.repeat(20);

  const signature = await CirclesModule.prototype.submitKnowledge.call(fake, {
    circleId: 7,
    knowledgePda,
    ipfsCid: 'bafybeibfexplicitknowledgecid123456789',
    contentHash: 'cd'.repeat(32),
    title: longTitle,
    description: longDescription,
  });

  assert.equal(signature, 'knowledge_tx_signature');
  assert.equal(calls.length, 2);
  assert.ok(Buffer.byteLength(calls[0].title, 'utf8') <= 128, 'title should fit on-chain byte budget');
  assert.ok(Buffer.byteLength(calls[0].description, 'utf8') <= 256, 'description should fit on-chain byte budget');
  assert.equal(Buffer.byteLength(calls[0].title, 'utf8') > 0, true);
  assert.equal(Buffer.byteLength(calls[0].description, 'utf8') > 0, true);
});

test('updateContributors surfaces on-chain mismatch failure without swallowing error', async () => {
  const knowledgePda = new PublicKey('6vQbd3i5xk4vV8zWq41W8KkkH4A9s2gA89cWQW3Fz7Eg');
  const authority = new PublicKey('11111111111111111111111111111111');
  const eventProgram = new PublicKey('HRv5Fn4DLKfZ9pBBgHMknP9tAMXaN1bnuZyXfVE4sjkF');
  const eventEmitter = new PublicKey('8ZiyjNgn5wYxgQjN5x1aM5q1Q12u3S7n9L8yb9o8FQ7r');
  const eventBatch = new PublicKey('6m6J8y4e6u4Yv6Ew6D1jFJfM1Fh3h6gW5L2aR7x8q9pT');

  const fake = {
    provider: { publicKey: authority },
    programId: new PublicKey('GZswb1rGbZfoiapkvatDuMZrptVAX2p1pEVDSrMuyLqQ'),
    findCirclePda: CirclesModule.prototype.findCirclePda,
    pda: {
      findKnowledgeBindingPda(knowledge) {
        return PublicKey.findProgramAddressSync(
          [Buffer.from('knowledge_binding'), knowledge.toBuffer()],
          fake.programId,
        )[0];
      },
    },
    async resolveEventAccounts() {
      return { eventProgram, eventEmitter, eventBatch };
    },
    normalizeContentHash(value) {
      return CirclesModule.prototype.normalizeContentHash.call(this, value);
    },
    validateContributorsInput(circleId, contributorsCount) {
      return CirclesModule.prototype.validateContributorsInput.call(this, circleId, contributorsCount);
    },
    program: {
      methods: {
        updateContributors() {
          return {
            accounts() {
              return {
                rpc: async () => {
                  throw new Error('InvalidOperation: knowledge_circle_mismatch');
                },
              };
            },
          };
        },
      },
    },
  };

  await assert.rejects(
    () => CirclesModule.prototype.updateContributors.call(fake, {
      circleId: 1,
      knowledgePda,
      proofPackageHash: 'cd'.repeat(32),
      contributorsRoot: 'ab'.repeat(32),
      contributorsCount: 2,
    }),
    /knowledge_circle_mismatch|InvalidOperation/i,
  );
});

test('submitKnowledge surfaces curator-only rejection from on-chain program', async () => {
  const knowledgePda = new PublicKey('F9n4H7z4tBgfAiMEV4f7LmmtmXGDu4uGDC7Ka3rUn6Qu');
  const authority = new PublicKey('11111111111111111111111111111111');
  const eventProgram = new PublicKey('HRv5Fn4DLKfZ9pBBgHMknP9tAMXaN1bnuZyXfVE4sjkF');
  const eventEmitter = new PublicKey('8ZiyjNgn5wYxgQjN5x1aM5q1Q12u3S7n9L8yb9o8FQ7r');
  const eventBatch = new PublicKey('6m6J8y4e6u4Yv6Ew6D1jFJfM1Fh3h6gW5L2aR7x8q9pT');

  const fake = {
    provider: { publicKey: authority },
    programId: new PublicKey('GZswb1rGbZfoiapkvatDuMZrptVAX2p1pEVDSrMuyLqQ'),
    findCirclePda: CirclesModule.prototype.findCirclePda,
    normalizeContentHash(value) {
      return CirclesModule.prototype.normalizeContentHash.call(this, value);
    },
    async predictNextKnowledgePda() {
      return knowledgePda;
    },
    async resolveEventAccounts() {
      return { eventProgram, eventEmitter, eventBatch };
    },
    program: {
      methods: {
        submitKnowledge() {
          return {
            accounts() {
              return {
                rpc: async () => {
                  throw new Error('InvalidOperation: curator_only');
                },
              };
            },
          };
        },
      },
    },
  };

  await assert.rejects(
    () => CirclesModule.prototype.submitKnowledge.call(fake, {
      circleId: 7,
      knowledgePda,
      ipfsCid: 'bafybeibfexplicitknowledgecid123456789',
      contentHash: 'cd'.repeat(32),
      title: 'Curator Gate',
      description: 'Should fail for non-curator',
    }),
    /curator_only|InvalidOperation/i,
  );
});

test('bindAndUpdateContributors sends atomic bind+update payload with registry and binding PDAs', async () => {
  const authority = new PublicKey('11111111111111111111111111111111');
  const knowledgePda = new PublicKey('6vQbd3i5xk4vV8zWq41W8KkkH4A9s2gA89cWQW3Fz7Eg');
  const issuer = new PublicKey('9NwT91mM1qKQ8FQx8M8vNm2A2Sk9g1FQyN1xwH1iT6EY');
  const eventProgram = new PublicKey('HRv5Fn4DLKfZ9pBBgHMknP9tAMXaN1bnuZyXfVE4sjkF');
  const eventEmitter = new PublicKey('8ZiyjNgn5wYxgQjN5x1aM5q1Q12u3S7n9L8yb9o8FQ7r');
  const eventBatch = new PublicKey('6m6J8y4e6u4Yv6Ew6D1jFJfM1Fh3h6gW5L2aR7x8q9pT');
  const generatedAt = '2026-03-13T12:00:00.000Z';

  const calls = [];
  const fake = {
    provider: { publicKey: authority },
    programId: new PublicKey('GZswb1rGbZfoiapkvatDuMZrptVAX2p1pEVDSrMuyLqQ'),
    findCirclePda: CirclesModule.prototype.findCirclePda,
    pda: {
      findKnowledgeBindingPda(knowledge) {
        return PublicKey.findProgramAddressSync(
          [Buffer.from('knowledge_binding'), knowledge.toBuffer()],
          fake.programId,
        )[0];
      },
      findProofAttestorRegistryPda() {
        return PublicKey.findProgramAddressSync(
          [Buffer.from('proof_attestor_registry')],
          fake.programId,
        )[0];
      },
    },
    async resolveEventAccounts() {
      return { eventProgram, eventEmitter, eventBatch };
    },
    normalizeContentHash(value) {
      return CirclesModule.prototype.normalizeContentHash.call(this, value);
    },
    normalizePubkey(value) {
      return CirclesModule.prototype.normalizePubkey.call(this, value);
    },
    normalizeSignature(value) {
      return CirclesModule.prototype.normalizeSignature.call(this, value);
    },
    buildProofBindingDigest(input) {
      return CirclesModule.prototype.buildProofBindingDigest.call(this, input);
    },
    toUnixSeconds(value) {
      return CirclesModule.prototype.toUnixSeconds.call(this, value);
    },
    validateContributorsInput(circleId, contributorsCount) {
      return CirclesModule.prototype.validateContributorsInput.call(this, circleId, contributorsCount);
    },
    program: {
      methods: {
        bindAndUpdateContributors(...args) {
          calls.push({ args });
          return {
            accounts(input) {
              calls.push({ accounts: input });
              return {
                preInstructions(instructions) {
                  calls.push({ preInstructions: instructions });
                  return {
                    rpc: async () => 'bind_update_signature',
                  };
                },
              };
            },
          };
        },
      },
    },
  };

  const signature = await CirclesModule.prototype.bindAndUpdateContributors.call(fake, {
    circleId: 7,
    knowledgePda,
    sourceAnchorId: '11'.repeat(32),
    proofPackageHash: '22'.repeat(32),
    contributorsRoot: '33'.repeat(32),
    contributorsCount: 2,
    bindingVersion: 1,
    generatedAt,
    issuerKeyId: issuer.toBase58(),
    issuedSignature: '44'.repeat(64),
  });

  assert.equal(signature, 'bind_update_signature');
  assert.equal(calls.length, 3);
  assert.equal(calls[0].args.length, 8);
  assert.equal(calls[0].args[5].toString(), String(Math.floor(Date.parse(generatedAt) / 1000)));
  assert.equal(calls[0].args[6].toBase58(), issuer.toBase58());
  assert.deepEqual(calls[1].accounts.authority, authority);
  assert.deepEqual(calls[1].accounts.instructionsSysvar, SYSVAR_INSTRUCTIONS_PUBKEY);
  assert.deepEqual(calls[1].accounts.systemProgram, SystemProgram.programId);
  assert.equal(calls[2].preInstructions.length, 1);
  assert.equal(calls[2].preInstructions[0].programId.toBase58(), Ed25519Program.programId.toBase58());
});

test('bindAndUpdateContributors allows issuerKeyId differing from provider without proof attestor signer', async () => {
  const authority = new PublicKey('11111111111111111111111111111111');
  const knowledgePda = new PublicKey('6vQbd3i5xk4vV8zWq41W8KkkH4A9s2gA89cWQW3Fz7Eg');
  const issuer = new PublicKey('9NwT91mM1qKQ8FQx8M8vNm2A2Sk9g1FQyN1xwH1iT6EY');
  const eventProgram = new PublicKey('HRv5Fn4DLKfZ9pBBgHMknP9tAMXaN1bnuZyXfVE4sjkF');
  const eventEmitter = new PublicKey('8ZiyjNgn5wYxgQjN5x1aM5q1Q12u3S7n9L8yb9o8FQ7r');
  const eventBatch = new PublicKey('6m6J8y4e6u4Yv6Ew6D1jFJfM1Fh3h6gW5L2aR7x8q9pT');
  const calls = [];

  const fake = {
    provider: { publicKey: authority },
    programId: new PublicKey('GZswb1rGbZfoiapkvatDuMZrptVAX2p1pEVDSrMuyLqQ'),
    findCirclePda: CirclesModule.prototype.findCirclePda,
    pda: {
      findKnowledgeBindingPda(knowledge) {
        return PublicKey.findProgramAddressSync(
          [Buffer.from('knowledge_binding'), knowledge.toBuffer()],
          fake.programId,
        )[0];
      },
      findProofAttestorRegistryPda() {
        return PublicKey.findProgramAddressSync(
          [Buffer.from('proof_attestor_registry')],
          fake.programId,
        )[0];
      },
    },
    async resolveEventAccounts() {
      return { eventProgram, eventEmitter, eventBatch };
    },
    normalizeContentHash(value) {
      return CirclesModule.prototype.normalizeContentHash.call(this, value);
    },
    normalizePubkey(value) {
      return CirclesModule.prototype.normalizePubkey.call(this, value);
    },
    normalizeSignature(value) {
      return CirclesModule.prototype.normalizeSignature.call(this, value);
    },
    buildProofBindingDigest(input) {
      return CirclesModule.prototype.buildProofBindingDigest.call(this, input);
    },
    toUnixSeconds(value) {
      return CirclesModule.prototype.toUnixSeconds.call(this, value);
    },
    validateContributorsInput(circleId, contributorsCount) {
      return CirclesModule.prototype.validateContributorsInput.call(this, circleId, contributorsCount);
    },
    program: {
      methods: {
        bindAndUpdateContributors(...args) {
          calls.push({ args });
          return {
            accounts(input) {
              calls.push({ accounts: input });
              return {
                preInstructions(instructions) {
                  calls.push({ preInstructions: instructions });
                  return {
                    rpc: async () => 'bind_update_signature_without_attestor_signer',
                  };
                },
              };
            },
          };
        },
      },
    },
  };

  const signature = await CirclesModule.prototype.bindAndUpdateContributors.call(fake, {
    circleId: 7,
    knowledgePda,
    sourceAnchorId: '11'.repeat(32),
    proofPackageHash: '22'.repeat(32),
    contributorsRoot: '33'.repeat(32),
    contributorsCount: 2,
    bindingVersion: 1,
    generatedAt: '2026-03-13T12:00:00.000Z',
    issuerKeyId: issuer.toBase58(),
    issuedSignature: '44'.repeat(64),
  });
  assert.equal(signature, 'bind_update_signature_without_attestor_signer');
  assert.equal(calls.length, 3);
  assert.deepEqual(calls[1].accounts.instructionsSysvar, SYSVAR_INSTRUCTIONS_PUBKEY);
  assert.equal(calls[2].preInstructions.length, 1);
});

test('proof binding digest does not require Buffer BigInt write helpers', () => {
  const originalWriteBigInt64LE = Buffer.prototype.writeBigInt64LE;
  try {
    Buffer.prototype.writeBigInt64LE = undefined;

    const digest = CirclesModule.prototype.buildProofBindingDigest.call(
      {},
      {
        sourceAnchorId: Array.from(Buffer.from('11'.repeat(32), 'hex')),
        proofPackageHash: Array.from(Buffer.from('22'.repeat(32), 'hex')),
        contributorsRoot: Array.from(Buffer.from('33'.repeat(32), 'hex')),
        contributorsCount: 2,
        bindingVersion: 1,
        generatedAt: 1773403200,
      },
    );

    assert.equal(digest.length, 32);
  } finally {
    Buffer.prototype.writeBigInt64LE = originalWriteBigInt64LE;
  }
});

test('registerProofAttestor routes admin call to proof attestor registry PDA', async () => {
  const authority = new PublicKey('11111111111111111111111111111111');
  const attestor = new PublicKey('7wQmK7xZQ5e8ngz8qQjJvLwF4n7Xh8y5p9x8Vn4xS2Rv');
  const eventProgram = new PublicKey('HRv5Fn4DLKfZ9pBBgHMknP9tAMXaN1bnuZyXfVE4sjkF');
  const eventEmitter = new PublicKey('8ZiyjNgn5wYxgQjN5x1aM5q1Q12u3S7n9L8yb9o8FQ7r');
  const eventBatch = new PublicKey('6m6J8y4e6u4Yv6Ew6D1jFJfM1Fh3h6gW5L2aR7x8q9pT');

  const calls = [];
  const fake = {
    provider: { publicKey: authority },
    programId: new PublicKey('GZswb1rGbZfoiapkvatDuMZrptVAX2p1pEVDSrMuyLqQ'),
    pda: {
      findProofAttestorRegistryPda() {
        return PublicKey.findProgramAddressSync(
          [Buffer.from('proof_attestor_registry')],
          fake.programId,
        )[0];
      },
    },
    async resolveEventAccounts() {
      return { eventProgram, eventEmitter, eventBatch };
    },
    program: {
      methods: {
        registerProofAttestor(target) {
          calls.push({ target });
          return {
            accounts(input) {
              calls.push({ accounts: input });
              return {
                rpc: async () => 'register_attestor_signature',
              };
            },
          };
        },
      },
    },
  };

  const tx = await CirclesModule.prototype.registerProofAttestor.call(fake, attestor);
  assert.equal(tx, 'register_attestor_signature');
  assert.equal(calls[0].target.toBase58(), attestor.toBase58());
  assert.equal(calls[1].accounts.admin.toBase58(), authority.toBase58());
  assert.equal(calls[1].accounts.systemProgram.toBase58(), SystemProgram.programId.toBase58());
});

test('initializeProofAttestorRegistry binds initialization authority to circle_manager admin account', async () => {
  const authority = new PublicKey('11111111111111111111111111111111');
  const calls = [];
  const fake = {
    provider: { publicKey: authority },
    programId: new PublicKey('GZswb1rGbZfoiapkvatDuMZrptVAX2p1pEVDSrMuyLqQ'),
    pda: {
      findProofAttestorRegistryPda() {
        return PublicKey.findProgramAddressSync(
          [Buffer.from('proof_attestor_registry')],
          fake.programId,
        )[0];
      },
    },
    program: {
      methods: {
        initializeProofAttestorRegistry() {
          return {
            accounts(input) {
              calls.push(input);
              return {
                rpc: async () => 'init_attestor_registry_signature',
              };
            },
          };
        },
      },
    },
  };

  const signature = await CirclesModule.prototype.initializeProofAttestorRegistry.call(fake);
  const expectedCircleManager = PublicKey.findProgramAddressSync(
    [Buffer.from('circle_manager')],
    fake.programId,
  )[0];
  assert.equal(signature, 'init_attestor_registry_signature');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].admin.toBase58(), authority.toBase58());
  assert.equal(calls[0].circleManager.toBase58(), expectedCircleManager.toBase58());
});
