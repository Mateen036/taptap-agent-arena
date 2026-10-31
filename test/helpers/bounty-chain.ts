// Local ganache fixture for NibBugBounty: mock NIB, mock Agent ID registry, the real contract artifact, and typed helpers.
import fs from 'node:fs';import solc from 'solc';import ganache from 'ganache';
import {decodeErrorResult,encodeFunctionData,createWalletClient,createPublicClient,custom,parseEther,keccak256,encodeAbiParameters,toHex,zeroAddress} from 'viem';import {privateKeyToAccount} from 'viem/accounts';
export const E=(n:number|string)=>parseEther(String(n));
export const DAY=86400;
const mocks=`// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
contract MockNib is ERC20 {constructor() ERC20("NIB Token","NIB"){} function mint(address a,uint256 n) external {_mint(a,n);}}
contract MockIdentity {mapping(address=>uint256) public balanceOf;function set(address a,uint256 n) external {balanceOf[a]=n;}}
// Takes 1% of every transfer: the bounty must refuse tokens that deliver less than requested.
contract TaxToken is ERC20 {constructor() ERC20("Tax","TAX"){} function mint(address a,uint256 n) external {_mint(a,n);} function _update(address f,address t,uint256 v) internal override {if(f!=address(0)&&t!=address(0)){uint256 tax=v/100;super._update(f,address(0),tax);super._update(f,t,v-tax);}else super._update(f,t,v);}}
// A token with a transfer callback that tries to re-enter the bounty contract with arbitrary calldata.
contract HookToken is ERC20 {
 address public target;bytes public data;bool public armed;bool public reentered;bool public reentrySucceeded;
 constructor() ERC20("Hook","HOOK"){}
 function mint(address a,uint256 n) external {_mint(a,n);}
 function arm(address t,bytes calldata d) external {target=t;data=d;armed=true;reentered=false;reentrySucceeded=false;}
 function _update(address f,address t,uint256 v) internal override {super._update(f,t,v);if(armed&&f!=address(0)&&!reentered){reentered=true;(bool ok,)=target.call(data);reentrySucceeded=ok;}}
}
`;
let compiled:any;
export function mockArtifacts(){if(compiled)return compiled;const out=JSON.parse(solc.compile(JSON.stringify({language:'Solidity',sources:{'M.sol':{content:mocks}},settings:{evmVersion:'paris',optimizer:{enabled:true,runs:200},outputSelection:{'*':{'*':['abi','evm.bytecode.object']}}}}),{import:(p:string)=>{try{return {contents:fs.readFileSync('node_modules/'+p,'utf8')};}catch{return {error:'missing '+p};}}}));if(out.errors?.some((e:any)=>e.severity==='error'))throw Error(out.errors.map((e:any)=>e.formattedMessage).join('\n'));return compiled=out.contracts['M.sol'];}
export const bountyArtifact=()=>JSON.parse(fs.readFileSync('artifacts/NibBugBounty.json','utf8'));
export const FEE_BPS=200n,REVIEWER_BPS=2000n,MIN_DEPOSIT=E(10000),MIN_TIER=E(10000);
export const TIERS=[E(10000),E(25000),E(50000),E(100000)],STAKE=1000n,DEPOSIT=E(300000);
export const Status={None:0,Committed:1,Applying:2,Voting:3,Settled:4,Rejected:5,Appealed:6} as const;
export const Outcome={None:0,Valid:1,Invalid:2,Duplicate:3,Inconclusive:4,NoQuorum:5,NoPanel:6,Unrevealed:7} as const;
export const DUP=255;
const providers:any[]=[];export const closeAll=()=>Promise.all(providers.splice(0).map(p=>p.disconnect()));
// wallet indexes: 30 owner (the treasury: decides appeals only), 0 deployer, 1 ticket signer, 2 guardian, 3 fee recipient (the vault), 4 creator, 5 hunter, 6 hunter2, 7 hunter3, 8 creator2, 9..28 reviewers
export const REV0=9,OWNER=30;
export async function setup(opts:{token?:'MockNib'|'TaxToken'|'HookToken';feeBps?:bigint;reviewerBps?:bigint;server?:boolean;pin?:{nib:string;bounty:string;registry?:string}}={}){
 const cfg:any={logging:{quiet:true},chain:{chainId:56,hardfork:'shanghai'},wallet:{totalAccounts:31},miner:{blockGasLimit:30000000}};
 // `server:true` also exposes the chain over HTTP, so lib code that talks to BSC_RPC_URL can be tested against it.
 let rpc='';let provider:any;
 if(opts.server){const server=ganache.server(cfg);await server.listen(0,'127.0.0.1');provider=server.provider;rpc='http://127.0.0.1:'+server.address().port;providers.push({disconnect:()=>server.close()});}
 else{provider=ganache.provider(cfg);providers.push(provider);}
 const accounts=Object.values(provider.getInitialAccounts()).map((a:any)=>privateKeyToAccount(a.secretKey));
 const chain:any={id:56,name:'Local BNB',nativeCurrency:{name:'BNB',symbol:'BNB',decimals:18},rpcUrls:{default:{http:['http://localhost']}}};
 const wallets=accounts.map(account=>createWalletClient({account,chain,transport:custom(provider as any,{retryCount:0})}));const client=createPublicClient({chain,transport:custom(provider as any,{retryCount:0}),pollingInterval:20});
 const m=mockArtifacts(),bb=bountyArtifact();
 const send=async(hash:any)=>{const r=await client.waitForTransactionReceipt({hash});if(r.status!=='success')throw Error('reverted');return r;};
 const deploy=async(a:any,args:any[]=[],who=0)=>(await send(await wallets[who].deployContract({abi:a.abi,bytecode:a.bytecode||'0x'+a.evm.bytecode.object,args} as any))).contractAddress!;
 const w=(address:any,abi:any,fn:string,args:any[]=[],who=0,value=0n)=>wallets[who].writeContract({address,abi,functionName:fn,args,value,gas:6_000_000n} as any).then(send).catch(async(e:any)=>{if(e?.message!=='reverted')throw e;
  // With explicit gas the tx is mined and reverts silently: replay it as a call from the same account to recover the revert reason.
  try{await provider.request({method:'eth_call',params:[{from:accounts[who].address,to:address,data:encodeFunctionData({abi,functionName:fn,args} as any),value:value?toHex(value):undefined},'latest']});}
  catch(s:any){let d=String(s?.message||'');try{if(s?.data)d+=' '+decodeErrorResult({abi:[...abi,...bb.abi.filter((x:any)=>x.type==='error')],data:s.data}).errorName;}catch{d+=' '+String(s.data||'');}e.details=d;}throw e;});
 const r=(address:any,abi:any,fn:string,args:any[]=[])=>client.readContract({address,abi,functionName:fn,args} as any) as Promise<any>;
 const [deployer,signer,guardian,feeTo,creator,hunter,hunter2,hunter3,creator2]=accounts.map(a=>a.address),owner=accounts[OWNER].address;
 // `pin` copies the deployed runtime code to fixed addresses, so code that pins production addresses (the connector) can be tested end to end.
 const putCode=async(from:any,to:string)=>{await provider.request({method:'evm_setAccountCode',params:[to,await client.getCode({address:from})]});return to as any;};
 const nibName=opts.token||'MockNib',nibArt=m[nibName],nib=opts.pin?await putCode(await deploy(nibArt),opts.pin.nib):await deploy(nibArt),registry=opts.pin?.registry?await putCode(await deploy(m.MockIdentity),opts.pin.registry):await deploy(m.MockIdentity);
 const feeBps=opts.feeBps??FEE_BPS,reviewerBps=opts.reviewerBps??REVIEWER_BPS;
 const cargs=[nib,registry,signer,guardian,feeTo,feeBps,reviewerBps,MIN_DEPOSIT,MIN_TIER,owner];
 const bounty=opts.pin?await (async()=>{
  // storage written by the constructor (the rotatable ticket signer) is not part of the code, so it is copied slot by slot
  const real=await deploy(bb,cargs),at=await putCode(real,opts.pin!.bounty);
  for(let slot=0;slot<16;slot++){const v=await provider.request({method:'eth_getStorageAt',params:[real,toHex(slot),'latest']});if(/[1-9a-f]/i.test(String(v).slice(2)))await provider.request({method:'evm_setAccountStorageAt',params:[at,toHex(slot,{size:32}),v]});}
  return at;})():await deploy(bb,cargs);
 const mint=(to:any,n:bigint)=>w(nib,nibArt.abi,'mint',[to,n]);
 const approve=(who:number,n=2n**256n-1n)=>w(nib,nibArt.abi,'approve',[bounty,n],who);
 const bal=(a:any)=>r(nib,nibArt.abi,'balanceOf',[a]) as Promise<bigint>;
 const idy=(a:any,n=1n)=>w(registry,m.MockIdentity.abi,'set',[a,n]);
 for(const i of [4,5,6,7,8]){await idy(accounts[i].address);await mint(accounts[i].address,E(10_000_000));await approve(i);}
 for(let i=REV0;i<OWNER;i++)await idy(accounts[i].address);
 const bw=(fn:string,args:any[]=[],who=0)=>w(bounty,bb.abi,fn,args,who).catch((e:any)=>{if(e.message==='reverted')e.message='reverted: '+fn+' by account '+who;if(e.details)e.message+=' / '+String(e.details).slice(0,200);throw e;}),br=(fn:string,args:any[]=[])=>r(bounty,bb.abi,fn,args);
 const now=async()=>Number((await client.getBlock()).timestamp);
 const warp=async(s:number)=>{await provider.request({method:'evm_increaseTime',params:[s]});await provider.request({method:'evm_mine',params:[]});};
 const mine=async(n=1)=>{for(let i=0;i<n;i++)await provider.request({method:'evm_mine',params:[]});};
 const scopeHash=(s='scope-1')=>keccak256(toHex(s));
 const create=async(o:{who?:number;tiers?:bigint[];days?:number;panel?:number;stake?:bigint;deposit?:bigint;scope?:string}={})=>{
  const endsAt=BigInt(await now()+(o.days??30)*DAY+60);
  await bw('createBounty',[scopeHash(o.scope),o.tiers??TIERS,endsAt,BigInt(o.panel??3),o.stake??STAKE,o.deposit??DEPOSIT],o.who??4);return await br('bountyNonce') as bigint;
 };
 // ---- TAP tickets (what the TapTap server signs once it has locked the points)
 let lockSeq=0;const newLock=()=>keccak256(toHex('lock-'+(++lockSeq)));
 const ticket=async(kind:number,who:string,scopeId:bigint,tap:bigint,o:{lockId?:string;deadline?:number;signerIdx?:number}={})=>{
  const lockId=(o.lockId||newLock()) as any,deadline=BigInt(o.deadline??(await now()+3600));
  const digest=await br('ticketDigest',[kind,who,scopeId,tap,lockId,deadline]);
  const signature=await accounts[o.signerIdx??1].signMessage({message:{raw:digest}});
  return {lockId,deadline,signature,tap};
 };
 const commitHash=(bountyId:bigint,hunterAddr:string,severity:number,reportHash:string,salt:string)=>keccak256(encodeAbiParameters([{type:'uint256'},{type:'address'},{type:'uint256'},{type:'address'},{type:'uint8'},{type:'bytes32'},{type:'bytes32'}],[56n,bounty as any,bountyId,hunterAddr as any,severity,reportHash as any,salt as any]));
 let seq=0;const report=(label?:string)=>{const n=++seq;return {reportHash:keccak256(toHex('report-'+(label||n))),salt:keccak256(toHex('salt-'+n))};};
 const commit=async(bountyId:bigint,who:number,severity=2,rep=report(),tap=STAKE,t?:any)=>{const h=commitHash(bountyId,accounts[who].address,severity,rep.reportHash,rep.salt);const tk=t||await ticket(1,accounts[who].address,bountyId,tap);await bw('commit',[bountyId,h,tk.tap,tk.lockId,tk.deadline,tk.signature],who);const id=await br('submissionNonce') as bigint;return {id,severity,...rep,commitHash:h,who,lockId:tk.lockId as string};};
 const reveal=(s:{id:bigint;severity:number;reportHash:string;salt:string;who:number})=>bw('reveal',[s.id,s.severity,s.reportHash,s.salt],s.who);
 const submit=async(bountyId:bigint,who:number,severity=2,rep=report(),tap=STAKE)=>{const s=await commit(bountyId,who,severity,rep,tap);await reveal(s);return s;};
 const apply=async(submissionId:bigint,who:number,tap=STAKE,t?:any)=>{const tk=t||await ticket(2,accounts[who].address,submissionId,tap);await bw('applyToReview',[submissionId,tk.tap,tk.lockId,tk.deadline,tk.signature],who);return tk.lockId as string;};
 const sub=(id:bigint)=>br('getSubmission',[id]),bnty=(id:bigint)=>br('getBounty',[id]);
 // Apply `n` reviewers (default: twice the panel), close the window, run the draw. Returns the seated and unseated account indexes.
 const seat=async(submissionId:bigint,o:{n?:number;from?:number;panel?:number}={})=>{
  const n=o.n??2*(o.panel??3),from=o.from??REV0,locks:Record<number,string>={};
  for(let i=0;i<n;i++)locks[from+i]=await apply(submissionId,from+i);
  await warp(48*3600+5);await bw('startSelection',[submissionId],0);await mine(2);await bw('selectPanel',[submissionId],0);
  const panel=(await br('panelOf',[submissionId]) as string[]).map(a=>accounts.findIndex(x=>x.address===a));
  const rest=Object.keys(locks).map(Number).filter(i=>!panel.includes(i));
  return {panel,rest,locks};
 };
 const voteSalt=(id:bigint,who:number)=>keccak256(toHex('vote-'+id+'-'+who));
 const voteHash=(id:bigint,who:number,verdict:number,dupOf=0n)=>keccak256(encodeAbiParameters([{type:'uint256'},{type:'address'},{type:'uint256'},{type:'address'},{type:'uint8'},{type:'uint256'},{type:'bytes32'}],[56n,bounty as any,id,accounts[who].address,verdict,dupOf,voteSalt(id,who)]));
 const castVote=(id:bigint,who:number,verdict:number,dupOf=0n)=>bw('commitVote',[id,voteHash(id,who,verdict,dupOf)],who);
 const openVote=(id:bigint,who:number,verdict:number,dupOf=0n)=>bw('revealVote',[id,verdict,dupOf,voteSalt(id,who)],who);
 // Panel votes: `votes` is one verdict per seated reviewer (in panel order); null = never votes.
 const judge=async(id:bigint,panel:number[],votes:(number|null)[],dupOf=0n)=>{
  for(let i=0;i<panel.length;i++)if(votes[i]!==null)await castVote(id,panel[i],votes[i]!,votes[i]===DUP?dupOf:0n);
  if(votes.some(v=>v===null))await warp(72*3600+5); // with every vote in, opening starts at once (and a long wait would pass the reveal window)
  for(let i=0;i<panel.length;i++)if(votes[i]!==null)await openVote(id,panel[i],votes[i]!,votes[i]===DUP?dupOf:0n);
  if(votes.some(v=>v===null))await warp(48*3600+5);
  else {}
  await bw('finalizeJudgment',[id],0);
 };
 const settleValid=async(bountyId:bigint,hunterIdx:number,severity=2,votes?:(number|null)[])=>{const s=await submit(bountyId,hunterIdx,severity);const seated=await seat(s.id);await judge(s.id,seated.panel,votes??seated.panel.map(()=>severity));return {s,...seated};};
 // A rejected (invalid / duplicate) report is provisional: once the appeal window passes unused anyone closes it.
 const closeRejection=async(id:bigint)=>{await warp(3*DAY+5);await bw('resolveRejection',[id,0],0);};
 const solvent=async(label='')=>{const [held,escrow,owed]=await Promise.all([bal(bounty),br('totalEscrow'),br('totalOwed')]);if(held!==escrow+owed)throw Error(`INSOLVENT ${label}: balance ${held} != escrow ${escrow} + owed ${owed}`);};
 const rejects=async(p:Promise<any>,re?:RegExp)=>{try{await p;}catch(e:any){if(re&&!re.test(String(e?.shortMessage||'')+String(e?.details||'')+String(e?.message||'')))throw Error('Reverted with a different reason than expected '+re+': '+String(e?.details||e?.shortMessage||e?.message).slice(0,300));return;}throw Error('Expected a revert'+(re?' matching '+re:''));};
 const keys=Object.values(provider.getInitialAccounts()).map((a:any)=>a.secretKey as string);
 return {provider,rpc,keys,voteSalt,client,accounts,wallets,m,bb,deployer,signer,guardian,owner,feeTo,creator,hunter,hunter2,hunter3,creator2,nib,nibArt,registry,bounty,deploy,w,r,bw,br,mint,approve,bal,idy,now,warp,mine,scopeHash,create,ticket,commitHash,report,commit,reveal,submit,apply,seat,voteHash,castVote,openVote,judge,settleValid,closeRejection,sub,bnty,solvent,rejects,zeroAddress,bountyArt:bb};
}
