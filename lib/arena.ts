export const ROUND_MS=120_000;
export const STRATEGIES=['balanced','sprinter','hoarder'] as const;
export type Strategy=typeof STRATEGIES[number];
export const utcDay=(now:number)=>new Date(now).toISOString().slice(0,10);
export function dailyRule(day:string){
 const index=Math.floor(Date.parse(day+'T00:00:00Z')/86_400_000)%3;
 return [{id:'surge',name:'Golden windows',description:'Double points during seconds 30–50 and 90–110. Time your energy.',regen:6,baseSpeed:5},{id:'overclock',name:'Overclock day',description:'Everyone starts at 7 taps/sec. Speed upgrades cost half as much.',regen:6,baseSpeed:7},{id:'recharge',name:'Second wind',description:'Rest restores 10 energy/sec. Alternate bursts and recovery.',regen:10,baseSpeed:5}][index];
}
export function arenaEnergy(e:any,now:number){return Math.min(400,e.energy+(e.resting?Math.floor(Math.max(0,Math.min(now,e.ends_at)-(e.energyUpdatedAt??e.updated_at))/1000)*dailyRule(e.rule_day).regen:0));}
export function arenaPower(e:any){return e.power_level;}
export function arenaSpeed(e:any){return dailyRule(e.rule_day).baseSpeed+(e.speed_level-1)*2;}
export function arenaCost(e:any,kind:string){return (kind==='power'?80:dailyRule(e.rule_day).id==='overclock'?40:80)*2**((kind==='power'?e.power_level:e.speed_level)-1);}
export function arenaView(e:any,now:number){return {...e,energy:arenaEnergy(e,now),energyUpdatedAt:now,power:arenaPower(e),speed:arenaSpeed(e),status:now>=e.ends_at?'completed':now<e.started_at?'countdown':e.resting?'resting':'running',costs:{power:arenaCost(e,'power'),speed:arenaCost(e,'speed')},rule:dailyRule(e.rule_day)};}
export function arenaTick(e:any,requested:number,now:number){
 if(now<e.started_at||now>=e.ends_at)throw Error('Round is not active.');
 if(e.resting)throw Error('Resume the round before tapping.');
 if(!Number.isSafeInteger(requested)||requested<1||requested>100)throw Error('A batch must contain 1–100 taps.');
 const elapsed=Math.max(0,Math.min(10_000,now-e.last_tick));
 const taps=Math.min(requested,Math.floor(elapsed*arenaSpeed(e)/1000),e.energy);
 if(taps<1)throw Error(e.energy<1?'Rest to recharge energy.':'Tap rate exceeded.');
 // Score each tap at its own logical time so batching cannot shift taps into a bonus window.
 const start=now-elapsed;let gain=0;
 for(let i=1;i<=taps;i++){const seconds=((start+Math.ceil(i*1000/arenaSpeed(e))-e.started_at)/1000);const bonus=dailyRule(e.rule_day).id==='surge'&&((seconds>=30&&seconds<50)||(seconds>=90&&seconds<110));gain+=arenaPower(e)*(bonus?2:1);}
 return {taps,gain,lastTick:now-Math.max(0,elapsed-Math.ceil(taps*1000/arenaSpeed(e))),energy:e.energy-taps};
}
export function strategyDecision(e:any,now:number):{action:string,payload:any}|null{
 if(now<e.started_at||now>=e.ends_at)return null;
 const energy=arenaEnergy(e,now),remaining=e.ends_at-now;
 if(e.resting)return energy>=Math.min(160,Math.ceil(remaining/1000)*arenaSpeed(e))?{action:'arena-resume',payload:{entryId:e.id}}:null;
 if(energy<Math.min(25,arenaSpeed(e)*2))return {action:'arena-rest',payload:{entryId:e.id}};
 if(e.strategy!=='hoarder'&&remaining>35_000){
  const kind=e.strategy==='sprinter'&&e.speed_level<3?'speed':'power';
  const level=kind==='power'?e.power_level:e.speed_level;
  if(level<(kind==='power'?5:3)&&e.score>=arenaCost(e,kind))return {action:'arena-upgrade',payload:{entryId:e.id,kind}};
 }
 return {action:'arena-tap',payload:{entryId:e.id,taps:Math.min(100,arenaSpeed(e)*5,energy)}};
}
