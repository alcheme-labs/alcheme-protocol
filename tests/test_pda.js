const { PublicKey } = require('@solana/web3.js');
const BN = require('bn.js');

const emitterId = new PublicKey('uhPvVgDANHaUzUq2rYEVXJ9vGEBjWjNZ1E6gQJqdBUC');
const [emitterPDA, emitterBump] = PublicKey.findProgramAddressSync([Buffer.from('event_emitter')], emitterId);

console.log('emitterPDA:', emitterPDA.toBase58(), 'bump:', emitterBump);
console.log('Target: 2XeeSwbxw8Z1dPQcnBtENdgRBSEuCaDYSi2VJVmRjymU');
console.log('');

const tests = [
    { name: '[event_batch, seq=0]', seeds: [Buffer.from('event_batch'), new BN(0).toArrayLike(Buffer, 'le', 8)] },
    { name: '[emitter, event_batch, seq=0]', seeds: [emitterPDA.toBuffer(), Buffer.from('event_batch'), new BN(0).toArrayLike(Buffer, 'le', 8)] },
    { name: '[event_batch, emitter_bump, seq=0]', seeds: [Buffer.from('event_batch'), Buffer.from([emitterBump]), new BN(0).toArrayLike(Buffer, 'le', 8)] },
    { name: '[event_batch, seq=1]', seeds: [Buffer.from('event_batch'), new BN(1).toArrayLike(Buffer, 'le', 8)] },
    { name: '[batch]', seeds: [Buffer.from('batch')] },
    { name: '[event_batch]', seeds: [Buffer.from('event_batch')] },
];

for (const test of tests) {
    const [pda] = PublicKey.findProgramAddressSync(test.seeds, emitterId);
    const match = pda.toBase58() === '2XeeSwbxw8Z1dPQcnBtENdgRBSEuCaDYSi2VJVmRjymU' ? '✓ MATCH' : '';
    console.log(`${test.name}: ${pda.toBase58()} ${match}`);
}
