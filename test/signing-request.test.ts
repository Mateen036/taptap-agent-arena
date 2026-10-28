import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createWalletClient,custom,hashTypedData,verifyTypedData} from 'viem';
import {generatePrivateKey,privateKeyToAccount} from 'viem/accounts';
import {sessionData} from '../lib/protocol';
import {sessionSigningRequest} from '../agent/signing-request';

test('Binance signing request matches a standard wallet client and preserves the session digest',async()=>{
 const wallet=privateKeyToAccount(generatePrivateKey());
 const key=privateKeyToAccount(generatePrivateKey());
 const data=sessionData('https://game.test',{id:'challenge-test',session_key:key.address,expires_at:1800003600000});
 const request=JSON.parse(sessionSigningRequest(wallet.address,data));
 const wire=JSON.parse(request.params[1]);
 assert.deepEqual(wire.types.EIP712Domain,[{name:'name',type:'string'},{name:'version',type:'string'},{name:'chainId',type:'uint256'}]);
 assert.deepEqual(wire.domain,data.domain);
 assert.equal(wire.message.expiresAt,'1800003600000');
 assert.equal(wire.message.origin,'https://game.test');
 let standard:any;
 const client=createWalletClient({account:wallet.address,transport:custom({async request(args){standard=args;return '0x'+'00'.repeat(65);}})});
 await client.signTypedData(data);
 assert.equal(request.method,standard.method);
 assert.equal(request.params[0],standard.params[0]);
 assert.deepEqual(wire,JSON.parse(standard.params[1]));
 assert.equal(hashTypedData(wire),hashTypedData(data));
 const signature=await wallet.signTypedData(wire);
 assert.equal(await verifyTypedData({address:wallet.address,...data,signature}),true);
 assert.equal(await verifyTypedData({address:wallet.address,...data,message:{...data.message,origin:'https://other.test'},signature}),false);
});
