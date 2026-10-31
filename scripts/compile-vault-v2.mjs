import fs from 'node:fs';import solc from 'solc';

const names=['NibVaultV2'];
const sources=Object.fromEntries(names.map(n=>[n+'.sol',{content:fs.readFileSync('contracts/'+n+'.sol','utf8')}]));
const input={language:'Solidity',sources,settings:{optimizer:{enabled:true,runs:200},viaIR:true,evmVersion:'paris',outputSelection:{'*':{'*':['abi','evm.bytecode.object','evm.deployedBytecode.object','evm.deployedBytecode.immutableReferences','storageLayout']}}}};
const output=JSON.parse(solc.compile(JSON.stringify(input),{import:p=>{try{const content=fs.readFileSync('node_modules/'+p,'utf8');sources[p]={content};return {contents:content}}catch{return {error:'Missing '+p}}}}));
if(output.errors?.some(e=>e.severity==='error'))throw Error(output.errors.map(e=>e.formattedMessage).join('\n'));
fs.mkdirSync('artifacts',{recursive:true});for(const n of names){const c=output.contracts[n+'.sol'][n];fs.writeFileSync('artifacts/'+n+'.json',JSON.stringify({contractName:n,abi:c.abi,bytecode:'0x'+c.evm.bytecode.object,deployedBytecode:'0x'+c.evm.deployedBytecode.object,compiler:solc.version(),immutableReferences:c.evm.deployedBytecode.immutableReferences,storageLayout:c.storageLayout},null,2));}
fs.writeFileSync('artifacts/NibVaultV2-standard-input.json',JSON.stringify(input,null,2)+'\n');
console.log('Compiled NibVaultV2 (standalone).');
