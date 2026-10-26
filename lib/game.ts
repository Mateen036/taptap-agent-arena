export const MAX_POINTS=9_000_000_000_000;
export function power(a:any){return 1+(a.power_level-1)*2;}
export function capacity(a:any){return 1000+(a.tank_level-1)*1000;}
export function speed(a:any){return 5+(a.speed_level-1)*2;}
export function energyAt(a:any,now:number,running=false){return running?a.energy:Math.min(capacity(a),a.energy+Math.max(0,Math.floor((now-a.updated_at)/1000))*5);}
export function upgradeCost(a:any,i:number){const key=['power_level','tank_level','speed_level'][i];return Math.floor([1500,2500,4000][i]*Math.pow(1.65,a[key]-1));}
export function parseCommand(prompt:string){
 if(typeof prompt!=='string'||prompt.length>300||!/(tap|energy|power|collect|earn|start|farm)/i.test(prompt))throw new Error('Use a command such as “Tap 100 times”.');
 if(/-\s*\d/.test(prompt))throw new Error('Tap counts must be positive.');
 const n=prompt.match(/\d[\d,]*/);const count=n?Number(n[0].replaceAll(',','')):100;
 if(!Number.isSafeInteger(count)||count<1||count>10000)throw new Error('Choose between 1 and 10,000 taps per command.');return count;
}
export function tickPlan(agent:any,command:any,requested:number,now:number){
 if(!Number.isInteger(requested)||requested<1||requested>100)throw new Error('A batch must contain 1–100 taps.');
 if(command.status!=='running')throw new Error('This command is not running.');
 const elapsed=Math.max(0,Math.min(10000,now-command.last_tick));
 const available=Math.floor(elapsed*speed(agent)/1000);
 const taps=Math.min(requested,available,command.target-command.done,agent.energy);
 if(taps<1)throw new Error(agent.energy<1?'ENERGY_EMPTY':'RATE_LIMITED');
 const gain=taps*power(agent);if(agent.points+gain>MAX_POINTS)throw new Error('Point limit reached.');
 // Preserve sub-tap time, discard periods longer than the heartbeat cap.
 const lastTick=now-Math.max(0,elapsed-Math.ceil(taps*1000/speed(agent)));
 return {taps,gain,lastTick,energy:agent.energy-taps,complete:command.done+taps>=command.target};
}
export const missions=[{name:'First command',desc:'Complete one agent run.',goal:1,reward:500,key:'runs'},{name:'A thousand tiny taps',desc:'Let your agent complete 1,000 taps.',goal:1000,reward:2500,key:'taps'},{name:'Power moves',desc:'Upgrade Multitap to level 5.',goal:5,reward:1500,key:'power_level'}];
export function canonical(v:any):string{if(v===null||typeof v!=='object')return JSON.stringify(v);if(Array.isArray(v))return '['+v.map(canonical).join(',')+']';return '{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}';}
