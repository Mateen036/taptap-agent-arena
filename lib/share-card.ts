import {displayPoints} from './points';
import {ImageResponse} from 'next/og';
import {createElement as h} from 'react';
export function createPublicCard(kind:string,data:any,mascot:string|undefined,fonts:{regular:Buffer,bold:Buffer}){
 let name=kind==='profile'?data.name:kind==='match'?data.creator.name:kind==='season'?'Humans coach. Agents compete.':data.agent.name;
 if(!/^[\x20-\x7e\u00a0-\u024f]+$/.test(String(name)))name='Agent '+String(data.wallet||data.agent?.wallet||data.creator?.wallet||'').slice(0,10);
 const headline=kind==='profile'?Number(data.lifetimeTaps).toLocaleString()+' signed taps':kind==='match'?(data.status==='completed'?'The rivalry has a receipt.':'Your agent. My agent. Two minutes.'):kind==='season'?'Your agent has a job now.':displayPoints(kind==='round'?data.score:data.earned)+(kind==='round'?' round points':' TAP earned');
 const label=kind==='profile'?'AGENT PROFILE':kind==='match'?data.status.toUpperCase()+' CHALLENGE':kind==='season'?'SEASON 0 / FIRST CONTACT':'SERVER-CONFIRMED RESULT';
 const detail=kind==='match'?data.players.map((p:any)=>(/^[\x20-\x7e\u00a0-\u024f]+$/.test(p.name)?p.name:'Agent '+p.wallet.slice(0,10))+' '+Number(p.score).toLocaleString()).join('  /  ')||'Equal resources. Signed agent actions.':kind==='season'?'BNB Chain · Agent ID wallets · Token TBA':kind==='profile'?(data.foundingAgent?'FOUNDING 100 · ':'')+'BNB Chain Agent ID holder':Number(kind==='round'?data.taps:data.done).toLocaleString()+' verified taps · '+(kind==='round'?data.rule.name:'Lifetime mission');
 const content=h('div',{style:{display:'flex',position:'relative',width:'100%',height:'100%',background:'#11150e',color:'#f4f4eb',padding:'58px 64px',fontFamily:'DM Sans',overflow:'hidden'}},
  h('div',{style:{display:'flex',position:'absolute',right:'-120px',top:'-150px',width:'680px',height:'800px',borderRadius:'50%',background:'#b6d88b12',border:'1px solid #6f843a44'}}),
  h('div',{style:{display:'flex',flexDirection:'column',position:'relative',width:'780px'}},
   h('div',{style:{display:'flex',fontSize:25,fontWeight:700,letterSpacing:-1,color:'#e7fa78'}},'taptap /'),
   h('div',{style:{display:'flex',fontSize:14,letterSpacing:3,color:'#b6d88b',marginTop:32}},label),
   h('div',{style:{display:'flex',fontSize:29,fontWeight:500,marginTop:20,maxWidth:670}},String(name).slice(0,60)),
   h('div',{style:{display:'flex',fontSize:kind==='season'?68:64,fontWeight:700,lineHeight:1.05,letterSpacing:-3,marginTop:20,maxWidth:760,color:'#e7fa78'}},headline),
   h('div',{style:{display:'flex',fontSize:20,marginTop:27,color:'#b2c39f',maxWidth:760}},detail.slice(0,120)),
   h('div',{style:{display:'flex',fontSize:15,color:'#8c9c7d',marginTop:'auto',paddingTop:20}},'taptap-agent-arena.vercel.app  /  Humans coach. Agents compete.')),
  mascot?h('img',{src:mascot,width:400,height:434,style:{position:'absolute',right:-20,bottom:20,objectFit:'contain'}}):h('div',{style:{display:'flex',position:'absolute',right:70,bottom:100,color:'#e7fa78',fontSize:170}},'N'));
 return new ImageResponse(content,{width:1200,height:630,fonts:[{name:'DM Sans',data:fonts.regular,weight:400,style:'normal'},{name:'DM Sans',data:fonts.bold,weight:700,style:'normal'}],headers:{'Cache-Control':'public, max-age=60','X-Content-Type-Options':'nosniff'}});
}
