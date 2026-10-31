import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parseEther,zeroAddress,keccak256,toHex} from 'viem';
import {nftChain} from './helpers/nft-chain';
import {AGENT_ID_REGISTRY} from '../lib/protocol';
import {NFT_PAYMENT,NFT_ROUTER,NFT_PRICE_FEED} from '../lib/nft-protocol';

// NibCollectionV2: same art/price/rules as v1, mint payments to NibVaultV2, owner-only one-time airdrop of the same ids to current v1 holders.
test('NibCollectionV2: airdrop of v1 ids, independent public mint from the start id, payments to the vault',async t=>{
 const f=await nftChain(),E=parseEther;
 const v1=f.art('NibCollection'),v2=f.art('NibCollectionV2'),vaultArt=f.art('NibVaultV2'),mock=f.m;
 const a=f.accounts.map((x:any)=>x.address as `0x${string}`);
 try{
 // --- legacy: ids 1..7 minted free on the fixture's v1 (one per wallet); then 1 moves to wallet 2 so wallet 2 holds two ids.
 for(let i=1;i<=7;i++)await f.write(f.collection,v1.abi,'mintBNB',[1n,0n,await f.deadline(),f.intent()],i,0n);
 await f.write(f.collection,v1.abi,'transferFrom',[a[1],a[2],1n],1);
 assert.equal(await f.read(f.collection,v1.abi,'minted'),7n);
 const nibToken=await f.deploy(mock.MockToken);
 const vault=await f.deploy(vaultArt,[nibToken,NFT_PAYMENT,NFT_ROUTER,a[0]]);
 const args=[AGENT_ID_REGISTRY,NFT_PAYMENT,vault,f.renderer,a[0],NFT_PRICE_FEED,f.collection,8n];
 const rd=(c:any,n:string,x:any[]=[])=>f.read(c,v2.abi,n,x),wr=(c:any,n:string,x:any[],who=0,value=0n)=>f.write(c,v2.abi,n,x,who,value);

 await t.test('constructor guards',async()=>{
  const bad=(i:number,v:any)=>{const x=[...args];x[i]=v;return f.deploy(v2,x);};
  await assert.rejects(bad(2,f.collection),/revert/);                  // not a vault: no usdt()
  const otherVault=await f.deploy(vaultArt,[nibToken,f.lpPair,NFT_ROUTER,a[0]]);   // a vault whose USDT is a different token
  await assert.rejects(bad(2,otherVault),/Vault payment mismatch/);
  await assert.rejects(bad(6,zeroAddress),/Missing legacy collection/);
  await assert.rejects(bad(7,1n),/Invalid public start id/);
  await assert.rejects(bad(7,10001n),/Invalid public start id/);
  await assert.rejects(bad(5,f.vault),/revert/);                       // not a BNB/USD feed
 });
 const c=(await f.deploy(v2,args));
 const col=c;
 await t.test('immutables, economics and art mirror v1; mint starts closed',async()=>{
  assert.equal((await rd(col,'lpVault')).toLowerCase(),vault.toLowerCase());
  assert.equal((await rd(col,'paymentToken')).toLowerCase(),NFT_PAYMENT.toLowerCase());
  assert.equal((await rd(col,'legacy')).toLowerCase(),f.collection.toLowerCase());
  assert.equal(await rd(col,'publicStartId'),8n);assert.equal(await rd(col,'nextPublicId'),8n);
  assert.equal(await rd(col,'MAX_SUPPLY'),10000n);assert.equal(await rd(col,'WALLET_LIMIT'),10n);assert.equal(await rd(col,'mintPrice'),E('0.05'));assert.equal(await rd(col,'FREE_PER_WALLET'),3n);
  assert.equal(await rd(col,'mintOpen'),false);assert.equal(await rd(col,'airdropFinalized'),false);
  assert.equal(await rd(col,'minted'),0n);assert.equal(await rd(col,'publicRemaining'),10000n-7n);
  assert.equal((await rd(col,'renderer')).toLowerCase(),f.renderer.toLowerCase());
  assert.equal((await rd(col,'owner')).toLowerCase(),a[0].toLowerCase());
  const names=v2.abi.filter((x:any)=>x.type==='function').map((x:any)=>x.name);
  for(const n of ['airdrop','finalizeAirdrop','setMintOpen','mint','mintBNB','pause','unpause'])assert.ok(names.includes(n),n);
  assert.ok(!names.some((n:string)=>/setVault|setLegacy|setPrice|withdraw|rescue|setRenderer/i.test(n)),'no owner knobs on payment destination, price or art');
  assert.equal((v2.deployedBytecode.length-2)/2<=24576,true);
 });
 await t.test('public minting cannot open before the airdrop is finalized',async()=>{
  await assert.rejects(wr(col,'setMintOpen',[true]),/Finalize the airdrop first/);
  await assert.rejects(wr(col,'mintBNB',[1n,0n,await f.deadline(),f.intent()],5),/Mint closed/);
 });
 await t.test('airdrop is owner-only and validates ranges, lengths, holders and duplicates',async()=>{
  await assert.rejects(wr(col,'airdrop',[[a[2]],[2n]],3),/revert/);                   // not the owner
  await assert.rejects(wr(col,'airdrop',[[a[2]],[2n,3n]]),/Invalid batch/);
  await assert.rejects(wr(col,'airdrop',[[],[]]),/Invalid batch/);
  await assert.rejects(wr(col,'airdrop',[[a[2]],[0n]]),/Id outside airdrop range/);
  await assert.rejects(wr(col,'airdrop',[[a[2]],[8n]]),/Id outside airdrop range/);   // the first public id is not airdroppable
  await assert.rejects(wr(col,'airdrop',[[a[5]],[2n]]),/Not the current holder/);      // id 2 is held by wallet 2, not 5
  await assert.rejects(wr(col,'airdrop',[[a[1]],[1n]]),/Not the current holder/);      // wallet 1 sold id 1 to wallet 2
  await assert.rejects(wr(col,'airdrop',[[zeroAddress],[2n]]),/Not the current holder/);
  await assert.rejects(wr(col,'airdrop',[Array(101).fill(a[2]),Array.from({length:101},(_,i)=>BigInt(i+1))]),/Invalid batch/);
  assert.equal(await rd(col,'airdropCount'),0n);
 });
 await t.test('airdrop mints the exact same ids to the current holders, in batches, once per id',async()=>{
  // wallet 3 has no Agent ID right now: the airdrop must still deliver (it only mints an id they already own in v1).
  await f.write(AGENT_ID_REGISTRY,f.m.MockIdentity.abi,'set',[a[3],0n],0);
  const r=await f.client.getTransactionReceipt({hash:await wr(col,'airdrop',[[a[2],a[2],a[3]],[1n,2n,3n]])});
  console.log('airdrop gas for 3 ids:',r.gasUsed);
  assert.ok(r.gasUsed<1_000_000n);
  assert.equal((await rd(col,'ownerOf',[1n])).toLowerCase(),a[2].toLowerCase());assert.equal((await rd(col,'ownerOf',[3n])).toLowerCase(),a[3].toLowerCase());
  assert.equal(await rd(col,'airdropCount'),3n);assert.equal(await rd(col,'minted'),3n);assert.equal(await rd(col,'totalSupply'),3n);
  assert.equal(await rd(col,'airdropped',[1n]),true);assert.equal(await rd(col,'airdropped',[4n]),false);
  await assert.rejects(wr(col,'airdrop',[[a[2]],[1n]]),/Id already airdropped/);          // once per id
  await assert.rejects(wr(col,'airdrop',[[a[4],a[4]],[4n,4n]]),/Id already airdropped/);   // duplicate inside a batch rolls the whole batch back
  assert.equal(await rd(col,'airdropped',[4n]),false);
  await wr(col,'airdrop',[[a[4],a[5],a[6],a[7]],[4n,5n,6n,7n]]);
  assert.equal(await rd(col,'airdropCount'),7n);
  // airdropped NFTs do not count toward the wallet limit or the free mint
  for(const w of [a[2],a[3],a[4]])assert.equal(await rd(col,'mintedBy',[w]),0n);
  assert.equal(await rd(col,'mintCost',[a[2],3n]),0n);assert.equal(await rd(col,'mintCost',[a[2],4n]),E('0.05'));assert.equal(await rd(col,'mintCost',[a[2],10n]),E('0.35'));
  // art is identical to v1
  for(const id of [1n,5n,7n])assert.equal(keccak256(toHex(await rd(col,'tokenURI',[id]))),keccak256(toHex(await f.read(f.collection,v1.abi,'tokenURI',[id]))));
 });
 await t.test('a v1 id sold after the snapshot is airdropped only to its current holder',async()=>{
  // Fresh pair of ids is not available (all 7 done), so use a second instance for the stale-snapshot case.
  const c2=await f.deploy(v2,args);
  await f.write(f.collection,v1.abi,'transferFrom',[a[7],a[8],7n],7);
  await assert.rejects(wr(c2,'airdrop',[[a[7]],[7n]]),/Not the current holder/);
  await wr(c2,'airdrop',[[a[8]],[7n]]);
  assert.equal((await rd(c2,'ownerOf',[7n])).toLowerCase(),a[8].toLowerCase());
  await f.write(f.collection,v1.abi,'transferFrom',[a[8],a[7],7n],8);               // restore for later cases
 });
 await t.test('bonus airdrop: owner-only, new ids after the airdropped ids, outside the wallet limit, before finalize only',async()=>{
  await assert.rejects(wr(col,'airdropBonus',[[a[11]]],3),/revert/);
  await assert.rejects(wr(col,'airdropBonus',[[]]),/Invalid batch/);
  await assert.rejects(wr(col,'airdropBonus',[Array(101).fill(a[11])]),/Invalid batch/);
  await assert.rejects(wr(col,'airdropBonus',[[zeroAddress]]),/Zero recipient/);
  await wr(col,'airdropBonus',[[a[11],a[11],a[12]]]);   // a[12] has no Agent ID
  for(const [id,who] of [[8n,a[11]],[9n,a[11]],[10n,a[12]]] as const)assert.equal((await rd(col,'ownerOf',[id])).toLowerCase(),who.toLowerCase());
  assert.equal(await rd(col,'bonusCount'),3n);assert.equal(await rd(col,'nextPublicId'),11n);assert.equal(await rd(col,'publicMinted'),0n);assert.equal(await rd(col,'minted'),10n);
  assert.equal(await rd(col,'mintedBy',[a[11]]),0n);assert.equal(await rd(col,'mintCost',[a[11],3n]),0n);
  assert.equal(await rd(col,'airdropCount'),7n);
 });
 await t.test('finalizeAirdrop is owner-only, one-way, and locks the airdrop for good',async()=>{
  await assert.rejects(wr(col,'finalizeAirdrop',[],3),/revert/);
  await wr(col,'finalizeAirdrop',[]);
  assert.equal(await rd(col,'airdropFinalized'),true);
  await assert.rejects(wr(col,'finalizeAirdrop',[]),/Airdrop finalized/);
  await assert.rejects(wr(col,'airdrop',[[a[2]],[1n]]),/Airdrop finalized/);
  await assert.rejects(wr(col,'airdropBonus',[[a[2]]]),/Airdrop finalized/);
 });
 await t.test('public mint opens after finalize and continues after the bonus ids without collisions: 3 free + 7 paid at $0.05',async()=>{
  await assert.rejects(wr(col,'setMintOpen',[true],3),/revert/);
  await wr(col,'setMintOpen',[true]);assert.equal(await rd(col,'mintOpen'),true);
  // wallet 9: 5 mints = 3 free + 2 paid (0.10 USDT) -> vault
  const vaultUsdt=()=>f.read(NFT_PAYMENT,f.m.MockToken.abi,'balanceOf',[vault]) as Promise<bigint>;
  await f.write(NFT_PAYMENT,f.m.MockToken.abi,'approve',[col,E('0.1')],9);
  const before=await vaultUsdt();
  await wr(col,'mint',[5n,E('0.1'),await f.deadline(),f.intent()],9);
  assert.equal(await vaultUsdt()-before,E('0.1'));
  for(const id of [11n,12n,13n,14n,15n])assert.equal((await rd(col,'ownerOf',[id])).toLowerCase(),a[9].toLowerCase());
  assert.equal(await rd(col,'mintedBy',[a[9]]),5n);assert.equal(await rd(col,'publicMinted'),5n);assert.equal(await rd(col,'minted'),15n);assert.equal(await rd(col,'totalSupply'),15n);assert.equal(await rd(col,'nextPublicId'),16n);
  // the remaining free mints are used first: 1 more now costs 0.05, the first three cost nothing
  assert.equal(await rd(col,'mintCost',[a[9],1n]),E('0.05'));
  // BNB mint: exactly $0.05 in BNB per paid NFT goes to the vault (BNB), the rest is refunded
  const price=await rd(col,'mintPriceBNB'),cost=await rd(col,'mintCostBNB',[a[10],5n]),balBefore=await f.client.getBalance({address:vault});
  assert.equal(cost,2n*price);assert.equal(await rd(col,'mintCostBNB',[a[10],3n]),0n);
  const value=cost*2n;
  await wr(col,'mintBNB',[5n,value,await f.deadline(),f.intent()],10,value);
  assert.equal(await f.client.getBalance({address:vault})-balBefore,cost);
  assert.equal(await f.client.getBalance({address:col}),0n);
  assert.equal(await rd(col,'mintedBy',[a[10]]),5n);
  // an airdrop holder still gets 3 free public mints and the full 10 limit (3 free + 7 paid)
  assert.equal(await rd(col,'mintCost',[a[2],3n]),0n);
  const before2=await vaultUsdt();
  await f.write(NFT_PAYMENT,f.m.MockToken.abi,'approve',[col,E('0.35')],2);
  await wr(col,'mint',[10n,E('0.35'),await f.deadline(),f.intent()],2);
  assert.equal(await rd(col,'mintedBy',[a[2]]),10n);assert.equal(await vaultUsdt()-before2,E('0.35'));
  await assert.rejects(wr(col,'mintBNB',[1n,0n,await f.deadline(),f.intent()],2),/Wallet mint limit/);
  // bonus holders can still mint their own 10 (bonus NFTs are outside the limit)
  assert.equal(await rd(col,'mintCost',[a[11],10n]),E('0.35'));
  // all ids are unique and contiguous: 1..7 airdropped, 8..10 bonus, then public
  const supply=Number(await rd(col,'totalSupply'));
  const ids=await Promise.all(Array.from({length:supply},(_,i)=>rd(col,'tokenByIndex',[BigInt(i)])));
  assert.deepEqual(ids.map(Number).sort((x,y)=>x-y),Array.from({length:supply},(_,i)=>i+1));
 });
 await t.test('ownerMint: owner-only free mint after finalize, counts toward supply, ignores wallet limits, public counter',async()=>{
  const before=await rd(col,'nextPublicId'),supply=await rd(col,'totalSupply');
  await assert.rejects(wr(col,'ownerMint',[[a[5]],[1n]],3),/revert/);
  await assert.rejects(wr(col,'ownerMint',[[],[]]),/Invalid batch/);
  await assert.rejects(wr(col,'ownerMint',[[a[5]],[0n]]),/Zero quantity/);
  await assert.rejects(wr(col,'ownerMint',[[a[5]],[101n]]),/Invalid batch/);
  await assert.rejects(wr(col,'ownerMint',[[a[5],a[5]],[1n]]),/Invalid batch/);
  await assert.rejects(wr(col,'ownerMint',[[zeroAddress],[1n]]),/Zero recipient/);
  await wr(col,'ownerMint',[[a[13],a[2]],[12n,1n]]);              // a[13]: 12 NFTs (above the 10 wallet limit); a[2] is already at its limit
  assert.equal(await rd(col,'ownerMinted'),13n);assert.equal(await rd(col,'nextPublicId'),before+13n);assert.equal(await rd(col,'totalSupply'),supply+13n);assert.equal(await rd(col,'minted'),supply+13n);
  assert.equal(await rd(col,'balanceOf',[a[13]]),12n);assert.equal(await rd(col,'mintedBy',[a[13]]),0n);assert.equal(await rd(col,'mintedBy',[a[2]]),10n);
  assert.equal((await rd(col,'ownerOf',[before])).toLowerCase(),a[13].toLowerCase());assert.equal((await rd(col,'ownerOf',[before+12n])).toLowerCase(),a[2].toLowerCase());
 });
 await t.test('the treasury can withdraw collected funds from the vault (and only the treasury)',async()=>{
  const bal=await f.read(NFT_PAYMENT,f.m.MockToken.abi,'balanceOf',[vault]) as bigint;assert.ok(bal>0n);
  await assert.rejects(f.write(vault,vaultArt.abi,'withdrawToken',[NFT_PAYMENT,bal],5),/revert/);
  const t0=await f.read(NFT_PAYMENT,f.m.MockToken.abi,'balanceOf',[a[0]]) as bigint;
  await f.write(vault,vaultArt.abi,'withdrawToken',[NFT_PAYMENT,bal],0);
  assert.equal((await f.read(NFT_PAYMENT,f.m.MockToken.abi,'balanceOf',[a[0]]) as bigint)-t0,bal);
 });
 await t.test('trading rules, pause and ownership are inherited from v1',async()=>{
  await assert.rejects(wr(col,'transferFrom',[a[3],a[5],3n],3),/Sender needs Agent ID/);   // wallet 3 holds an airdropped NFT but still has no Agent ID
  await f.write(AGENT_ID_REGISTRY,f.m.MockIdentity.abi,'set',[a[3],1n],0);
  await wr(col,'transferFrom',[a[3],a[5],3n],3);assert.equal((await rd(col,'ownerOf',[3n])).toLowerCase(),a[5].toLowerCase());
  await wr(col,'pause',[]);await assert.rejects(wr(col,'mintBNB',[1n,0n,await f.deadline(),f.intent()],11),/revert/);await wr(col,'unpause',[]);
  await assert.rejects(wr(col,'renounceOwnership',[]),/Renounce disabled/);
  await wr(col,'transferOwnership',[a[4]]);assert.equal((await rd(col,'owner')).toLowerCase(),a[0].toLowerCase());
  await wr(col,'acceptOwnership',[],4);assert.equal((await rd(col,'owner')).toLowerCase(),a[4].toLowerCase());
  await assert.rejects(wr(col,'finalizeAirdrop',[]),/revert/);
 });
 await t.test('supply cap: public ids stop at 10,000 and total supply never exceeds it',async()=>{
  const capped=await f.deploy(v2,[AGENT_ID_REGISTRY,NFT_PAYMENT,vault,f.renderer,a[0],NFT_PRICE_FEED,f.collection,9999n]);
  await assert.rejects(wr(capped,'airdropBonus',[[a[12],a[12],a[12]]]),/Sold out/);
  await wr(capped,'airdropBonus',[[a[12]]]);
  await wr(capped,'finalizeAirdrop',[]);await wr(capped,'setMintOpen',[true]);
  assert.equal(await rd(capped,'publicRemaining'),1n);
  await assert.rejects(wr(capped,'mintBNB',[2n,0n,await f.deadline(),f.intent()],13),/Sold out/);
  const cost=0n;
  await wr(capped,'mintBNB',[1n,cost*2n,await f.deadline(),f.intent()],13,cost*2n);
  assert.equal(await rd(capped,'totalSupply'),2n);assert.equal(await rd(capped,'nextPublicId'),10001n);
  assert.equal((await rd(capped,'ownerOf',[10000n])).toLowerCase(),a[13].toLowerCase());
  await assert.rejects(wr(capped,'mintBNB',[1n,cost*2n,await f.deadline(),f.intent()],14,cost*2n),/Sold out/);
  await assert.rejects(wr(capped,'ownerMint',[[a[14]],[1n]]),/Sold out/);
 });
 }finally{await f.close();}
});
