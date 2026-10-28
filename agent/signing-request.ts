import {getTypesForEIP712Domain,serializeTypedData,validateTypedData} from 'viem';
import type {Address,TypedDataDomain,TypedDataParameter} from 'viem';

type MessageData={domain:TypedDataDomain;types:Record<string,readonly TypedDataParameter[]>;primaryType:string;message:Record<string,unknown>};

// Raw JSON-RPC callers must include the domain schema that wallet clients
// normally add before sending eth_signTypedData_v4 to a signer.
export function sessionSigningRequest(wallet:Address,data:MessageData){
 const typedData:MessageData={...data,types:{...data.types,EIP712Domain:getTypesForEIP712Domain({domain:data.domain})}};
 validateTypedData(typedData);
 return JSON.stringify({method:'eth_signTypedData_v4',params:[wallet,serializeTypedData(typedData)]});
}
