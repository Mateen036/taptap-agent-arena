import {nftGameHolding,NftError,type NftEnv} from './nft';
import {nftMultiplier} from './points';
export const UTILITY_SETTING='nft_utility_v2';
export const SEASON_PHASE='season_phase_v3';
export type UtilityPolicy={active:boolean;version:2;formula:'5*owned';scope:'earned_tap_only'};
export type UtilityEnv=NftEnv&{NFT_GAME_UTILITY?:string;_utilityPolicy?:UtilityPolicy};
export async function utilityPolicy(e:UtilityEnv):Promise<UtilityPolicy>{
 if(e._utilityPolicy)return e._utilityPolicy;
 const row=await e.DB.prepare('SELECT value FROM game_settings WHERE key=?').bind(UTILITY_SETTING).first<{value:string}>();
 return {active:row?.value==='active'||e.NFT_GAME_UTILITY==='true',version:2,formula:'5*owned',scope:'earned_tap_only'};
}
export async function gameAccess(e:UtilityEnv,wallet:string|null){
 const policy=await utilityPolicy(e),base={required:policy.active,formula:policy.formula,scope:policy.scope,collection:e.NFT_COLLECTION||null};
 if(!policy.active)return {...base,canPlay:true,status:'not_active',owned:0,multiplier:'1',checkedAt:null,block:null};
 if(!wallet)return {...base,canPlay:false,status:'connect_agent',owned:0,multiplier:'0',checkedAt:null,block:null};
 const holding=await nftGameHolding(e,wallet);
 return {...base,canPlay:holding.identityEligible&&holding.owned>0,identityEligible:holding.identityEligible,status:!holding.identityEligible?'identity_required':holding.owned>0?'unlocked':'nft_required',owned:holding.owned,multiplier:nftMultiplier(holding.owned).toString(),checkedAt:Date.now(),block:holding.block};
}
export async function gameAccessSnapshot(e:UtilityEnv,wallet:string|null){try{return await gameAccess(e,wallet);}catch{return {required:(await utilityPolicy(e)).active,canPlay:false,status:'unavailable',owned:null,multiplier:null,checkedAt:null,block:null,formula:'5*owned',scope:'earned_tap_only',collection:e.NFT_COLLECTION||null};}}
export async function requireGameAccess(e:UtilityEnv,a:any){
 const access=await gameAccess(e,a.wallet);if(access.required&&access.status==='identity_required')throw new NftError(403,'AGENT_ID_REQUIRED: This wallet must currently hold a Binance Agent ID to play.');if(access.required&&!access.canPlay)throw new NftError(403,'NFT_REQUIRED: Hold at least one Nib NFT to play. Your agent can still mint, buy, and manage NFTs.');a._gameAccess=access;return access;
}
