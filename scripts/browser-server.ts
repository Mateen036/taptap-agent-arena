// Local-only integration fixture. Never imported by application routes or deployment packaging.
import http from 'node:http';import fs from 'node:fs';import path from 'node:path';import crypto from 'node:crypto';
import {handle} from '../lib/api';import {SQLiteDatabase} from '../test/helpers/database';import {browserSession} from '../deploy/vercel/lib/browser-session';
import {generatePrivateKey,privateKeyToAccount} from 'viem/accounts';import {actionData} from '../lib/protocol';import {createPublicCard} from '../lib/share-card';
import {nftPreviewResponse} from '../lib/nft-preview';
import {nftChain} from '../test/helpers/nft-chain';
if(process.env.TAPTAP_BROWSER_FIXTURE!=='1'||process.env.NODE_ENV==='production')throw Error('This fixture must only run explicitly in local test mode.');
process.env.AUTH_SECRET=crypto.randomBytes(32).toString('hex');
const db=new SQLiteDatabase(),nativeNow=Date.now;let offset=0;Date.now=()=>nativeNow()+offset;
const port=Number(process.env.TAPTAP_TEST_PORT||4173),origin='http://127.0.0.1:'+port;
const rpc=http.createServer(async(req,res)=>{let text='';for await(const c of req)text+=c;const b=JSON.parse(text);res.setHeader('Content-Type','application/json');res.end(JSON.stringify({jsonrpc:'2.0',id:b.id,result:b.method==='eth_chainId'?'0x38':b.method==='eth_getCode'?'0x':'0x'+1n.toString(16).padStart(64,'0')}));});
await new Promise<void>(resolve=>rpc.listen(0,'127.0.0.1',resolve));
const env:any={DB:db,BSC_RPC_URL:'http://127.0.0.1:'+(rpc.address() as any).port,ALLOW_WALLET_RELINK:true,STORAGE_NAME:'SQLite test fixture'};
const sessions=new Map<string,any>();
let nftFixture:Awaited<ReturnType<typeof nftChain>>|undefined,nftPlayer=1;
async function request(endpoint:string,body:any){const r=await handle(new Request(origin+'/api/'+endpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}),env);return {status:r.status,body:await r.json() as any};}
async function paired(code:string){const wallet=nftFixture?nftFixture.accounts[nftPlayer++]:privateKeyToAccount(generatePrivateKey()),key=privateKeyToAccount(generatePrivateKey());const c=await request('agent/challenge',{pairingCode:code,wallet:wallet.address,sessionKey:key.address});if(c.status!==200)throw Error(c.body.error);const s=await request('agent/session',{challengeId:c.body.challengeId,signature:await wallet.signTypedData(c.body.typedData)});if(s.status!==200)throw Error(s.body.error);sessions.set(wallet.address.toLowerCase(),{...s.body,key});return {wallet:wallet.address.toLowerCase()};}
async function act(wallet:string,action:string,payload:any={}){const s=sessions.get(wallet);if(!s)throw Error('Test session missing');const envelope={sessionId:s.sessionId,nonce:s.nonce,timestamp:Date.now(),action,payload};const signature=await s.key.signTypedData(actionData(origin,envelope) as any);const r=await request('agent/action',{...envelope,signature});if(r.body.nonce!==undefined)s.nonce=r.body.nonce;return r;}
const mime:Record<string,string>={'.js':'text/javascript','.css':'text/css','.md':'text/markdown','.woff2':'font/woff2','.ttf':'font/ttf','.svg':'image/svg+xml','.png':'image/png'};
const server=http.createServer(async(req,res)=>{
 try{
 const url=new URL(req.url||'/',origin);const chunks=[];for await(const c of req)chunks.push(c);const bytes=Buffer.concat(chunks);
 if(url.pathname.startsWith('/__test/')){
  if(req.headers['x-taptap-test']!=='local-browser-fixture'){res.writeHead(403).end();return;}
  const b=bytes.length?JSON.parse(bytes.toString()):{};let result:any={};
  if(url.pathname==='/__test/pair')result=await paired(b.code);
  else if(url.pathname==='/__test/act')result=await act(b.wallet,b.action,b.payload||{});
  else if(url.pathname==='/__test/time'){offset+=Number(b.ms)||0;result={serverTime:Date.now()};}
  else if(url.pathname==='/__test/nft/start'){
   if(!nftFixture)nftFixture=await nftChain();env.NFT_RPC_URL=nftFixture.rpc;env.NFT_COLLECTION=nftFixture.collection;env.NFT_MARKETPLACE=nftFixture.market;env.NFT_LP_VAULT=nftFixture.vault;result={ready:true};
  }
  else if(url.pathname==='/__test/utility/activate'){
   if(!nftFixture)throw Error('Start real local NFT chain first');
   env.NFT_GAME_UTILITY='true';await db.prepare("INSERT INTO game_settings(key,value) VALUES('nft_utility_v2','active') ON CONFLICT(key) DO UPDATE SET value='active'").run();result={active:true};
  }
  else if(url.pathname==='/__test/utility/transfer'){
   if(!nftFixture)throw Error('NFT fixture not started');const from=nftFixture.accounts.findIndex(a=>a.address.toLowerCase()===b.wallet),to=b.back?from:2,source=b.back?2:from;
   await nftFixture.write(nftFixture.collection,nftFixture.art('NibFoundry').abi,'transferFrom',[nftFixture.accounts[source].address,nftFixture.accounts[to].address,BigInt(b.tokenId)],source);result={transferred:true};
  }
  else if(url.pathname==='/__test/utility/balance'){
   const amount='9007199254740993123456789';await db.prepare('UPDATE agents SET points=9000000000000,earned=9000000000000,points_exact=?,earned_exact=? WHERE wallet=?').bind(amount,amount,b.wallet).run();result={amount};
  }
  else if(url.pathname==='/__test/nft/preview'){
   const c=await act(b.wallet,'nft-claim',{intentId:b.intentId});if(c.status!==200)throw Error(c.body.error);const i=c.body.intent;
   result=await act(b.wallet,'nft-preview',{intentId:i.id,transaction:i.transaction,preview:{requestId:'fixture-'+crypto.randomUUID(),expiresAt:Date.now()+180000,parsedTx:{title:i.summary.title},simulationResult:{authorityChanges:i.kind==='nft-approval'?[{operation:'approveNFT',tokenId:i.payload.tokenId,spender:env.NFT_MARKETPLACE}]:[],allowanceChanges:[]},risks:{riskDetails:[],addresses:{},riskBehaviors:[]},requireConfirmation:false}});
  }
  else if(url.pathname==='/__test/nft/execute'){
   if(!nftFixture)throw Error('NFT fixture not started');const state=await act(b.wallet,'nft-state'),i=state.body.intents.find((i:any)=>i.id===b.intentId);if(!i)throw Error('Intent missing');const c=await act(b.wallet,'nft-execute',{intentId:i.id,requestId:i.preview_request_id});if(c.status!==200)throw Error(c.body.error);
   const who=nftFixture.accounts.findIndex(a=>a.address.toLowerCase()===b.wallet);const tx=i.transaction;const hash=await nftFixture.wallets[who].sendTransaction({account:nftFixture.accounts[who],chain:nftFixture.wallets[who].chain,to:tx.to,data:tx.data,value:BigInt(tx.value)});await nftFixture.client.waitForTransactionReceipt({hash});await nftFixture.provider.request({method:'evm_mine',params:[]});await nftFixture.provider.request({method:'evm_mine',params:[]});await act(b.wallet,'nft-broadcast',{intentId:i.id,transactionHash:hash});result=await act(b.wallet,'nft-confirm',{intentId:i.id,transactionHash:hash});
  }
  else if(url.pathname==='/__test/reset'){await db.prepare("DELETE FROM arena_entries").run();await db.prepare("DELETE FROM arena_matches").run();}
  res.setHeader('Content-Type','application/json');res.end(JSON.stringify(result));return;
 }
 if(url.pathname.startsWith('/api/nft/preview/v1/')){const result=nftPreviewResponse(decodeURIComponent(url.pathname.slice('/api/nft/preview/v1/'.length)));res.writeHead(result.status,Object.fromEntries(result.headers));res.end(Buffer.from(await result.arrayBuffer()));return;}
 if(url.pathname.startsWith('/api/card/')){
  const [, , ,kind,id]=url.pathname.split('/'),routes:Record<string,string>={profile:'agents',match:'matches',run:'runs',round:'rounds'};
  const endpoint=kind==='season'?'/api/season':routes[kind]?'/api/public/'+routes[kind]+'/'+id:null;
  if(!endpoint){res.writeHead(404).end();return;}
  const data=await handle(new Request(origin+endpoint),env);if(!data.ok){res.writeHead(data.status).end();return;}
  const card=createPublicCard(kind,await data.json(),'data:image/png;base64,'+fs.readFileSync('public/brand/nib-mascot.png').toString('base64'),{regular:fs.readFileSync('public/fonts/dm-sans-400.ttf'),bold:fs.readFileSync('public/fonts/dm-sans-700.ttf')});
  const image=Buffer.from(await card.arrayBuffer());res.writeHead(card.status,Object.fromEntries(card.headers));res.end(image);return;
 }
 if(url.pathname.startsWith('/api/')){
  const headers=new Headers(req.headers as any);for(const key of [...headers.keys()])if(key.toLowerCase().startsWith('oai-authenticated-'))headers.delete(key);
  const web=!/^\/api\/(agent\/|admin\/|health$)/.test(url.pathname);const raw=new Request(url,{method:req.method,headers,...(bytes.length?{body:bytes}:{}),duplex:'half'} as any);
  const session=web?browserSession(raw):null;if(session)headers.set('oai-authenticated-user-id',session.userId);
  const forwarded=new Request(raw,{headers});const result=await handle(forwarded,env);if(session?.cookie)result.headers.append('Set-Cookie',session.cookie);
  res.writeHead(result.status,Object.fromEntries(result.headers));res.end(Buffer.from(await result.arrayBuffer()));return;
 }
 if(url.pathname==='/'||/^\/(agents|matches|runs|rounds)\/[^/]+$/.test(url.pathname)){res.setHeader('Content-Type','text/html');res.end(fs.readFileSync('ui/index.html','utf8').replace('<!-- NFT_VIEWS -->',fs.readFileSync('ui/nft.html','utf8')));return;}
 const filename=path.resolve('public','.'+decodeURIComponent(url.pathname));if(!filename.startsWith(path.resolve('public')+path.sep)||!fs.existsSync(filename)||!fs.statSync(filename).isFile()){res.writeHead(404).end();return;}
 res.setHeader('Content-Type',mime[path.extname(filename)]||'application/octet-stream');res.end(fs.readFileSync(filename));
 }catch(error){console.error('Browser fixture error',error instanceof Error?error.message:'unknown');if(res.headersSent){res.end();return;}res.writeHead(500,{'Content-Type':'application/json'});res.end(JSON.stringify({error:error instanceof Error?error.message:'Fixture unavailable'}));}
});
await new Promise<void>(resolve=>server.listen(port,'127.0.0.1',resolve));console.log('TapTap local browser fixture: '+origin);
const stop=()=>{server.close();rpc.close();Promise.all([db.close(),nftFixture?.close()]).finally(()=>process.exit());};process.on('SIGINT',stop);process.on('SIGTERM',stop);
