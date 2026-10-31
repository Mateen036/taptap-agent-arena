import {createPublicClient,http,parseAbi} from 'viem';
import {bsc} from 'viem/chains';
import {execSync} from 'node:child_process';

const RPC = 'https://bsc-dataseed.bnbchain.org';
const AIRDROP = '0x3F5C83b4a24f0D12A278E995F21c0DEb9a8524d5';
const TREASURY = '0x0D96e8Aa89c196D3b1b0100cDAe3b931e8a0eC0d';
const SELECTOR_OPEN_NEXT_SEASON = '0xe7bfd23a';

const abi = parseAbi([
  'function currentSeason() view returns (uint256)',
  'function seasons(uint256) view returns (uint256, uint256, uint256, uint256, uint256, uint8)',
  'function remaining(uint256) view returns (uint256)',
  'function owner() view returns (address)'
]);

const client = createPublicClient({chain: bsc, transport: http(RPC)});

export async function checkAndAdvanceSeason(): Promise<{advanced: boolean; message: string}> {
  try {
    const current = Number(await client.readContract({address: AIRDROP, abi, functionName: 'currentSeason'}));
    const s = await client.readContract({address: AIRDROP, abi, functionName: 'seasons', args: [BigInt(current)]});
    const rem = await client.readContract({address: AIRDROP, abi, functionName: 'remaining', args: [BigInt(current)]});
    const status = Number(s[5]); // 0=Unopened, 1=Open, 2=Ended

    console.log(`[SeasonKeeper] Season ${current}: status=${status} (1=Open, 2=Ended), remaining=${rem / 10n**18n} NIB`);

    if (current >= 4) {
      return {advanced: false, message: `Season ${current} reached. Final season target met.`};
    }

    if (status === 2 || rem === 0n) {
      console.log(`[SeasonKeeper] Season ${current} ended or exhausted. Triggering openNextSeason() for Season ${current + 1}...`);
      
      const previewCmd = `baw contract-call preview --binanceChainId 56 --from ${TREASURY} --to ${AIRDROP} --inputData ${SELECTOR_OPEN_NEXT_SEASON} --json`;
      const previewOut = JSON.parse(execSync(previewCmd, {encoding: 'utf8'}));
      
      if (!previewOut.success || !previewOut.data?.requestId) {
        throw new Error(`Preview failed: ${JSON.stringify(previewOut)}`);
      }

      const reqId = previewOut.data.requestId;
      console.log(`[SeasonKeeper] Preview succeeded (requestId: ${reqId}). Executing broadcast...`);

      const execCmd = `baw contract-call execute --requestId ${reqId} --json`;
      const execOut = JSON.parse(execSync(execCmd, {encoding: 'utf8'}));

      if (!execOut.success) {
        throw new Error(`Execution failed: ${JSON.stringify(execOut)}`);
      }

      console.log(`[SeasonKeeper] Broadcast succeeded! TxHash: ${execOut.data?.txHash}`);
      return {advanced: true, message: `Opened Season ${current + 1} on tx ${execOut.data?.txHash}`};
    }

    return {advanced: false, message: `Season ${current} is currently active (${rem / 10n**18n} NIB remaining).`};
  } catch (err: any) {
    console.error(`[SeasonKeeper Error]`, err?.message || err);
    return {advanced: false, message: `Error: ${err?.message}`};
  }
}

async function loop() {
  console.log('[SeasonKeeper] Starting autonomous season keeper daemon...');
  while (true) {
    await checkAndAdvanceSeason();
    await new Promise(r => setTimeout(r, 60_000)); // check every 60 seconds
  }
}

if (process.argv[1]?.includes('season-keeper')) {
  loop();
}
