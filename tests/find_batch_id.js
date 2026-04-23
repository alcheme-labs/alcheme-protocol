const { PublicKey } = require('@solana/web3.js');
const BN = require('bn.js');

const emitterId = new PublicKey('uhPvVgDANHaUzUq2rYEVXJ9vGEBjWjNZ1E6gQJqdBUC');
const target = '2XeeSwbxw8Z1dPQcnBtENdgRBSEuCaDYSi2VJVmRjymU';

console.log('Testing batch_id values to find which generates target PDA...\n');

for (let batch_id = 0; batch_id < 20; batch_id++) {
    const [pda] = PublicKey.findProgramAddressSync(
        [Buffer.from('event_batch'), new BN(batch_id).toArrayLike(Buffer, 'le', 8)],
        emitterId
    );

    if (pda.toBase58() === target) {
        console.log(`✅ MATCH FOUND! batch_id=${batch_id} generates ${target}\n`);

        // 反推 event_sequence
        // Formula: batch_id = event_sequence / batch_size + 1
        // Therefore: event_sequence = (batch_id - 1) * batch_size
        console.log('Possible combinations:');
        console.log('batch_id | batch_size | implied event_sequence');
        console.log('---------|------------|----------------------');
        for (let bs of [100, 500, 1000, 10000]) {
            const seq = (batch_id - 1) * bs;
            console.log(`   ${batch_id}     |    ${bs.toString().padEnd(6)} |        ${seq}`);
        }
        break;
    }
}
