// Local ganache fixture for NibBugBounty: mock NIB, mock Agent ID registry, the real contract artifact, and typed helpers.
import fs from 'node:fs';import solc from 'solc';import ganache from 'ganache';
import {createWalletClient,createPublicClient,custom,parseEther,keccak256,encodeAbiParameters,toHex,zeroAddress} from 'viem';import {privateKeyToAccount} from 'viem/accounts';
export const E=(n:number|string)=>parseEther(String(n));
export const DAY=86400;
const mocks=`// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
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
export const FEE_BPS=200n,MIN_DEPOSIT=E(50000),MIN_TIER=E(10000);
export const TIERS=[E(10000),E(25000),E(50000),E(100000)],STAKE=E(500),DEPOSIT=E(300000);
export const Status={None:0,Committed:1,Revealed:2,Decided:3,Disputed:4,Settled:5,Expired:6} as const;
export const Reason={None:0,Duplicate:1,NotAVulnerability:2,OutOfScope:3,NotReproducible:4} as const;
const providers:any[]=[];export const closeAll=()=>Promise.all(providers.splice(0).map(p=>p.disconnect()));
export async function setup(opts:{token?:'MockNib'|'TaxToken'|'HookToken';feeBps?:bigint;server?:boolean}={}){
 const cfg:any={logging:{quiet:true},chain:{chainId:56,hardfork:'shanghai'},wallet:{totalAccounts:14},miner:{blockGasLimit:30000000}};
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
 const w=(address:any,abi:any,fn:string,args:any[]=[],who=0,value=0n)=>wallets[who].writeContract({address,abi,functionName:fn,args,value,gas:5_000_000n} as any).then(send);
 const r=(address:any,abi:any,fn:string,args:any[]=[])=>client.readContract({address,abi,functionName:fn,args} as any) as Promise<any>;
 const [deployer,arbiter,feeTo,creator,hunter,hunter2,hunter3,creator2]=accounts.map(a=>a.address);
 const nibName=opts.token||'MockNib',nibArt=m[nibName],nib=await deploy(nibArt),registry=await deploy(m.MockIdentity);
 const feeBps=opts.feeBps??FEE_BPS;
 const bounty=await deploy(bb,[nib,registry,arbiter,feeTo,feeBps,MIN_DEPOSIT,MIN_TIER]);
 const mint=(to:any,n:bigint)=>w(nib,nibArt.abi,'mint',[to,n]);
 const approve=(who:number,n=2n**256n-1n)=>w(nib,nibArt.abi,'approve',[bounty,n],who);
 const bal=(a:any)=>r(nib,nibArt.abi,'balanceOf',[a]) as Promise<bigint>;
 const idy=(a:any,n=1n)=>w(registry,m.MockIdentity.abi,'set',[a,n]);
 // wallet indexes: 0 deployer, 1 arbiter, 2 feeTo, 3 creator, 4 hunter, 5 hunter2, 6 hunter3, 7 creator2
 await idy(accounts[1].address);for(const i of [3,4,5,6,7]){await idy(accounts[i].address);await mint(accounts[i].address,E(10_000_000));await approve(i);}
const bw=(fn:string,args:any[]=[],who=0)=>w(bounty,bb.abi,fn,args,who).catch((e:any)=>{if(e.message==='reverted')e.message='reverted: '+fn+' by account '+who;if(e.details)e.message+=' / '+String(e.details).slice(0,200);throw e;}),br=(fn:string,args:any[]=[])=>r(bounty,bb.abi,fn,args);
 const now=async()=>Number((await client.getBlock()).timestamp);
 const warp=async(s:number)=>{await provider.request({method:'evm_increaseTime',params:[s]});await provider.request({method:'evm_mine',params:[]});};
 const scopeHash=(s='scope-1')=>keccak256(toHex(s));
 const create=async(o:{who?:number;tiers?:bigint[];days?:number;review?:number;stake?:bigint;deposit?:bigint;scope?:string}={})=>{
  const endsAt=BigInt(await now()+(o.days??30)*DAY+60);
  await bw('createBounty',[scopeHash(o.scope),o.tiers??TIERS,endsAt,BigInt((o.review??7)*DAY),o.stake??STAKE,o.deposit??DEPOSIT],o.who??3);return await br('bountyNonce') as bigint;
 };
 const commitHash=(bountyId:bigint,hunterAddr:string,severity:number,reportHash:string,salt:string)=>keccak256(encodeAbiParameters([{type:'uint256'},{type:'address'},{type:'uint256'},{type:'address'},{type:'uint8'},{type:'bytes32'},{type:'bytes32'}],[56n,bounty as any,bountyId,hunterAddr as any,severity,reportHash as any,salt as any]));
 let seq=0;const report=(label?:string)=>{const n=++seq;return {reportHash:keccak256(toHex('report-'+(label||n))),salt:keccak256(toHex('salt-'+n))};};
 const commit=async(bountyId:bigint,who:number,severity=2,rep=report())=>{const h=commitHash(bountyId,accounts[who].address,severity,rep.reportHash,rep.salt);await bw('commit',[bountyId,h],who);const id=await br('submissionNonce') as bigint;return {id,severity,...rep,commitHash:h,who};};
 const reveal=(s:{id:bigint;severity:number;reportHash:string;salt:string;who:number})=>bw('reveal',[s.id,s.severity,s.reportHash,s.salt],s.who);
 const submit=async(bountyId:bigint,who:number,severity=2,rep=report())=>{const s=await commit(bountyId,who,severity,rep);await reveal(s);return s;};
 const sub=(id:bigint)=>br('getSubmission',[id]),bnty=(id:bigint)=>br('getBounty',[id]);
 const solvent=async(label='')=>{const [held,escrow,stakes]=await Promise.all([bal(bounty),br('totalEscrow'),br('totalStakes')]);if(held!==escrow+stakes)throw Error(`INSOLVENT ${label}: balance ${held} != escrow ${escrow} + stakes ${stakes}`);};
 const rejects=async(p:Promise<any>,re?:RegExp)=>{try{await p;}catch(e:any){if(re&&!re.test(String(e?.shortMessage||'')+String(e?.details||'')+String(e?.message||'')))throw Error('Reverted with a different reason than expected '+re+': '+String(e?.details||e?.shortMessage||e?.message).slice(0,300));return;}throw Error('Expected a revert'+(re?' matching '+re:''));};
 return {provider,rpc,client,accounts,wallets,m,bb,deployer,arbiter,feeTo,creator,hunter,hunter2,hunter3,creator2,nib,nibArt,registry,bounty,deploy,w,r,bw,br,mint,approve,bal,idy,now,warp,scopeHash,create,commitHash,report,commit,reveal,submit,sub,bnty,solvent,rejects,zeroAddress,bountyArt:bb};
}
