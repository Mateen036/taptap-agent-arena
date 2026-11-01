import {createPublicClient,http,parseAbi,encodeFunctionData,formatEther} from 'viem';
import {bsc} from 'viem/chains';
import {bscTransport} from '../lib/rpc';
import {execSync} from 'node:child_process';

const TREASURY = '0x0D96e8Aa89c196D3b1b0100cDAe3b931e8a0eC0d';
const V1_VAULT = '0x45dB592E5F5D2a591b8FE9bdCfb75e6b1fC84D8B';
const TEST_TOKEN = '0x31FBD05B618130fDd651cEE3d090A0e79Cb46Bc6';
const WBNB = '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c';
const USDT = '0x55d398326f99059fF775485246999027B3197955';
const PANCAKE_ROUTER = '0x10ED43C718714eb63d5aA57B78B54704E256024E';

const vaultAbi = parseAbi([
  'function tokenReadyAt() view returns (uint256)',
  'function pendingToken() view returns (address)',
  'function liquidityToken() view returns (address)',
  'function activateToken() external',
  'function addLiquidityBNB(uint256,uint256,uint256,uint256,uint256) external returns (uint256,uint256,uint256)',
  'function addLiquidity(uint256,uint256,uint256,uint256,uint256) external returns (uint256,uint256,uint256)'
]);

const erc20Abi = parseAbi([
  'function balanceOf(address) view returns (uint256)',
  'function transfer(address,uint256) external returns (bool)',
  'function approve(address,uint256) external returns (bool)'
]);

const client = createPublicClient({chain: bsc, transport: bscTransport()});

async function bawCall(to: string, inputData: string, value = '0') {
  const pCmd = `baw contract-call preview --binanceChainId 56 --from ${TREASURY} --to ${to} --inputData ${inputData} --value ${value} --json`;
  const pRes = JSON.parse(execSync(pCmd, {encoding: 'utf8'}));
  if (!pRes.success || !pRes.data?.requestId) {
    throw new Error(`Preview failed: ${JSON.stringify(pRes)}`);
  }
  const eCmd = `baw contract-call execute --requestId ${pRes.data.requestId} --json`;
  const eRes = JSON.parse(execSync(eCmd, {encoding: 'utf8'}));
  if (!eRes.success) {
    throw new Error(`Execute failed: ${JSON.stringify(eRes)}`);
  }
  
  let txHash = eRes.data?.txHash || eRes.data?.transactionHash;
  for (let i = 0; i < 15 && !txHash; i++) {
    await new Promise(r => setTimeout(r, 2000));
    try {
      const hCmd = `baw wallet tx-history --binanceChainId 56 --size 1 --json`;
      const hRes = JSON.parse(execSync(hCmd, {encoding: 'utf8'}));
      const latest = hRes.data?.transactions?.[0];
      if (latest?.txHash) {
        txHash = latest.txHash;
      }
    } catch {}
  }

  console.log(`[Tx Broadcast] Hash: ${txHash}. Waiting for on-chain receipt...`);
  if (txHash) {
    const receipt = await client.waitForTransactionReceipt({hash: txHash as `0x${string}`});
    console.log(`[Tx Confirmed] In block ${receipt.blockNumber} (Status: ${receipt.status})`);
  } else {
    await new Promise(r => setTimeout(r, 8000));
  }
  return txHash;
}

export async function checkStatus() {
  const readyAt = Number(await client.readContract({address: V1_VAULT, abi: vaultAbi, functionName: 'tokenReadyAt'}));
  const now = Math.floor(Date.now() / 1000);
  const wbnbBal = await client.readContract({address: WBNB, abi: erc20Abi, functionName: 'balanceOf', args: [V1_VAULT]});
  const usdtBal = await client.readContract({address: USDT, abi: erc20Abi, functionName: 'balanceOf', args: [V1_VAULT]});
  const testBalV1 = await client.readContract({address: TEST_TOKEN, abi: erc20Abi, functionName: 'balanceOf', args: [V1_VAULT]});
  const testBalTreasury = await client.readContract({address: TEST_TOKEN, abi: erc20Abi, functionName: 'balanceOf', args: [TREASURY]});
  const lToken = await client.readContract({address: V1_VAULT, abi: vaultAbi, functionName: 'liquidityToken'});

  console.log('--- V1 Vault Recovery Status ---');
  console.log('Token Timelock Ready At:', new Date(readyAt * 1000).toUTCString());
  console.log('Current UTC Time:       ', new Date(now * 1000).toUTCString());
  console.log('Matured yet?            ', now >= readyAt ? 'YES, READY TO EXECUTE' : `NO, wait ${Math.ceil((readyAt - now) / 60)} more minutes`);
  console.log('V1 WBNB Balance:        ', formatEther(wbnbBal), 'WBNB');
  console.log('V1 USDT Balance:        ', (Number(usdtBal) / 1e18).toString(), 'USDT');
  console.log('V1 TEST Balance:        ', formatEther(testBalV1), 'TEST');
  console.log('Treasury TEST Balance:  ', formatEther(testBalTreasury), 'TEST');
  console.log('Liquidity Token:        ', lToken);
}

const routerAbi = parseAbi([
  'function swapExactTokensForETHSupportingFeeOnTransferTokens(uint256,uint256,address[],address,uint256) external',
  'function swapExactTokensForTokensSupportingFeeOnTransferTokens(uint256,uint256,address[],address,uint256) external'
]);

