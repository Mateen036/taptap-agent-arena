import {parseAbi,encodeFunctionData,isAddress,parseUnits} from 'viem';
export const NFT_PAYMENT='0x55d398326f99059fF775485246999027B3197955' as const;
export const NFT_PRICE_FEED='0x0567F2323251f0Aab15c8dFb1967E4e8A7D42aeE' as const;
export const NFT_WBNB='0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c' as const;
export const NFT_BUYER_FEE_BPS=200;
export const NFT_SELLER_FEE_BPS=200;
export function marketQuote(price:bigint){const buyerFee=price*BigInt(NFT_BUYER_FEE_BPS)/10000n,sellerFee=price*BigInt(NFT_SELLER_FEE_BPS)/10000n;return {buyerFee,sellerFee,buyerTotal:price+buyerFee,sellerProceeds:price-sellerFee};}
export const NFT_NATIVE='0x0000000000000000000000000000000000000000' as const;
export const nativeMintBudget=(quote:bigint)=>(quote*101n+99n)/100n; // 1% ceiling; unused BNB is refunded by the mint.
export const NFT_ROUTER='0x10ED43C718714eb63d5aA57B78B54704E256024E' as const;
export const nftAbi=parseAbi([
 'function MAX_SUPPLY() view returns(uint256)','function WALLET_LIMIT() view returns(uint256)',
 'function priceFeed() view returns(address)','function mintPriceBNB() view returns(uint256)','function mintCostBNB(address,uint256) view returns(uint256)',
 'function minted() view returns(uint256)','function mintedBy(address) view returns(uint256)','function mintPrice() view returns(uint256)',
 'function paymentToken() view returns(address)','function lpVault() view returns(address)','function renderer() view returns(address)','function agentIdRegistry() view returns(address)',
 'function mintOpen() view returns(bool)','function paused() view returns(bool)','function balanceOf(address) view returns(uint256)',
 'function tokenOfOwnerByIndex(address,uint256) view returns(uint256)','function ownerOf(uint256) view returns(address)','function getApproved(uint256) view returns(address)',
 'function mintBNB(uint256,uint256,uint256,bytes32) payable','function approve(address,uint256)','function mint(uint256,uint256,uint256,bytes32)','function tokenURI(uint256) view returns(string)'
]);
export const nftMarketAbi=parseAbi([
 'function collection() view returns(address)','function paymentToken() view returns(address)','function agentIdRegistry() view returns(address)',
 'function activeCount() view returns(uint256)','function activeAt(uint256) view returns(uint256)','function listings(uint256) view returns(uint256 id,address seller,uint256 price,uint256 expiresAt)',
 'function available(uint256) view returns(bool)','function completedSales() view returns(uint256)','function volume() view returns(uint256)',
 'function BUYER_FEE_BPS() view returns(uint256)','function SELLER_FEE_BPS() view returns(uint256)','function feeRecipient() view returns(address)','function feesCollected() view returns(uint256)',
 'function quote(uint256) pure returns(uint256 buyerFee,uint256 sellerFee,uint256 buyerTotal,uint256 sellerProceeds)',
 'function bidCount() view returns(uint256)','function bidAt(uint256) view returns(uint256)',
 'function bidderBidCount(address) view returns(uint256)','function bidderBidAt(address,uint256) view returns(uint256)',
 'function sellerBidCount(address) view returns(uint256)','function sellerBidAt(address,uint256) view returns(uint256)',
 'function bids(uint256) view returns(uint256 tokenId,address bidder,address seller,uint256 price,uint256 expiresAt)',
 'function bidderTokenBid(address,uint256) view returns(uint256)','function bidAvailable(uint256) view returns(bool)','function refunds(address) view returns(uint256)',
 'function escrowedBNB() view returns(uint256)','function totalRefunds() view returns(uint256)',
 'function placeBid(uint256,uint256,uint256,address) payable','function cancelBid(uint256)','function acceptBid(uint256,address,uint256,uint256)','function withdrawRefund(uint256,address)',
 'function list(uint256,uint256,uint256)','function cancel(uint256,uint256)','function buy(uint256,uint256,uint256,address,uint256) payable'
]);
export const nftPaymentAbi=parseAbi(['function balanceOf(address) view returns(uint256)','function allowance(address,address) view returns(uint256)','function approve(address,uint256)','function decimals() view returns(uint8)','function symbol() view returns(string)']);
export const nftVaultAbi=parseAbi(['function wrappedNative() view returns(address)','function bnbAdded() view returns(uint256)','function lpTokensLockedBNB() view returns(uint256)','function paymentToken() view returns(address)','function liquidityToken() view returns(address)','function pendingToken() view returns(address)','function tokenReadyAt() view returns(uint256)','function paymentAdded() view returns(uint256)','function lpTokensLocked() view returns(uint256)','function router() view returns(address)']);
export const nftConfigAbi=parseAbi(['function owner() view returns(address)']);
export type NftAddresses={collection:`0x${string}`;market:`0x${string}`;vault:`0x${string}`};
export type NftTransaction={chainId:56;from:`0x${string}`;to:`0x${string}`;value:string;data:`0x${string}`};
export function nftConfig(env:{NFT_COLLECTION?:string;NFT_MARKETPLACE?:string;NFT_LP_VAULT?:string}):NftAddresses|null{
 const {NFT_COLLECTION:c,NFT_MARKETPLACE:m,NFT_LP_VAULT:v}=env;
 if(!c&&!m&&!v)return null;if(![c,m,v].every(x=>typeof x==='string'&&isAddress(x)))throw Error('NFT contract configuration is incomplete.');
 return {collection:c as `0x${string}`,market:m as `0x${string}`,vault:v as `0x${string}`};
}
export function nftTokenId(value:any){const n=Number(value);if(!Number.isSafeInteger(n)||n<1||n>10000)throw Error('Choose an NFT from 1 to 10,000.');return n;}
export function nftPrice(value:any){if(typeof value!=='string'||!/^\d{1,7}(\.\d{1,18})?$/.test(value))throw Error('Enter a decimal BNB price with up to 18 decimal places.');const price=parseUnits(value,18);if(price<=0n||price>parseUnits('1000000',18))throw Error('Price must be above zero and at most 1,000,000 BNB.');return price;}
export function nftCall(from:`0x${string}`,to:`0x${string}`,abi:any,functionName:string,args:any[],value=0n):NftTransaction{return {chainId:56,from,to,value:value.toString(),data:encodeFunctionData({abi,functionName,args} as any)};}
