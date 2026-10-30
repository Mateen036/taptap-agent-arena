import {test} from 'node:test';import assert from 'node:assert/strict';import {decodeFunctionData} from 'viem';
import {nftDeploymentPlan,nftDeploymentTransaction,NFT_CREATE2,NFT_MULTICALL,deploymentAbi} from '../scripts/nft-deploy';
test('staged deployment keeps exact owner/bytecode, excludes completed components and never allows partial bundle success',()=>{
 const owner='0x0000000000000000000000000000000000000001',plan=nftDeploymentPlan(owner);
 const first=nftDeploymentTransaction(plan,['NibRenderer']);assert.equal(first.to,NFT_CREATE2);assert.equal(first.from,owner);assert.equal(first.value,'0');assert.equal(first.data,plan.steps[0].callData);
 const remaining=nftDeploymentTransaction(plan,['NibLPVault','NibCollection','NibMarketplace']);assert.equal(remaining.to,NFT_MULTICALL);const decoded=decodeFunctionData({abi:deploymentAbi,data:remaining.data});assert.equal(decoded.functionName,'aggregate3');assert.equal(decoded.args![0].length,3);
 decoded.args![0].forEach((call,i)=>{assert.equal(call.allowFailure,false);assert.equal(call.target.toLowerCase(),NFT_CREATE2.toLowerCase());assert.equal(call.callData,plan.steps[i+1].callData);});
 assert.throws(()=>nftDeploymentTransaction(plan,[]));assert.throws(()=>nftDeploymentTransaction(plan,['NibRenderer','NibRenderer']));assert.throws(()=>nftDeploymentTransaction(plan,['Unknown']));
 const other=nftDeploymentPlan('0x0000000000000000000000000000000000000002');assert.notEqual(plan.contracts.collection,other.contracts.collection);assert.notEqual(plan.steps[0].initCodeHash,plan.steps[2].initCodeHash);
});
