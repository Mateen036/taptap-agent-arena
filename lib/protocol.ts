import {keccak256,toHex} from 'viem';
import {canonical} from './game';
export const CHAIN_ID=56;
export const AGENT_ID_REGISTRY='0x60B9262456dE011F7d15a54CdD8c48bAaa8B022F' as const;
// Keep the domain to the fields supported by Binance Agentic Wallet. Bind the
// deployment origin inside each signed message instead of using domain.salt.
export function domain(){return {name:'TapTap Agent Arena',version:'2',chainId:CHAIN_ID};}
export function sessionData(origin:string,c:any){return {domain:domain(),types:{AgentSession:[{name:'origin',type:'string'},{name:'challengeId',type:'string'},{name:'sessionKey',type:'address'},{name:'expiresAt',type:'uint256'},{name:'purpose',type:'string'}]},primaryType:'AgentSession' as const,message:{origin,challengeId:c.id,sessionKey:c.session_key,expiresAt:BigInt(c.expires_at),purpose:'Authorize game commands only. No token transfers, approvals, or spending authority.'}};}
export function actionData(origin:string,a:any){return {domain:domain(),types:{AgentAction:[{name:'origin',type:'string'},{name:'sessionId',type:'string'},{name:'nonce',type:'uint256'},{name:'timestamp',type:'uint256'},{name:'action',type:'string'},{name:'payloadHash',type:'bytes32'}]},primaryType:'AgentAction' as const,message:{origin,sessionId:a.sessionId,nonce:BigInt(a.nonce),timestamp:BigInt(a.timestamp),action:a.action,payloadHash:keccak256(toHex(canonical(a.payload)))}};}
