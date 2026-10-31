import {test} from 'node:test';
import assert from 'node:assert/strict';
import {nftChain} from './helpers/nft-chain';
import {databaseFixture} from './helpers/database';
import {nftSnapshot} from '../lib/nft';
import {gameAccess} from '../lib/utility';
import {nftBonusStatus,NFT_BONUS_POINTS,NFT_BONUS_CAP_POINTS} from '../lib/airdrop';
import {resolveNftEnv,nftV2Active,NFT_PAYMENT,NFT_ROUTER} from '../lib/nft-protocol';
import {AGENT_ID_REGISTRY} from '../lib/protocol';

// With NFT_COLLECTION_V2 set the site serves only NibCollectionV2 (+ its own marketplace and vault): the old collection is invisible everywhere.
test('NFT_COLLECTION_V2 switches the whole site to V2 and hides v1',async()=>{
 const f=await nftChain(),v1=f.art('NibCollection'),v2=f.art('NibCollectionV2'),vaultArt=f.art('NibVaultV2'),a=f.accounts.map((x:any)=>x.address as `0x${string}`);
 const db=await databaseFixture('sqlite'),url=new URL('https://x.test/api/nft');
 try{
  await f.write(f.collection,v1.abi,'mintBNB',[1n,0n,await f.deadline(),f.intent()],1,0n);                 // v1 id 1 -> wallet 1
  const nibToken=await f.deploy(f.m.MockToken),vault=await f.deploy(vaultArt,[nibToken,NFT_PAYMENT,NFT_ROUTER,a[0]]);
  const col=await f.deploy(v2,[AGENT_ID_REGISTRY,NFT_PAYMENT,vault,f.renderer,a[0],'0x0567F2323251f0Aab15c8dFb1967E4e8A7D42aeE',f.collection,2n]);
  const mkt=await f.deploy(f.art('NibMarketplace'),[col,AGENT_ID_REGISTRY,vault]);
  // The v1 contract is still live in this fixture (and configured through the v1 variables) but must be ignored.
  const env:any={DB:db,NFT_RPC_URL:f.rpc,NFT_COLLECTION:f.collection,NFT_MARKETPLACE:f.market,NFT_LP_VAULT:f.vault,NFT_COLLECTION_V2:col,NFT_LEGACY_COLLECTION:f.collection,NFT_MARKETPLACE_V2:mkt,NIB_VAULT_V2:vault};
  assert.equal(nftV2Active({}),false);assert.equal(nftV2Active(env),true);
  const r=resolveNftEnv(env);assert.equal(r.NFT_COLLECTION,col);assert.equal(r.NFT_MARKETPLACE,mkt);assert.equal(r.NFT_LP_VAULT,vault);assert.equal(r.NFT_COLLECTION_BIDS,undefined);assert.deepEqual(resolveNftEnv(r),r);
  const snap=()=>nftSnapshot(env,null,url,Date.now()) as Promise<any>;
  let s=await snap();
  assert.equal(s.contracts.collection.toLowerCase(),col.toLowerCase());assert.equal(s.contracts.market.toLowerCase(),mkt.toLowerCase());assert.equal(s.contracts.vault.toLowerCase(),vault.toLowerCase());
  const text=JSON.stringify(s).toLowerCase();for(const old of [f.collection,f.market,f.vault])assert.ok(!text.includes(old.toLowerCase()),'v1 address leaked: '+old);
  assert.equal(s.lp,null);assert.equal(s.v2.active,true);assert.equal(s.v2.airdropFinalized,false);assert.equal(s.status,'awaiting_airdrop');assert.equal(s.mintOpen,false);
  assert.equal(s.freePerWallet,3);assert.equal(s.paidPrice,'0.05');assert.equal(s.minted,0);assert.equal(s.v2.publicStartId,2);assert.equal(s.feeDestination,'NibVaultV2 vault');
  // Half-configured V2 fails closed instead of falling back to v1.
  await assert.rejects(nftSnapshot({...env,NFT_MARKETPLACE_V2:undefined},null,url,Date.now()),/incomplete/);
  // A contract that is not a NibCollectionV2 (here: the old collection) is refused.
  await assert.rejects(nftSnapshot({...env,NFT_COLLECTION_V2:f.collection},null,url,Date.now()),/verification|published/);
  // Airdrop + bonus + owner mint + finalize + open: the public state follows the chain.
  await f.write(col,v2.abi,'airdrop',[[a[1]],[1n]],0);await f.write(col,v2.abi,'airdropBonus',[[a[3],a[3]]],0);await f.write(col,v2.abi,'ownerMint',[[a[4]],[2n]],0);
  await f.write(col,v2.abi,'finalizeAirdrop',[],0);await f.write(col,v2.abi,'setMintOpen',[true],0);
  s=await snap();assert.equal(s.status,'live');assert.equal(s.mintOpen,true);assert.equal(s.minted,5);
  assert.deepEqual([s.v2.airdropCount,s.v2.bonusCount,s.v2.ownerMinted,s.v2.publicMinted],[1,2,2,0]);
  // Free mints are per wallet and public-mint only: an airdropped / bonus / owner-minted wallet still has all 3 free mints, so every wallet gets 3 free mints.
  for(const w of [a[1],a[3],a[4],a[2]]){const sw=await nftSnapshot(env,w,url,Date.now()) as any;assert.equal(sw.wallet.minted,0,'airdropped NFTs must not count as minted');assert.equal(sw.wallet.freeRemaining,3);assert.equal(sw.wallet.freeAvailable,true);assert.equal(sw.wallet.remaining,10);}
  // Game gate + multiplier read V2 holdings only: wallet 1 holds v1 id 1 AND airdropped V2 id 1; wallet 2 holds nothing on V2.
  const policy={active:true,version:2 as const,formula:'5*owned' as const,scope:'earned_tap_only' as const};
  const g1=await gameAccess({...env,_utilityPolicy:policy},a[1]);assert.equal(g1.canPlay,true);assert.equal(g1.owned,1);assert.equal(g1.multiplier,'5');assert.equal(g1.collection?.toLowerCase(),col.toLowerCase());
  const g3=await gameAccess({...env,_utilityPolicy:policy},a[3]);assert.equal(g3.owned,2);assert.equal(g3.multiplier,'10');
  await f.write(f.collection,v1.abi,'transferFrom',[a[1],a[2],1n],1);   // the v1 NFT moves; V2 holdings are unaffected
  const g2=await gameAccess({...env,_utilityPolicy:policy},a[2]);assert.equal(g2.canPlay,false);assert.equal(g2.status,'nft_required');assert.equal(g2.owned,0);
  assert.equal((await gameAccess({...env,_utilityPolicy:policy},a[1])).owned,1);
  // The NFT bonus points at V2; claims are keyed by token id, so an id already claimed stays claimed.
  const season={currentSeason:1,paused:false,seasons:[{status:'open',pointsPerNib:10n}]} as any;
  const b=await nftBonusStatus(env,null,season);assert.equal(b.collection.toLowerCase(),col.toLowerCase());
  assert.equal(NFT_BONUS_POINTS*10_000n,1_000_000_000n);assert.ok(NFT_BONUS_POINTS*10_000n<=NFT_BONUS_CAP_POINTS);
  await db.prepare('INSERT INTO nft_bonus_claims(token_id,wallet,agent,amount,claimed_at) VALUES (?,?,?,?,?)').bind(1,a[1],'x',Number(NFT_BONUS_POINTS),1).run();
  await assert.rejects(db.prepare('INSERT INTO nft_bonus_claims(token_id,wallet,agent,amount,claimed_at) VALUES (?,?,?,?,?)').bind(1,a[2],'y',Number(NFT_BONUS_POINTS),2).run(),/UNIQUE|unique|constraint|PRIMARY/i);
 }finally{await f.close();}
});
