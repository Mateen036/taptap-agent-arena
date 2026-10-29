import ganache from 'ganache';import fs from 'node:fs';import solc from 'solc';
import {createWalletClient,createPublicClient,http,parseEther,keccak256,toHex} from 'viem';import {privateKeyToAccount} from 'viem/accounts';
import {AGENT_ID_REGISTRY} from '../../lib/protocol';import {NFT_PAYMENT,NFT_ROUTER} from '../../lib/nft-protocol';
const mocks=`// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
contract MockToken is ERC20 {constructor() ERC20("Fixture USD","FUSD"){} function mint(address a,uint256 n) external {_mint(a,n);}}
contract MockIdentity {mapping(address=>uint256) public balanceOf;function set(address a,uint256 n) external {balanceOf[a]=n;}}
contract MockFactory {address public pair;constructor(address p){pair=p;}function getPair(address,address) external view returns(address){return pair;}}
contract MockRouter {address public immutable factory;address public immutable pair;constructor(address f,address p){factory=f;pair=p;}function addLiquidity(address a,address b,uint256 x,uint256 y,uint256 xmin,uint256 ymin,address to,uint256 deadline) external returns(uint256,uint256,uint256){require(block.timestamp<=deadline&&x>=xmin&&y>=ymin);IERC20(a).transferFrom(msg.sender,address(this),x);IERC20(b).transferFrom(msg.sender,address(this),y);MockToken(pair).mint(to,x);return(x,y,x);}}
contract MockCreate2 {fallback(bytes calldata data) external returns(bytes memory){bytes32 salt=bytes32(data[:32]);bytes memory init=data[32:];address created;assembly {created:=create2(0,add(init,32),mload(init),salt)}require(created!=address(0),"CREATE2 failed");return abi.encodePacked(created);}}
contract MockMulticall {struct Call {address target;bool allowFailure;bytes callData;}struct Result {bool success;bytes returnData;}function aggregate3(Call[] calldata calls) external payable returns(Result[] memory results){results=new Result[](calls.length);for(uint256 i;i<calls.length;i++){(bool success,bytes memory data)=calls[i].target.call(calls[i].callData);require(success||calls[i].allowFailure,"Bundle reverted");results[i]=Result(success,data);}}}
`;
let mockArtifacts:any;
function artifacts(){if(mockArtifacts)return mockArtifacts;const out=JSON.parse(solc.compile(JSON.stringify({language:'Solidity',sources:{'MockNFT.sol':{content:mocks}},settings:{evmVersion:'paris',optimizer:{enabled:true,runs:200},outputSelection:{'*':{'*':['abi','evm.bytecode.object']}}}}),{import:(p:string)=>({contents:fs.readFileSync('node_modules/'+p,'utf8')})}));if(out.errors?.some((e:any)=>e.severity==='error'))throw Error(out.errors.map((e:any)=>e.formattedMessage).join('\n'));return mockArtifacts=out.contracts['MockNFT.sol'];}
export async function nftChain(){
 const server=ganache.server({logging:{quiet:true},chain:{chainId:56,hardfork:'shanghai'},wallet:{totalAccounts:16},miner:{blockGasLimit:30000000}});await server.listen(0,'127.0.0.1');
 const rpc='http://127.0.0.1:'+(server.address() as any).port,chain:any={id:56,name:'Local BNB fixture',nativeCurrency:{name:'BNB',symbol:'BNB',decimals:18},rpcUrls:{default:{http:[rpc]}}};
 const accounts=Object.values(server.provider.getInitialAccounts()).map((a:any)=>privateKeyToAccount(a.secretKey));const wallets=accounts.map(account=>createWalletClient({account,chain,transport:http(rpc)}));const client=createPublicClient({chain,transport:http(rpc)}),m=artifacts();
 const art=(name:string)=>JSON.parse(fs.readFileSync('artifacts/'+name+'.json','utf8'));
 async function deploy(a:any,args:any[]=[]){const hash=await wallets[0].deployContract({account:accounts[0],chain,abi:a.abi,bytecode:a.bytecode||'0x'+a.evm.bytecode.object,args} as any);const r=await client.waitForTransactionReceipt({hash});if(r.status!=='success'||!r.contractAddress)throw Error('Fixture deployment reverted');return r.contractAddress;}
 async function write(address:any,abi:any,functionName:string,args:any[]=[],who=0){const hash=await wallets[who].writeContract({address,abi,functionName,args} as any);const r=await client.waitForTransactionReceipt({hash});if(r.status!=='success')throw Error('Transaction reverted');return hash;}
 const read=(address:any,abi:any,functionName:string,args:any[]=[])=>client.readContract({address,abi,functionName,args} as any) as Promise<any>;
 const identitySource=await deploy(m.MockIdentity),paymentSource=await deploy(m.MockToken),lpPair=await deploy(m.MockToken),factory=await deploy(m.MockFactory,[lpPair]),routerSource=await deploy(m.MockRouter,[factory,lpPair]);
 for(const [target,source]of [[AGENT_ID_REGISTRY,identitySource],[NFT_PAYMENT,paymentSource],[NFT_ROUTER,routerSource]])await server.provider.request({method:'evm_setAccountCode',params:[target,(await client.getCode({address:source}))!]});
 for(let i=0;i<accounts.length-1;i++){await write(AGENT_ID_REGISTRY,m.MockIdentity.abi,'set',[accounts[i].address,1n]);await write(NFT_PAYMENT,m.MockToken.abi,'mint',[accounts[i].address,parseEther('1000')]);}
 const owner=accounts[0].address,renderer=await deploy(art('NibRenderer')),vault=await deploy(art('NibLPVault'),[NFT_PAYMENT,NFT_ROUTER,owner]),collection=await deploy(art('NibFoundry'),[AGENT_ID_REGISTRY,NFT_PAYMENT,vault,renderer,owner]),market=await deploy(art('NibMarketplace'),[collection,NFT_PAYMENT,AGENT_ID_REGISTRY]);await write(collection,art('NibFoundry').abi,'setMintOpen',[true]);
 let seq=0;const intent=()=>keccak256(toHex('fixture-intent-'+(++seq)));
 return {server,provider:server.provider,rpc,accounts,wallets,client,owner,renderer,vault,collection,market,art,m,lpPair,read,write,deploy,intent,deadline:async()=>BigInt((await client.getBlock()).timestamp)+1200n,async close(){await server.close();}};
}
