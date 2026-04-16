import { createPublicClient, http, formatUnits } from 'viem';
import { writeFileSync } from 'fs';
import { resolve } from 'path';

const XANON_ADDRESS = '0x780ae218a02a20b69ac3da7bf80c08a70a330a5e' as const;
const RPC_URL = process.env.SONIC_RPC_URL || 'https://rpc.soniclabs.com';
const DECIMALS = 18;
const OUT_PATH = resolve(__dirname, '..', 'api', 'scores.json');

const abi = [
  {
    type: 'function',
    name: 'totalSupply',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'tokenByIndex',
    stateMutability: 'view',
    inputs: [{ name: 'index', type: 'uint256' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'ownerOf',
    stateMutability: 'view',
    inputs: [{ name: 'tokenId', type: 'uint256' }],
    outputs: [{ name: '', type: 'address' }],
  },
  {
    type: 'function',
    name: 'positionOf',
    stateMutability: 'view',
    inputs: [{ name: 'tokenId', type: 'uint256' }],
    outputs: [
      {
        name: 'position',
        type: 'tuple',
        components: [
          { name: 'amount', type: 'uint96' },
          { name: 'poolId', type: 'uint8' },
          { name: 'lockedUntil', type: 'uint64' },
          { name: 'lastPaidDay', type: 'uint64' },
        ],
      },
      { name: 'pendingRewards', type: 'uint256' },
    ],
  },
] as const;

const client = createPublicClient({
  transport: http(RPC_URL),
});

const BATCH_SIZE = 10;
const DELAY_MS = 500;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function withRetry<T>(fn: () => Promise<T>, retries = 3): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (err: any) {
      if (attempt >= retries) throw err;
      const wait = 2000 * 2 ** attempt;
      console.log(`    retry ${attempt + 1}/${retries} after ${wait}ms...`);
      await sleep(wait);
    }
  }
}

async function main() {
  console.log('Fetching totalSupply...');
  const totalSupply = await client.readContract({
    address: XANON_ADDRESS,
    abi,
    functionName: 'totalSupply',
  });
  console.log(`Total NFTs: ${totalSupply}`);

  const totals: Record<string, bigint> = {};
  const count = Number(totalSupply);

  for (let start = 0; start < count; start += BATCH_SIZE) {
    const end = Math.min(start + BATCH_SIZE, count);
    const indices = Array.from({ length: end - start }, (_, i) => BigInt(start + i));

    const tokenIds = await Promise.all(
      indices.map((idx) =>
        withRetry(() =>
          client.readContract({
            address: XANON_ADDRESS,
            abi,
            functionName: 'tokenByIndex',
            args: [idx],
          })
        )
      )
    );

    for (const tokenId of tokenIds) {
      const [owner, [position]] = await withRetry(() =>
        Promise.all([
          client.readContract({
            address: XANON_ADDRESS,
            abi,
            functionName: 'ownerOf',
            args: [tokenId],
          }),
          client.readContract({
            address: XANON_ADDRESS,
            abi,
            functionName: 'positionOf',
            args: [tokenId],
          }),
        ])
      );
      const addr = owner.toLowerCase();
      totals[addr] = (totals[addr] || 0n) + BigInt(position.amount);
    }

    console.log(`  processed ${end} / ${count} NFTs`);
    if (end < count) await sleep(DELAY_MS);
  }

  const scoreArray: { address: string; score: number }[] = [];
  for (const [addr, raw] of Object.entries(totals)) {
    const vp = Math.floor(Number(formatUnits(raw, DECIMALS)));
    if (vp > 0) scoreArray.push({ address: addr, score: vp });
  }

  const output = { score: scoreArray };

  writeFileSync(OUT_PATH, JSON.stringify(output, null, 2));
  console.log(`\nDone! ${scoreArray.length} holders written to ${OUT_PATH}`);
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
