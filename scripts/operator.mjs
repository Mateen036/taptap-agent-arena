import fs from 'node:fs';import {keccak256,toHex} from 'viem';
const [mode,action,file]=process.argv.slice(2),site=process.env.TAPTAP_SITE;if(!site)throw Error('Set TAPTAP_SITE.');const origin=new URL(site).origin;
const canonical=v=>v===null||typeof v!=='object'?JSON.stringify(v):Array.isArray(v)?'['+v.map(canonical).join(',')+']':'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}';
if(mode==='prepare'){
 if(!['freeze','snapshot','publish-rewards'].includes(action))throw Error('Choose freeze, snapshot, or publish-rewards.');
 const payload=file?JSON.parse(fs.readFileSync(file,'utf8')):{};const body={requestId:crypto.randomUUID(),timestamp:Date.now(),payload};
 const typedData={domain:{name:'TapTap Agent Arena',version:'1',chainId:56,salt:keccak256(toHex(origin))},types:{AdminAction:[{name:'requestId',type:'string'},{name:'timestamp',type:'uint256'},{name:'action',type:'string'},{name:'payloadHash',type:'bytes32'}]},primaryType:'AdminAction',message:{requestId:body.requestId,timestamp:String(body.timestamp),action:'/admin/'+action,payloadHash:keccak256(toHex(canonical(payload)))}};
 console.log(JSON.stringify({endpoint:'/api/admin/'+action,body,typedData,instructions:'Sign this exact EIP-712 payload with the configured operator wallet. Add the 65-byte 0x signature to body.signature, then submit within 60 seconds.'},null,2));
}else if(mode==='submit'){
 const signed=JSON.parse(fs.readFileSync(action,'utf8'));if(!['/api/admin/freeze','/api/admin/snapshot','/api/admin/publish-rewards'].includes(signed.endpoint))throw Error('Invalid endpoint');
 const response=await fetch(origin+signed.endpoint,{method:'POST',headers:{'Content-Type':'application/json',...(process.env.TAPTAP_SITE_ACCESS_TOKEN?{'OAI-Sites-Authorization':'Bearer '+process.env.TAPTAP_SITE_ACCESS_TOKEN}:{})},body:JSON.stringify(signed.body)});const text=await response.text();if(!response.ok)throw Error(text);console.log(text);
}else console.log('prepare freeze | prepare snapshot | prepare publish-rewards payload.json | submit signed-request.json');
