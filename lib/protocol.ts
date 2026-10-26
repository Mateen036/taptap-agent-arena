import {keccak256,toHex} from 'viem';
import {canonical} from './game';
export const CHAIN_ID=56;
export const AGENT_ID_REGISTRY='0x60B9262456dE011F7d15a54CdD8c48bAaa8B022F' as const;
export function domain(origin:string){return {name:'TapTap Agent Arena',version:'1',chainId:56,salt:keccak256(toHex(origin))};}
export function sessionData(origin:string,c:any){return {domain:domain(origin),types:{AgentSession:[{name:'challengeId',type:'string'},{name:'sessionKey',type:'address'},{name:'expiresAt',type:'uint256'},{name:'purpose',type:'string'}]},primaryType:'AgentSession' as const,message:{challengeId:c.id,sessionKey:c.session_key,expiresAt:BigInt(c.expires_at),purpose:'Authorize game commands only. No token transfers, approvals, or spending authority.'}};}
export function actionData(origin:string,a:any){return {domain:domain(origin),types:{AgentAction:[{name:'sessionId',type:'string'},{name:'nonce',type:'uint256'},{name:'timestamp',type:'uint256'},{name:'action',type:'string'},{name:'payloadHash',type:'bytes32'}]},primaryType:'AgentAction' as const,message:{sessionId:a.sessionId,nonce:BigInt(a.nonce),timestamp:BigInt(a.timestamp),action:a.action,payloadHash:keccak256(toHex(canonical(a.payload)))}};}
