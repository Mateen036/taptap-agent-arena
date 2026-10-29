#!/usr/bin/env node
import {generatePrivateKey,privateKeyToAccount} from 'viem/accounts';
import {createPublicClient,http,parseAbi,encodeFunctionData,keccak256,concat,hexToBytes} from 'viem';
import {spawnSync} from 'node:child_process';
import fs from 'node:fs';import path from 'node:path';import os from 'node:os';
import {actionData} from '../lib/protocol';
import {sessionSigningRequest} from './signing-request';
import {strategyDecision} from '../lib/arena';
import {processNftIntent} from './nft-runner';
const args=process.argv.slice(2),mode=args[0]||'help';const option=(key:string)=>{const i=args.indexOf('--'+key);return i<0?undefined:args[i+1]};
const site=option('site')||process.env.TAPTAP_SITE;if(!site&&mode!=='help')throw Error('Set TAPTAP_SITE or --site.');
const origin=site?new URL(site).origin:'';if(site&&new URL(site).protocol!=='https:'&&!['localhost','127.0.0.1'].includes(new URL(site).hostname))throw Error('Use an HTTPS Site URL.');
const dir=path.join(os.homedir(),'.local','state','taptap');const statePath=path.join(dir,origin?keccak256(new TextEncoder().encode(origin)).slice(2,18)+'.json':'unused');
function persist(value:any){fs.mkdirSync(dir,{recursive:true,mode:0o700});const temporary=statePath+'.tmp';fs.writeFileSync(temporary,JSON.stringify(value),{mode:0o600});fs.renameSync(temporary,statePath);}
function load(){if(!fs.existsSync(statePath))throw Error('No session. Run prepare, review the preview, then confirm.');return JSON.parse(fs.readFileSync(statePath,'utf8'));}
function baw(argv:string[]){const p=spawnSync('baw',[...argv,'--json'],{encoding:'utf8',maxBuffer:2*1024*1024});if(p.status!==0)throw Error('Binance Wallet command failed: '+(p.stderr||p.stdout));let r;try{r=JSON.parse(p.stdout)}catch{throw Error('Binance Wallet returned invalid JSON.')}if(!r.success)throw Error(JSON.stringify(r.error));return r.data;}
async function request(endpoint:string,b:any){const r=await fetch(origin+'/api/'+endpoint,{method:'POST',headers:{'Content-Type':'application/json',...(process.env.TAPTAP_SITE_ACCESS_TOKEN?{'OAI-Sites-Authorization':'Bearer '+process.env.TAPTAP_SITE_ACCESS_TOKEN}:{})},body:JSON.stringify(b)});let d:any;try{d=await r.json()}catch{throw Error('Site is not reachable as an API. Private Sites require TAPTAP_SITE_ACCESS_TOKEN.')}return {ok:r.ok,status:r.status,data:d};}
const wait=(ms:number)=>new Promise(r=>setTimeout(r,ms));
async function action(s:any,kind:string,payload:any={}){const account=privateKeyToAccount(s.sessionPrivateKey);const envelope={sessionId:s.sessionId,nonce:s.nonce,timestamp:Date.now(),action:kind,payload};const signature=await account.signTypedData(actionData(origin,envelope) as any);const r=await request('agent/action',{...envelope,signature});if(Number.isSafeInteger(r.data.nonce)){s.nonce=r.data.nonce;persist(s);}if(!r.ok)throw Object.assign(Error(r.data.error||'Agent action failed.'),{status:r.status});return r.data;}
function normalizeSignature(d:any){let sig=String(d.signature||'').replace(/^0x/,'');if(sig.length===128){let v=parseInt(String(d.signatureRecovery||''),16);if(v===0||v===1)v+=27;if(v!==27&&v!==28)throw Error('Invalid signature recovery byte.');sig+=v.toString(16);}if(!/^[0-9a-fA-F]{130}$/.test(sig))throw Error('Invalid Binance signature.');return '0x'+sig;}
async function report(stage:string,code?:string){try{await request('agent/report',{pairingCode:process.env.TAPTAP_PAIRING_CODE||option('pair'),stage,code});}catch{}}
async function prepare(){
 await report('wallet_check');
 if(!process.env.TAPTAP_PAIRING_CODE&&!option('pair'))throw Error('Set TAPTAP_PAIRING_CODE to the code from your dashboard.');
 const status=baw(['wallet','status']);if(status.status!=='CONNECTED')throw Error('Sign in to Binance Agentic Wallet first using baw auth signin / auth verify.');
 await report('identity_check');const identity=baw(['wallet','agent-id']);if(!identity.claimed)throw Error('Claim your .ai Agent ID in Binance Wallet first.');
 const settings=baw(['wallet','settings']);const raw=settings.devMode?.expiresAt;const numeric=Number(raw);const expiry=typeof raw==='string'&&!/^\d+$/.test(raw)?Date.parse(raw):numeric<1e12?numeric*1000:numeric;if(!settings.devMode?.enabled||!Number.isFinite(expiry)||expiry<Date.now())throw Error('Enable Developer Mode in Binance App → Agentic Wallet → Settings.');
 const addresses=baw(['wallet','address']).addresses;const wallet=addresses.find((a:any)=>String(a.binanceChainId)==='56')?.address;if(!wallet)throw Error('No BNB Chain wallet address is available.');
 const key=generatePrivateKey(),account=privateKeyToAccount(key);
 const result=await request('agent/challenge',{pairingCode:process.env.TAPTAP_PAIRING_CODE||option('pair'),wallet,sessionKey:account.address});if(!result.ok)throw Error(result.data.error);
 const c=result.data;const message=sessionSigningRequest(wallet,c.typedData);
 await report('preview');const preview=baw(['sign-message','preview','--binanceChainId','56','--signType','EIP712','--message',message]);
 await report('approval');persist({origin,wallet,sessionPrivateKey:key,challengeId:c.challengeId,expiresAt:c.expiresAt,requestId:preview.requestId});
 console.log(JSON.stringify({wallet,agentId:identity.agentId,typedData:c.typedData,preview,scope:'Game commands only; no token approvals or transfers.',next:'Show the preview to the user. After explicit approval, run confirm --approve-session.'},null,2));
}
async function confirm(){if(!args.includes('--approve-session'))throw Error('Review the preview and obtain user approval before adding --approve-session.');const s=load();if(s.expiresAt<Date.now())throw Error('Challenge expired. Create a new pairing.');
 const result=s.orderId?baw(['sign-message','result','--order-id',s.orderId]):baw(['sign-message','execute','--requestId',s.requestId]);
 if(result.status==='PENDING_CONFIRMATION'){s.orderId=result.orderId;persist(s);console.log('Confirm the signature in Binance App, then run confirm --approve-session again. The preview will not be executed twice.');return;}
 if(result.status!=='COMPLETED')throw Error('Signature is '+result.status);
 const r=await request('agent/session',{challengeId:s.challengeId,signature:normalizeSignature(result)});if(!r.ok)throw Error(r.data.error);persist({...s,...r.data,requestId:undefined,orderId:undefined});console.log('Verified agent session paired. Run watch to consume queued commands. No wallet keys were exported.');
}
async function watch(){
 const s=load();if(!s.sessionId)throw Error('Confirm the session first.');let stopped=false;
 process.on('SIGINT',()=>{stopped=true;});process.on('SIGTERM',()=>{stopped=true;});
 console.log('Watching queued commands and competition tasks. Ctrl+C stops the connector. Session expires '+new Date(s.expiresAt).toISOString());
 while(!stopped&&Date.now()<s.expiresAt){
  try{
   const r=await action(s,'state'),competition=r.competition;
   if(await processNftIntent(s,r.nft?.intents||[],{action,baw,persist}))continue;
   if(r.agent?.gameAccess?.required&&!r.agent.gameAccess.canPlay){await wait(5000);continue;}
   const job=competition?.jobs.filter((j:any)=>['queued','running'].includes(j.status)).sort((a:any,b:any)=>a.created_at-b.created_at)[0];
   if(job){
    try{
     if(job.status==='queued')await action(s,'job-start',{jobId:job.id});
     const actions:any={'season-join':'season-join','daily-join':'arena-join','duel-create':'duel-create','duel-accept':'duel-accept','duel-rematch':'duel-rematch'};
     await action(s,actions[job.kind],{...job.payload,jobId:job.id});
     await action(s,'job-complete',{jobId:job.id});
     console.log(JSON.stringify({task:job.kind,status:'completed'}));
    }catch(error:any){
     if(error.status&& !/Nonce mismatch/.test(error.message)){await action(s,'job-complete',{jobId:job.id,status:'failed',error:error.status===409?'conflict':error.status===403?'rejected':'unavailable'});console.error('Task failed: '+error.message);}else throw error;
    }
    continue;
   }
   const entry=competition?.entries.filter((e:any)=>Date.now()<e.ends_at).sort((a:any,b:any)=>a.started_at-b.started_at)[0];
   if(entry){
    const decision=strategyDecision(entry,Date.now());
    if(decision){if(decision.action==='arena-tap'&&Date.now()-entry.last_tick<1000)await wait(1000);const result=await action(s,decision.action,decision.payload);console.log(JSON.stringify({arena:result.entry?.id,score:result.entry?.score,energy:result.entry?.energy,action:decision.action}));}
    await wait(5000);continue;
   }
   let a=r.agent,c=a.commands.find((c:any)=>c.status==='running');
   if(!c){c=a.commands.filter((c:any)=>c.status==='queued'||c.status==='paused').sort((a:any,b:any)=>a.created_at-b.created_at)[0];if(c&&a.energy>=Math.min(50,c.target-c.done)){const started=await action(s,'start',{commandId:c.id});a=started.agent;c=a.commands.find((c:any)=>c.status==='running');}}
   if(c){await wait(5000);if(stopped)break;const result=await action(s,'tap',{commandId:c.id,taps:Math.min(100,a.speed*5,c.target-c.done)});console.log(JSON.stringify({taps:result.agent.taps,points:result.agent.points,energy:result.agent.energy}));}else await wait(5000);
  }catch(error:any){console.error(error.message);if(/expired or revoked|Agent disconnected/.test(error.message))break;await wait(5000);}
 }
 try{const r=await action(s,'state');const c=r.agent.commands.find((c:any)=>c.status==='running');if(c)await action(s,'stop',{commandId:c.id});for(const entry of r.competition?.entries||[])if(Date.now()>=entry.started_at&&Date.now()<entry.ends_at&&!entry.resting)await action(s,'arena-rest',{entryId:entry.id});}catch{}
 console.log('Connector stopped. Pair again after session expiry.');
}
async function diagnose(){
 const status=baw(['wallet','status']);let s:any={};try{s=load()}catch{}
 console.log(JSON.stringify({walletStatus:status.status,gameSession:!!s.sessionId,gameSessionExpiresAt:s.expiresAt?new Date(s.expiresAt).toISOString():null,site:origin,guide:origin+'/agent-skill.md',recovery:status.status==='CONNECTED'?'Use prepare, preview, and confirm for a new game session. Developer Mode and Secure Auto Sign are separate.':'Sign in using the official Binance Agentic Wallet authentication flow.'},null,2));
}
async function claimPreview(){const s=load(),r=await action(s,'state'),reward=r.rewards;if(!reward?.proof)throw Error('No active token allocation is published for your wallet.');if(reward.chain_id!==56)throw Error('Wrong reward network.');
 const client=createPublicClient({transport:http(process.env.BSC_RPC_URL||'https://bsc-dataseed.bnbchain.org')});if(await client.getChainId()!==56)throw Error('RPC is not on BNB Chain.');
 const abi=parseAbi(['function root() view returns(bytes32)','function epoch() view returns(uint256)','function token() view returns(address)','function claimed(address) view returns(uint256)','function leaf(uint256,address,uint256) view returns(bytes32)','function claim(uint256,uint256,bytes32[])']);
 const root=await client.readContract({address:reward.contract,abi,functionName:'root'}),epoch=await client.readContract({address:reward.contract,abi,functionName:'epoch'}),token=await client.readContract({address:reward.contract,abi,functionName:'token'});if(root!==reward.root||epoch!==BigInt(reward.id)||token.toLowerCase()!==reward.token.toLowerCase())throw Error('Published allocation does not match the contract.');
 let leaf=await client.readContract({address:reward.contract,abi,functionName:'leaf',args:[epoch,s.wallet,BigInt(reward.proof.amount)]});for(const p of reward.proof.proof){leaf=keccak256(concat(BigInt(leaf)<BigInt(p)?[leaf,p]:[p,leaf]));}if(leaf!==root)throw Error('Invalid allocation proof.');const claimed=await client.readContract({address:reward.contract,abi,functionName:'claimed',args:[s.wallet]});if(BigInt(reward.proof.amount)<=claimed)throw Error('This allocation has already been claimed.');
 const settings=baw(['wallet','settings']);if(!settings.devMode?.enabled)throw Error('Enable Developer Mode first.');const input=encodeFunctionData({abi,functionName:'claim',args:[epoch,BigInt(reward.proof.amount),reward.proof.proof]});const preview=baw(['contract-call','preview','--binanceChainId','56','--from',s.wallet,'--to',reward.contract,'--value','0','--inputData',input]);
 console.log(JSON.stringify({contract:reward.contract,token,amountRaw:(BigInt(reward.proof.amount)-claimed).toString(),preview,next:'Show all risks, get user approval, then use baw contract-call execute --requestId from this preview. Do not execute without approval.'},null,2));
}
(async()=>{if(mode==='prepare')await prepare();else if(mode==='confirm')await confirm();else if(mode==='watch')await watch();else if(mode==='diagnose')await diagnose();else if(mode==='action'){const kind=option('action');if(!kind)throw Error('Set --action and --payload JSON.');console.log(JSON.stringify(await action(load(),kind,JSON.parse(option('payload')||'{}')),null,2));}else if(mode==='state')console.log(JSON.stringify(await action(load(),'state'),null,2));else if(mode==='claim-preview')await claimPreview();else console.log('TapTap agent connector\nCommands: prepare, confirm --approve-session, watch, state, diagnose, action --action NAME --payload JSON, claim-preview\nSet TAPTAP_SITE and TAPTAP_PAIRING_CODE. Private Sites also require TAPTAP_SITE_ACCESS_TOKEN.\nRequires Node 22+ and the official baw CLI. This connector never exports Binance wallet keys or transfers funds automatically.');})().catch(async e=>{if(mode==='prepare'){const code=['351509','351802','351803','351804'].find(c=>String(e.message).includes(c))||(/Agent ID/.test(e.message)?'identity':/Sign in/.test(e.message)?'unconnected':'unknown');await report('failed',code);}console.error(e.message);process.exitCode=1;});
