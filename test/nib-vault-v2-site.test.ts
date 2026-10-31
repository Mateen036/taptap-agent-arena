import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {nftSnapshot} from '../lib/nft';
import {nibVaultV2Address} from '../lib/nft-protocol';

const REFUND='TapTap is an experiment. If the experiment fails, paid minters will be refunded in the asset they paid with.';
const FACT='The V2 vault is managed by the treasury (funds can be withdrawn to process refunds and liquidity).';
const snap=(env:any)=>nftSnapshot({DB:undefined as any,...env},null,new URL('https://x.test/api/nft'),Date.now()) as Promise<any>;

test('V2 vault disclosure is hidden until NIB_VAULT_V2 is a valid address',async()=>{
 assert.equal(nibVaultV2Address({}),null);assert.equal(nibVaultV2Address({NIB_VAULT_V2:''}),null);assert.equal(nibVaultV2Address({NIB_VAULT_V2:'0xnope'}),null);assert.equal(nibVaultV2Address({NIB_VAULT_V2:'0x'+'0'.repeat(40)}),null);
 const off=await snap({});assert.deepEqual(off.vaultV2,{configured:false,address:null});
 const addr='0x65397BF634E817539024EFd32a0E2c5e51fB81bd';
 const on=await snap({NIB_VAULT_V2:addr});assert.deepEqual(on.vaultV2,{configured:true,address:addr});
});

test('the V2 vault notice leads with the refund commitment, states the treasury control plainly, and is translated to 中文',()=>{
 const html=fs.readFileSync('ui/nft.html','utf8'),box=html.slice(html.indexOf('id="nft-vault-v2"'),html.indexOf('id="nft-vault-v2-link"'));
 assert.match(box,/hidden/);assert.ok(box.indexOf(REFUND)>=0&&box.indexOf(FACT)>box.indexOf(REFUND),'refund commitment comes first, factual line second');
 assert.doesNotMatch(box,/NOT locked/i);
 const ctx:any={};ctx.window=ctx;vm.createContext(ctx);vm.runInContext(fs.readFileSync('public/i18n-dict.js','utf8'),ctx);
 const pairs=new Map<string,string>(ctx.TAPTAP_I18N_PAIRS);
 for(const k of [REFUND,FACT,'View V2 vault']){assert.ok(pairs.get(k)&&/[\u4e00-\u9fff]/.test(pairs.get(k)!),'missing 中文 for: '+k);}
 assert.equal(pairs.get(REFUND),'TapTap 是一项实验。如果实验失败，付费铸造者将以其支付时使用的资产获得退款。');
 assert.equal(pairs.get(FACT),'V2 金库由国库管理（资金可被提取，用于处理退款和流动性）。');
 const js=fs.readFileSync('public/nft.js','utf8');assert.match(js,/NIB_VAULT_V2|vaultV2/);assert.match(js,/box\.hidden=!v\?\.configured/);
});
