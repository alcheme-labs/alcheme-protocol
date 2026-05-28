import { strict as assert } from 'node:assert';
import { describe, it } from '@jest/globals';
import { AnchorProvider, Wallet } from '@coral-xyz/anchor';
import { Connection, Keypair, PublicKey } from '@solana/web3.js';

import { PdaUtils } from '../src/utils/pda';
import { ContributionEngineModule } from '../src/modules/contribution-engine';

describe('ContributionEngineModule compatibility surface', () => {
  const provider = new AnchorProvider(
    new Connection('http://127.0.0.1:8899', 'confirmed'),
    new Wallet(Keypair.generate()),
    AnchorProvider.defaultOptions(),
  );

  const contributionProgramId = Keypair.generate().publicKey;
  const pda = new PdaUtils({
    identity: Keypair.generate().publicKey,
    content: Keypair.generate().publicKey,
    access: Keypair.generate().publicKey,
    event: Keypair.generate().publicKey,
    factory: Keypair.generate().publicKey,
    circles: Keypair.generate().publicKey,
  });

  it('retains the configured program id as the PDA truth for the compatibility surface', () => {
    const module = new ContributionEngineModule(provider, contributionProgramId, pda);

    assert.equal(module.programId.toBase58(), contributionProgramId.toBase58());
    assert.equal(module.program.programId.toBase58(), contributionProgramId.toBase58());

    const sourceId = Keypair.generate().publicKey;
    const targetId = Keypair.generate().publicKey;
    const expectedReference = PublicKey.findProgramAddressSync(
      [Buffer.from('ref'), sourceId.toBuffer(), targetId.toBuffer()],
      contributionProgramId,
    )[0];

    assert.equal(module.findReferencePda(sourceId, targetId).toBase58(), expectedReference.toBase58());
  });

  it('keeps addReference available on the current compatibility module surface', () => {
    const module = new ContributionEngineModule(provider, contributionProgramId, pda);

    assert.equal(typeof module.addReference, 'function');
    assert.equal(typeof module.createLedger, 'function');
    assert.equal(typeof module.recordContribution, 'function');
    assert.equal(typeof module.closeLedger, 'function');
  });
});