export async function executeRecovery() {
  const readyAt = Number(await client.readContract({address: V1_VAULT, abi: vaultAbi, functionName: 'tokenReadyAt'}));
  const now = Math.floor(Date.now() / 1000);
  if (now < readyAt) {
    console.log(`[Error] Timelock has not matured yet! Wait until ${new Date(readyAt * 1000).toUTCString()} (${Math.ceil((readyAt - now) / 60)} minutes left).`);
    return;
  }

  const wbnbBal = await client.readContract({address: WBNB, abi: erc20Abi, functionName: 'balanceOf', args: [V1_VAULT]});
  const usdtBal = await client.readContract({address: USDT, abi: erc20Abi, functionName: 'balanceOf', args: [V1_VAULT]});
  console.log(`[1/6] V1 Vault Balances: ${formatEther(wbnbBal)} WBNB, ${Number(usdtBal) / 1e18} USDT`);

  // 1. Send TEST to V1 Vault so it has tokens to pair
  const testNeeded = 2_000_000n * 10n ** 18n;
  const currentTest = await client.readContract({address: TEST_TOKEN, abi: erc20Abi, functionName: 'balanceOf', args: [V1_VAULT]});
  if (currentTest < testNeeded) {
    console.log('[Step 1] Sending 2,000,000 TEST from Treasury to V1 Vault...');
    const transferData = encodeFunctionData({
      abi: erc20Abi,
      functionName: 'transfer',
      args: [V1_VAULT, testNeeded - currentTest]
    });
    await bawCall(TEST_TOKEN, transferData);
  }

  // 2. Activate token
  const lToken = await client.readContract({address: V1_VAULT, abi: vaultAbi, functionName: 'liquidityToken'});
  if (lToken.toLowerCase() !== TEST_TOKEN.toLowerCase()) {
    console.log('[Step 2] Activating TEST token on V1 Vault...');
    const activateData = encodeFunctionData({abi: vaultAbi, functionName: 'activateToken'});
    await bawCall(V1_VAULT, activateData);
  }

  // 3. Add Liquidity BNB
  if (wbnbBal > 0n) {
    console.log('[Step 3] Adding TEST/BNB Liquidity from V1 Vault...');
    const deadline = BigInt(Math.floor(Date.now() / 1000) + 1200);
    const addBnbData = encodeFunctionData({
      abi: vaultAbi,
      functionName: 'addLiquidityBNB',
      args: [1_000_000n * 10n ** 18n, wbnbBal, 1n, 1n, deadline]
    });
    await bawCall(V1_VAULT, addBnbData);
  }

  // 4. Add Liquidity USDT
  if (usdtBal > 0n) {
    console.log('[Step 4] Adding TEST/USDT Liquidity from V1 Vault...');
    const deadline = BigInt(Math.floor(Date.now() / 1000) + 1200);
    const addUsdtData = encodeFunctionData({
      abi: vaultAbi,
      functionName: 'addLiquidity',
      args: [1_000_000n * 10n ** 18n, usdtBal, 1n, 1n, deadline]
    });
    await bawCall(V1_VAULT, addUsdtData);
  }

  // 5. Approve PancakeSwap Router to spend TEST from Treasury
  console.log('[Step 5] Approving PancakeSwap Router to spend TEST from Treasury...');
  const approveData = encodeFunctionData({
    abi: erc20Abi,
    functionName: 'approve',
    args: [PANCAKE_ROUTER, 100_000_000_000n * 10n ** 18n]
  });
  await bawCall(TEST_TOKEN, approveData);

  // 6. Swap TEST for BNB & USDT to extract the liquidity to Treasury
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 1200);
  const swapDumpAmount = 100_000_000n * 10n ** 18n; // 100M TEST into 1M TEST pool pulls ~99% of pool reserves

  console.log('[Step 6a] Swapping TEST -> BNB to recover BNB to Treasury...');
  const swapBnbData = encodeFunctionData({
    abi: routerAbi,
    functionName: 'swapExactTokensForETHSupportingFeeOnTransferTokens',
    args: [swapDumpAmount, 0n, [TEST_TOKEN, WBNB], TREASURY, deadline]
  });
  await bawCall(PANCAKE_ROUTER, swapBnbData);

  console.log('[Step 6b] Swapping TEST -> USDT to recover USDT to Treasury...');
  const swapUsdtData = encodeFunctionData({
    abi: routerAbi,
    functionName: 'swapExactTokensForTokensSupportingFeeOnTransferTokens',
    args: [swapDumpAmount, 0n, [TEST_TOKEN, USDT], TREASURY, deadline]
  });
  await bawCall(PANCAKE_ROUTER, swapUsdtData);

  console.log('[Success] Recovery sequence finished! Checking Treasury balances...');
  const finalBnb = await client.getBalance({address: TREASURY});
  const finalUsdt = await client.readContract({address: USDT, abi: erc20Abi, functionName: 'balanceOf', args: [TREASURY]});
  console.log('Final Treasury BNB:', formatEther(finalBnb));
  console.log('Final Treasury USDT:', (Number(finalUsdt) / 1e18).toString());
}

if (process.argv[1]?.includes('recover-v1-funds')) {
  if (process.argv.includes('--execute')) {
    executeRecovery();
  } else {
    checkStatus();
  }
}
