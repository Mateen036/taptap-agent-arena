import {parseAbi,encodeFunctionData,isAddress,parseUnits} from 'viem';
export const NFT_PAYMENT='0x55d398326f99059fF775485246999027B3197955' as const;
export const NFT_ROUTER='0x10ED43C718714eb63d5aA57B78B54704E256024E' as const;
export const nftAbi=parseAbi([
 'function MAX_SUPPLY() view returns(uint256)','function WALLET_LIMIT() view returns(uint256)',
 'function minted() view returns(uint256)','function mintedBy(address) view returns(uint256)','function mintPrice() view returns(uint256)',
 'function paymentToken() view returns(address)','function lpVault() view returns(address)','function renderer() view returns(address)','function agentIdRegistry() view returns(address)',
 'function mintOpen() view returns(bool)','function paused() view returns(bool)','function balanceOf(address) view returns(uint256)',
 'function tokenOfOwnerByIndex(address,uint256) view returns(uint256)','function ownerOf(uint256) view returns(address)','function getApproved(uint256) view returns(address)',
 'function approve(address,uint256)','function mint(uint256,uint256,uint256,bytes32)','function tokenURI(uint256) view returns(string)'
]);
export const nftMarketAbi=parseAbi([
 'function collection() view returns(address)','function paymentToken() view returns(address)','function agentIdRegistry() view returns(address)',
 'function activeCount() view returns(uint256)','function activeAt(uint256) view returns(uint256)','function listings(uint256) view returns(uint256 id,address seller,uint256 price,uint256 expiresAt)',
 'function available(uint256) view returns(bool)','function completedSales() view returns(uint256)','function volume() view returns(uint256)',
 'function list(uint256,uint256,uint256)','function cancel(uint256,uint256)','function buy(uint256,uint256,uint256,address,uint256)'
]);
export const nftPaymentAbi=parseAbi(['function balanceOf(address) view returns(uint256)','function allowance(address,address) view returns(uint256)','function approve(address,uint256)','function decimals() view returns(uint8)','function symbol() view returns(string)']);
export const nftVaultAbi=parseAbi(['function paymentToken() view returns(address)','function liquidityToken() view returns(address)','function pendingToken() view returns(address)','function tokenReadyAt() view returns(uint256)','function paymentAdded() view returns(uint256)','function lpTokensLocked() view returns(uint256)','function router() view returns(address)']);
export const nftConfigAbi=parseAbi(['function owner() view returns(address)']);
export type NftAddresses={collection:`0x${string}`;market:`0x${string}`;vault:`0x${string}`};
export type NftTransaction={chainId:56;from:`0x${string}`;to:`0x${string}`;value:'0';data:`0x${string}`};
export function nftConfig(env:{NFT_COLLECTION?:string;NFT_MARKETPLACE?:string;NFT_LP_VAULT?:string}):NftAddresses|null{
 const {NFT_COLLECTION:c,NFT_MARKETPLACE:m,NFT_LP_VAULT:v}=env;
 if(!c&&!m&&!v)return null;if(![c,m,v].every(x=>typeof x==='string'&&isAddress(x)))throw Error('NFT contract configuration is incomplete.');
 return {collection:c as `0x${string}`,market:m as `0x${string}`,vault:v as `0x${string}`};
}
export function nftTokenId(value:any){const n=Number(value);if(!Number.isSafeInteger(n)||n<1||n>10000)throw Error('Choose an NFT from 1 to 10,000.');return n;}
export function nftPrice(value:any){if(typeof value!=='string'||!/^\d{1,7}(\.\d{1,6})?$/.test(value))throw Error('Enter a USDT price with up to six decimal places.');const price=parseUnits(value,18);if(price<=0n||price>parseUnits('1000000',18))throw Error('Price must be above zero and at most 1,000,000 USDT.');return price;}
export function nftCall(from:`0x${string}`,to:`0x${string}`,abi:any,functionName:string,args:any[]):NftTransaction{return {chainId:56,from,to,value:'0',data:encodeFunctionData({abi,functionName,args} as any)};}
