// NibCollectionV2 holder airdrop, v1-minter bonus and owner mints, via the Binance agentic wallet (baw). Never broadcasts without --approve.
// Usage (run from the repo root):
//   npx tsx scripts/nib-collection-v2-airdrop.ts snapshot [--out file] [--from-block N] [--refunds-csv file]
//        read-only RPC. Reads the owner of every v1 id 1..minted() and every v1 minter's paid mints from on-chain data (Minted logs + mintedBy), flags wallets without
//        an Agent ID, cross-checks against the refunds CSV if given, and writes the snapshot JSON. Nothing is hardcoded.
//   npx tsx scripts/nib-collection-v2-airdrop.ts plan [--snapshot file]
//        offline: the exact batches (airdrop(to[],ids[]), airdropBonus(to[]), finalizeAirdrop) with calldata hashes. No RPC, no wallet.
//   npx tsx scripts/nib-collection-v2-airdrop.ts dryrun <batch> [--snapshot file]      estimateGas for one batch, re-checks v1 owners. No wallet.
//   npx tsx scripts/nib-collection-v2-airdrop.ts preview <batch> [--snapshot file]     Binance contract-call preview of that one batch (does not broadcast).
//   npx tsx scripts/nib-collection-v2-airdrop.ts execute <batch> --approve             broadcasts the previewed batch after explicit user approval.
//   npx tsx scripts/nib-collection-v2-airdrop.ts ownermint <addr:count,addr:count> [dryrun|preview|execute --approve]   owner-only free mints (usable after finalize too).
// <batch> is airdrop-1.., bonus-1.. or finalize. Order: every airdrop-N, every bonus-N, then finalize, then setMintOpen(true) (not scripted).
// A v1 id that changed owner after the snapshot makes the on-chain call revert ("stale"); dryrun/preview/execute re-read the v1 owners and refuse to continue, re-run snapshot.
import fs from 'node:fs';import path from 'node:path';import os from 'node:os';import {pathToFileURL} from 'node:url';
import {createPublicClient,http,encodeFunctionData,keccak256,parseAbi,parseAbiItem,formatEther} from 'viem';import {bsc} from 'viem/chains';
import {TREASURY,baw,wallet} from './nib-deploy';
import {AGENT_ID_REGISTRY} from '../lib/protocol';
import {NFT_COLLECTION_V1} from '../lib/nft-protocol';
import {collectionV2Plans} from './nib-collection-v2-deploy';
export const BONUS_PER_USD=20n;               // $1 paid on v1 / $0.05 V2 mint price
export const AIRDROP_BATCH=50,BONUS_BATCH=50,OWNER_MINT_BATCH=50;  // ~163k gas per NFT: 50 per transaction is ~8M gas; the contract allows up to 100
export const V1_FROM_BLOCK=130650000n;        // v1 marketplace deploy block; the collection was deployed with it
const ABI=parseAbi(['function airdrop(address[] to,uint256[] ids)','function airdropBonus(address[] to)','function ownerMint(address[] to,uint256[] counts)','function finalizeAirdrop()','function airdropFinalized() view returns(bool)','function airdropped(uint256) view returns(bool)','function airdropCount() view returns(uint256)','function bonusCount() view returns(uint256)','function owner() view returns(address)']);
const V1=parseAbi(['function minted() view returns(uint256)','function ownerOf(uint256) view returns(address)','function mintedBy(address) view returns(uint256)']);
const REG=parseAbi(['function balanceOf(address) view returns(uint256)']);
const MINTED=parseAbiItem('event Minted(address indexed wallet,uint256 indexed firstTokenId,uint256 quantity,uint256 payment)');
const chunks=<T,>(a:T[],n:number)=>{const o:T[][]=[];for(let i=0;i<a.length;i+=n)o.push(a.slice(i,i+n));return o;};
export type Snapshot={chainId:56;block:string;takenAt:string;v1:string;v2:string;registry:string;v1Minted:number;holders:{id:number;owner:string;hasAgentId:boolean}[];bonus:{wallet:string;paidMints:number;usd:string;bonusNfts:number;hasAgentId:boolean}[];totals:{airdropIds:number;bonusNfts:number;recipients:number;withoutAgentId:string[]};crossCheck:any};
/** Paid v1 mints for a wallet: the first mint of each wallet was free, everything after it was $1. */
export const paidMintsOf=(mintedBy:bigint)=>mintedBy>0n?mintedBy-1n:0n;
export const bonusOf=(paidMints:bigint)=>paidMints*BONUS_PER_USD;
export type Batch={name:string;kind:'airdrop'|'bonus'|'finalize'|'ownermint';count:number;to?:string[];ids?:number[];data:`0x${string}`};
export function buildBatches(s:Pick<Snapshot,'holders'|'bonus'>,sizes={airdrop:AIRDROP_BATCH,bonus:BONUS_BATCH}):Batch[]{
 const out:Batch[]=[];
 chunks(s.holders.slice().sort((a,b)=>a.id-b.id),sizes.airdrop).forEach((c,i)=>{const to=c.map(h=>h.owner),ids=c.map(h=>h.id);out.push({name:'airdrop-'+(i+1),kind:'airdrop',count:c.length,to,ids,data:encodeFunctionData({abi:ABI,functionName:'airdrop',args:[to as any,ids.map(BigInt)]})});});
 const bonusList:string[]=[];for(const b of s.bonus)for(let i=0;i<b.bonusNfts;i++)bonusList.push(b.wallet);
 chunks(bonusList,sizes.bonus).forEach((c,i)=>out.push({name:'bonus-'+(i+1),kind:'bonus',count:c.length,to:c,data:encodeFunctionData({abi:ABI,functionName:'airdropBonus',args:[c as any]})}));
 out.push({name:'finalize',kind:'finalize',count:0,data:encodeFunctionData({abi:ABI,functionName:'finalizeAirdrop'})});
 return out;
}
export function ownerMintBatches(spec:string):Batch[]{
 const pairs=spec.split(',').map(x=>x.trim()).filter(Boolean).map(x=>{const [a,n]=x.split(':');if(!/^0x[0-9a-fA-F]{40}$/.test(a||'')||!/^[1-9]\d*$/.test(n||''))throw Error('Bad ownermint entry '+x+', use 0xaddress:count');return {a,n:Number(n)};});
 const out:Batch[]=[];let cur:typeof pairs=[],total=0;const flush=()=>{if(!cur.length)return;const to=cur.map(p=>p.a),counts=cur.map(p=>BigInt(p.n));out.push({name:'ownermint-'+(out.length+1),kind:'ownermint',count:total,to,data:encodeFunctionData({abi:ABI,functionName:'ownerMint',args:[to as any,counts]})});cur=[];total=0;};
 for(const p of pairs){let left=p.n;while(left>0){const take=Math.min(left,OWNER_MINT_BATCH-total);cur.push({a:p.a,n:take});total+=take;left-=take;if(total>=OWNER_MINT_BATCH)flush();}}
 flush();return out;
}
const arg=(n:string)=>{const i=process.argv.indexOf(n);return i>0?process.argv[i+1]:undefined;};
const client=()=>createPublicClient({chain:bsc,transport:http(process.env.BSC_RPC_URL||'https://bsc-dataseed.bnbchain.org',{timeout:30000}),batch:{multicall:true}});
const loadSnapshot=()=>JSON.parse(fs.readFileSync(arg('--snapshot')||'artifacts/nib-collection-v2-snapshot.json','utf8')) as Snapshot;
async function snapshot(){
 const c=client();if(await c.getChainId()!==56)throw Error('RPC is on the wrong chain.');
 const block=await c.getBlockNumber(),v2=collectionV2Plans().steps[0].address;
 const minted=Number(await c.readContract({address:NFT_COLLECTION_V1,abi:V1,functionName:'minted',blockNumber:block}));
 if(!minted)throw Error('The old collection has no mints.');
 const ids=Array.from({length:minted},(_,i)=>i+1);
 const owners=await Promise.all(ids.map(id=>c.readContract({address:NFT_COLLECTION_V1,abi:V1,functionName:'ownerOf',args:[BigInt(id)],blockNumber:block})));
 const holderSet=[...new Set(owners.map(o=>o.toLowerCase()))];
 // Every wallet that ever minted: from the Minted logs (chunked, public RPCs cap the range).
 const from=BigInt(arg('--from-block')||V1_FROM_BLOCK),step=BigInt(process.env.NFT_LOGS_CHUNK||'5000'),minters=new Map<string,{usdtPaid:bigint;mints:bigint;txs:number}>();
 const logsRpc=createPublicClient({chain:bsc,transport:http(process.env.NFT_LOGS_RPC_URL||process.env.BSC_RPC_URL||'https://bsc-rpc.publicnode.com',{timeout:30000})});
 for(let a=from;a<=block;a+=step){const b=a+step-1n>block?block:a+step-1n;
  const logs=await logsRpc.getLogs({address:NFT_COLLECTION_V1,event:MINTED,fromBlock:a,toBlock:b});
  for(const l of logs){const w=String(l.args.wallet).toLowerCase(),m=minters.get(w)||{usdtPaid:0n,mints:0n,txs:0};m.usdtPaid+=l.args.payment!;m.mints+=l.args.quantity!;m.txs++;minters.set(w,m);}}
 const wallets=[...new Set([...holderSet,...minters.keys()])];
 const agent=new Map<string,boolean>();
 const bal=await Promise.all(wallets.map(w=>c.readContract({address:AGENT_ID_REGISTRY,abi:REG,functionName:'balanceOf',args:[w as `0x${string}`],blockNumber:block})));wallets.forEach((w,i)=>agent.set(w,bal[i]>0n));
 const mb=await Promise.all([...minters.keys()].map(w=>c.readContract({address:NFT_COLLECTION_V1,abi:V1,functionName:'mintedBy',args:[w as `0x${string}`],blockNumber:block})));
 const mintedByTotal=mb.reduce((s,x)=>s+x,0n);
 if(Number(mintedByTotal)!==minted)console.error('WARNING: the sum of mintedBy over discovered minters is '+mintedByTotal+' but minted() is '+minted+'. The log scan missed blocks: use --from-block earlier.');
 const checksum=(a:string)=>{const x=owners.find(o=>o.toLowerCase()===a);return x||a;};
 const holders=ids.map((id,i)=>({id,owner:owners[i],hasAgentId:!!agent.get(owners[i].toLowerCase())}));
 const bonus=[...minters.keys()].map((w,i)=>{const paid=paidMintsOf(mb[i]);return {wallet:w,paidMints:Number(paid),usd:paid.toString()+'.00',bonusNfts:Number(bonusOf(paid)),hasAgentId:!!agent.get(w)};}).filter(b=>b.paidMints>0).sort((a,b)=>b.paidMints-a.paidMints);
 // Checksum-case the bonus wallets for readable calldata
 const {getAddress}=await import('viem');for(const b of bonus)b.wallet=getAddress(b.wallet);
 const crossCheck:any={mintedBySum:mintedByTotal.toString(),v1Minted:minted,usdtPaidByWallet:Object.fromEntries([...minters].filter(([,m])=>m.usdtPaid>0n).map(([w,m])=>[w,formatEther(m.usdtPaid)+' USDT']))};
 const csv=arg('--refunds-csv');if(csv){const rows=fs.readFileSync(csv,'utf8').trim().split('\n').slice(1).map(l=>l.split(',')).filter(r=>/^0x[0-9a-fA-F]{40}$/.test(r[0]));const diffs:string[]=[];
  for(const r of rows){const b=bonus.find(x=>x.wallet.toLowerCase()===r[0].toLowerCase());if(!b||b.paidMints!==Number(r[1]))diffs.push(r[0]+' csv paid_mints='+r[1]+' on-chain='+(b?.paidMints??0));}
  for(const b of bonus)if(!rows.some(r=>r[0].toLowerCase()===b.wallet.toLowerCase()))diffs.push(b.wallet+' on-chain paid_mints='+b.paidMints+' not in csv');
  crossCheck.refundsCsv={rows:rows.length,matches:!diffs.length,diffs};}
 const withoutAgentId=[...new Set([...holders.filter(h=>!h.hasAgentId).map(h=>h.owner),...bonus.filter(b=>!b.hasAgentId).map(b=>b.wallet)])];
 const snap:Snapshot={chainId:56,block:block.toString(),takenAt:new Date().toISOString(),v1:NFT_COLLECTION_V1,v2,registry:AGENT_ID_REGISTRY,v1Minted:minted,holders,bonus,totals:{airdropIds:holders.length,bonusNfts:bonus.reduce((s,b)=>s+b.bonusNfts,0),recipients:new Set([...holders.map(h=>h.owner.toLowerCase()),...bonus.map(b=>b.wallet.toLowerCase())]).size,withoutAgentId},crossCheck};
 const out=arg('--out')||'artifacts/nib-collection-v2-snapshot.json';fs.writeFileSync(out,JSON.stringify(snap,null,1));
 console.log(JSON.stringify({wrote:out,block:snap.block,v1Minted:minted,distinctHolders:holderSet.length,bonusWallets:bonus.length,bonusNfts:snap.totals.bonusNfts,withoutAgentId:withoutAgentId.length,crossCheck,next:'Review the snapshot, then: plan'},null,2));
}
function describe(b:Batch){return {batch:b.name,kind:b.kind,nfts:b.count,function:b.kind==='airdrop'?'airdrop(address[],uint256[])':b.kind==='bonus'?'airdropBonus(address[])':b.kind==='ownermint'?'ownerMint(address[],uint256[])':'finalizeAirdrop()',firstId:b.ids?.[0],lastId:b.ids?.[b.ids.length-1],calldataKeccak:keccak256(b.data),calldataBytes:(b.data.length-2)/2};}
async function run(){
 const mode=process.argv[2]||'plan',dir=path.join(os.homedir(),'.local','state','taptap');
 if(mode==='snapshot')return snapshot();
 const v2=collectionV2Plans().steps[0].address;
 if(mode==='ownermint'){return ownerMint(v2,dir);}
 const snap=loadSnapshot();if(snap.v2.toLowerCase()!==v2.toLowerCase())throw Error('Snapshot targets '+snap.v2+' but the planned collection is '+v2+'.');
 const size=Math.min(100,Math.max(1,Number(process.env.AIRDROP_BATCH_SIZE||AIRDROP_BATCH))),batches=buildBatches(snap,{airdrop:size,bonus:size});
 if(mode==='plan'){console.log(JSON.stringify({collection:v2,snapshotBlock:snap.block,airdropIds:snap.totals.airdropIds,bonusNfts:snap.totals.bonusNfts,withoutAgentId:snap.totals.withoutAgentId,batches:batches.map(describe),order:'airdrop-1.. then bonus-1.. then finalize. Public mint opens only with setMintOpen(true) after finalize.',next:'No transactions sent.'},null,2));return;}
 const name=process.argv[3],b=batches.find(x=>x.name===name);if(!b)throw Error('Unknown batch '+name+'. Use '+batches.map(x=>x.name).join(', '));
 return send(mode,b,v2,dir,snap);
}
async function send(mode:string,b:Batch,v2:string,dir:string,snap?:Snapshot){
 const c=client(),stateFile=path.join(dir,'nib-collection-v2-'+b.name+'.json');
 if(await c.getChainId()!==56)throw Error('RPC is on the wrong chain.');
 const code=await c.getCode({address:v2 as `0x${string}`});if(!code||code==='0x')throw Error('NibCollectionV2 is not deployed at '+v2);
 const guard=async()=>{
  const [fin,owner]=await Promise.all([c.readContract({address:v2 as any,abi:ABI,functionName:'airdropFinalized'}),c.readContract({address:v2 as any,abi:ABI,functionName:'owner'})]);
  if(String(owner).toLowerCase()!==TREASURY.toLowerCase())throw Error('NibCollectionV2 owner is not the treasury.');
  if(b.kind==='airdrop'||b.kind==='bonus'||b.kind==='finalize'){if(fin)throw Error('The airdrop is already finalized.');}
  if(b.kind==='airdrop'){
   const cur=await Promise.all(b.ids!.map(id=>c.readContract({address:NFT_COLLECTION_V1,abi:V1,functionName:'ownerOf',args:[BigInt(id)]})));
   const done=await Promise.all(b.ids!.map(id=>c.readContract({address:v2 as any,abi:ABI,functionName:'airdropped',args:[BigInt(id)]})));
   const stale=b.ids!.filter((id,i)=>cur[i].toLowerCase()!==b.to![i].toLowerCase()),dup=b.ids!.filter((id,i)=>done[i]);
   if(dup.length)throw Error('Already airdropped ids in this batch: '+dup.join(',')+'. Re-run snapshot and plan.');
   if(stale.length)throw Error('The v1 owner changed since the snapshot for ids '+stale.join(',')+'. Re-run snapshot and plan, otherwise the transaction reverts.');
  }
 };
 const tx={from:TREASURY,to:v2 as `0x${string}`,data:b.data};
 const costs=async()=>{const [gas,price,bal]=await Promise.all([c.estimateGas({account:TREASURY,to:tx.to,data:tx.data,value:0n}),c.getGasPrice(),c.getBalance({address:TREASURY})]);return {estimatedGas:gas.toString(),gasPriceGwei:(Number(price)/1e9).toFixed(3),estimatedCostBnb:formatEther(gas*price),treasuryBalanceBnb:formatEther(bal)};};
 if(mode==='dryrun'){await guard();console.log(JSON.stringify({what:'DRY RUN '+b.name+' (nothing sent)',...describe(b),...await costs()},null,2));return;}
 if(mode==='execute'){
  if(!process.argv.includes('--approve'))throw Error('Review the exact preview and get explicit user approval, then pass --approve.');
  const saved=JSON.parse(fs.readFileSync(stateFile,'utf8'));
  if(saved.execution)throw Error('This batch was already attempted. Check the receipt and the collection state before doing anything else.');
  if(saved.preview.expiresAt<Date.now())throw Error('Preview expired. Run a fresh preview.');
  if(wallet().toLowerCase()!==TREASURY.toLowerCase())throw Error('Connected wallet differs from the treasury.');
  if(keccak256(b.data)!==saved.calldataKeccak)throw Error('Calldata changed since the preview. Run a fresh preview.');
  await guard();
  saved.execution={startedAt:Date.now()};fs.writeFileSync(stateFile,JSON.stringify(saved),{mode:0o600});
  const result=baw(['contract-call','execute','--requestId',saved.preview.requestId]);saved.execution.result=result;fs.writeFileSync(stateFile,JSON.stringify(saved),{mode:0o600});
  console.log(JSON.stringify({status:result.status,transactionHash:result.txHash||result.transactionHash,batch:b.name,next:'Confirm the receipt, then continue with the next batch.'},null,2));return;
 }
 if(mode!=='preview')throw Error('Unknown mode '+mode);
 if(wallet().toLowerCase()!==TREASURY.toLowerCase())throw Error('Connected wallet is not the treasury.');
 await guard();const cost=await costs();
 const p=baw(['contract-call','preview','--binanceChainId','56','--from',TREASURY,'--to',tx.to,'--value','0','--inputData',tx.data]);if(!p.requestId)throw Error('Binance did not return a usable preview.');
 const n=Number(p.expiresAt);p.expiresAt=Number.isFinite(n)?(n<1e12?n*1000:n):Date.now()+180000;
 const summary={what:'NibCollectionV2 '+b.name,to:tx.to,value:'0 BNB',...describe(b),recipients:b.to?[...new Set(b.to)].length:0,...cost};
 fs.mkdirSync(dir,{recursive:true,mode:0o700});fs.writeFileSync(stateFile,JSON.stringify({tx,calldataKeccak:keccak256(b.data),summary,preview:p}),{mode:0o600});
 console.log(JSON.stringify({summary,preview:{requestId:p.requestId,expiresAt:new Date(p.expiresAt).toISOString(),risks:p.risks,authorityChanges:p.authorityChanges,requireConfirmation:p.requireConfirmation},next:'Show the user this preview. Execute only after explicit approval: npx tsx scripts/nib-collection-v2-airdrop.ts execute '+b.name+' --approve'},null,2));
}
async function ownerMint(v2:string,dir:string){
 const spec=process.argv[3]||'',sub=process.argv[4]||'plan',batches=ownerMintBatches(spec);
 if(sub==='plan'){console.log(JSON.stringify({collection:v2,batches:batches.map(describe),next:'No transactions sent. Add dryrun, preview or execute --approve.'},null,2));return;}
 const idx=Number(arg('--batch')||'1')-1,b=batches[idx];if(!b)throw Error('No such ownermint batch.');
 return send(sub,{...b,name:b.name+'-'+keccak256(b.data).slice(2,10)},v2,dir);
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)run().catch(e=>{console.error(e instanceof Error?e.message:e);process.exit(1);});
