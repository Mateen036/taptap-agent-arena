import fs from 'node:fs';import solc from 'solc';
const sources=Object.fromEntries(['TapToken','TapRewards'].map(n=>[n+'.sol',{content:fs.readFileSync('contracts/'+n+'.sol','utf8')}]));
const output=JSON.parse(solc.compile(JSON.stringify({language:'Solidity',sources,settings:{optimizer:{enabled:true,runs:200},evmVersion:'paris',outputSelection:{'*':{'*':['abi','evm.bytecode.object','evm.deployedBytecode.object']}}}}),{import:p=>{try{return {contents:fs.readFileSync('node_modules/'+p,'utf8')}}catch{return {error:'Missing '+p}}}}));
if(output.errors?.some(e=>e.severity==='error'))throw Error(output.errors.map(e=>e.formattedMessage).join('\n'));
fs.mkdirSync('artifacts',{recursive:true});for(const n of ['TapToken','TapRewards']){const c=output.contracts[n+'.sol'][n];fs.writeFileSync('artifacts/'+n+'.json',JSON.stringify({contractName:n,abi:c.abi,bytecode:'0x'+c.evm.bytecode.object,deployedBytecode:'0x'+c.evm.deployedBytecode.object,compiler:solc.version()},null,2));}
console.log('Compiled fixed-supply token and cumulative agent-gated rewards contracts.');
