import {test} from 'node:test';import assert from 'node:assert/strict';import {decodeFunctionData,parseAbi} from 'viem';
import {collectionV2Plans} from '../scripts/nib-collection-v2-deploy';
import {vaultV2Plan} from '../scripts/nib-vault-v2-deploy';
import {buildBatches,ownerMintBatches,paidMintsOf,bonusOf} from '../scripts/nib-collection-v2-airdrop';
import {NFT_COLLECTION_V1} from '../lib/nft-protocol';
const abi=parseAbi(['function airdrop(address[] to,uint256[] ids)','function airdropBonus(address[] to)','function ownerMint(address[] to,uint256[] counts)','function finalizeAirdrop()']);
const A=(n:number)=>('0x'+n.toString(16).padStart(40,'0')) as `0x${string}`;
test('deployment plan: three CREATE2 steps, vault first, V2 contracts bound to the new collection, deterministic addresses',()=>{
 const p=collectionV2Plans({}),again=collectionV2Plans({});
 assert.equal(p.vault,vaultV2Plan().address);assert.equal(p.publicStartId,1188n);assert.equal(p.feeRecipient,p.vault);
 const [c,m,b]=p.steps;assert.deepEqual(p.steps.map(s=>s.address),again.steps.map(s=>s.address));assert.equal(new Set(p.steps.map(s=>s.address)).size,3);
 assert.equal(c.args[2],p.vault);assert.equal(String(c.args[6]).toLowerCase(),NFT_COLLECTION_V1.toLowerCase());assert.equal(c.args[7],1188n);
 assert.equal(m.args[0],c.address);assert.equal(b.args[0],c.address);assert.equal(m.args[2],p.vault);assert.equal(b.args[2],p.vault);
 assert.notEqual(collectionV2Plans({V2_FEE_RECIPIENT:'treasury'}).feeRecipient,p.vault);
 assert.notEqual(collectionV2Plans({V2_PUBLIC_START_ID:'1189'}).steps[0].address,c.address);assert.throws(()=>collectionV2Plans({V2_PUBLIC_START_ID:'1'}));
});
test('bonus math: each paid v1 mint is $1 = 20 V2 NFTs, the first mint of a wallet was free',()=>{
 assert.equal(paidMintsOf(10n),9n);assert.equal(bonusOf(paidMintsOf(10n)),180n);assert.equal(bonusOf(paidMintsOf(3n)),40n);assert.equal(paidMintsOf(1n),0n);assert.equal(paidMintsOf(0n),0n);
});
test('airdrop batches: ids once each in order, bonus expanded per NFT, finalize last, size limits respected',()=>{
 const holders=Array.from({length:299},(_,i)=>({id:i+1,owner:A(1000+(i%7)),hasAgentId:true}));
 const bonus=[{wallet:A(1),paidMints:9,usd:'9.00',bonusNfts:180,hasAgentId:true},{wallet:A(2),paidMints:2,usd:'2.00',bonusNfts:40,hasAgentId:false}];
 const b=buildBatches({holders,bonus});
 assert.deepEqual(b.map(x=>x.kind),['airdrop','airdrop','airdrop','airdrop','airdrop','airdrop','bonus','bonus','bonus','bonus','bonus','finalize']);
 const ids:bigint[]=[];let bonusTo:string[]=[];
 for(const x of b){const d=decodeFunctionData({abi,data:x.data});
  if(d.functionName==='airdrop'){assert.ok(d.args[0].length<=50&&d.args[0].length===d.args[1].length);ids.push(...d.args[1]);}
  else if(d.functionName==='airdropBonus'){assert.ok(d.args[0].length<=50);bonusTo.push(...d.args[0]);}
  else assert.equal(d.functionName,'finalizeAirdrop');}
 assert.deepEqual(ids,holders.map(h=>BigInt(h.id)));assert.equal(bonusTo.length,220);assert.equal(bonusTo.filter(x=>x===A(1)).length,180);assert.equal(bonusTo.filter(x=>x===A(2)).length,40);
 assert.equal(b[b.length-1].name,'finalize');
});
test('ownermint batching splits a large count and keeps recipients',()=>{
 const b=ownerMintBatches(A(5)+':120,'+A(6)+':3');
 const total=b.reduce((s,x)=>s+x.count,0);assert.equal(total,123);assert.ok(b.every(x=>x.count<=50));
 let got=0;for(const x of b){const d=decodeFunctionData({abi,data:x.data});assert.equal(d.functionName,'ownerMint');got+=(d.args[1] as bigint[]).reduce((s,n)=>s+Number(n),0);}assert.equal(got,123);
 assert.throws(()=>ownerMintBatches('0xabc:1'));assert.throws(()=>ownerMintBatches(A(1)+':0'));
});
test('connector pins match the planned V2 CREATE2 addresses (regenerate the pins if the deployment arguments change)',async()=>{
 const {NIB_COLLECTION_V2,NIB_COLLECTION_BIDS_V2}=await import('../agent/do');const p=collectionV2Plans({});
 assert.equal(NIB_COLLECTION_V2.toLowerCase(),p.steps[0].address.toLowerCase());assert.equal(NIB_COLLECTION_BIDS_V2.toLowerCase(),p.steps[2].address.toLowerCase());
});
