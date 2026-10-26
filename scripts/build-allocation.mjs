import fs from 'node:fs';import {encodeAbiParameters,keccak256,concat,isAddress} from 'viem';
const [snapshotFile,configFile,outFile]=process.argv.slice(2);if(!snapshotFile||!configFile||!outFile)throw Error('Usage: build-allocation.mjs snapshot.json distribution-config.json output.json');
const snapshot=JSON.parse(fs.readFileSync(snapshotFile,'utf8')),config=JSON.parse(fs.readFileSync(configFile,'utf8'));
if(snapshot.chainId!==56||!isAddress(config.contract)||!isAddress(config.token)||!Number.isSafeInteger(config.epoch)||config.epoch<1||!/^\d+$/.test(config.rawTokenUnitsPerPoint)||BigInt(config.rawTokenUnitsPerPoint)<1n)throw Error('Invalid distribution configuration. Token units are integer base units, not floating point.');
const rows=snapshot.agents.filter(a=>a.points>0).map(a=>({wallet:a.wallet.toLowerCase(),amount:(BigInt(a.points)*BigInt(config.rawTokenUnitsPerPoint)).toString()}));
if(!rows.length)throw Error('No positive point allocations.');if(new Set(rows.map(r=>r.wallet)).size!==rows.length)throw Error('Duplicate wallets.');
const leaf=r=>keccak256(keccak256(encodeAbiParameters([{type:'uint256'},{type:'address'},{type:'uint256'},{type:'address'},{type:'uint256'}],[56n,config.contract,BigInt(config.epoch),r.wallet,BigInt(r.amount)])));
const pair=(a,b)=>keccak256(concat(BigInt(a)<BigInt(b)?[a,b]:[b,a]));
const layers=[rows.map(leaf)];while(layers.at(-1).length>1){const current=layers.at(-1),next=[];for(let i=0;i<current.length;i+=2)next.push(i+1<current.length?pair(current[i],current[i+1]):current[i]);layers.push(next);}
const allocations=rows.map((r,index)=>{const proof=[];let cursor=index;for(let l=0;l<layers.length-1;l++){const sibling=cursor^1;if(sibling<layers[l].length)proof.push(layers[l][sibling]);cursor=Math.floor(cursor/2);}return {...r,proof};});
const total=rows.reduce((s,r)=>s+BigInt(r.amount),0n);if(config.maximumDistributionRaw&&total>BigInt(config.maximumDistributionRaw))throw Error('Allocations exceed the funded distribution limit.');
fs.writeFileSync(outFile,JSON.stringify({epoch:config.epoch,contract:config.contract.toLowerCase(),token:config.token.toLowerCase(),chainId:56,root:layers.at(-1)[0],totalRaw:total.toString(),allocations},null,2));
console.log('Wrote '+allocations.length+' allocations. Total base units: '+total+'. Propose this root on-chain, wait the contract delay, activate, then import allocations in signed batches of five. Later epochs must contain cumulative lifetime entitlements; do not reset claimed allocations.');
