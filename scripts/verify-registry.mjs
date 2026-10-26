import {createPublicClient,http,parseAbi,keccak256} from 'viem';
const address='0x60B9262456dE011F7d15a54CdD8c48bAaa8B022F';const c=createPublicClient({transport:http('https://bsc-dataseed.bnbchain.org')});
const chainId=await c.getChainId();if(chainId!==56)throw Error('Wrong chain');const code=await c.getCode({address});if(!code||code==='0x')throw Error('No code');
const abi=parseAbi(['function name() view returns(string)','function symbol() view returns(string)','function balanceOf(address) view returns(uint256)']);
console.log(JSON.stringify({chainId,address,codeHash:keccak256(code),name:await c.readContract({address,abi,functionName:'name'}),symbol:await c.readContract({address,abi,functionName:'symbol'}),block:String(await c.getBlockNumber())},null,2));
