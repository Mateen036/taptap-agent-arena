import {isAddress,keccak256,toHex} from 'viem';
import {ROUND_MS,STRATEGIES,utcDay,dailyRule,arenaView,arenaTick,arenaEnergy,arenaCost} from './arena';
import {canonical} from './game';
export class SeasonError extends Error{constructor(public status:number,message:string){super(message);}}
const fail=(status:number,message:string):never=>{throw new SeasonError(status,message)};
type Env={DB:D1Database};
const q=(e:Env,sql:string,...args:any[])=>e.DB.prepare(sql).bind(...args);
const first=(e:Env,sql:string,...args:any[])=>q(e,sql,...args).first<any>();
const rows=async(e:Env,sql:string,...args:any[])=>(await q(e,sql,...args).all<any>()).results;
const key=(value:string)=>keccak256(toHex(value));
const uuid=(value:any)=>typeof value==='string'&&/^[a-zA-Z0-9:_-]{1,100}$/.test(value)?value:fail(400,'Invalid public identifier.');
const strategy=(value:any)=>STRATEGIES.includes(value)?value:fail(400,'Choose balanced, sprinter, or hoarder.');
const wallet=(value:any)=>typeof value==='string'&&isAddress(value)?value.toLowerCase():fail(400,'Enter a valid BNB Chain wallet address.');
const response=(data:any,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
export async function currentSeason(e:Env,now:number){
 let s=await first(e,"SELECT * FROM seasons WHERE id='season-0'");
 if(!s){await q(e,"INSERT INTO seasons(id,name,starts_at,ends_at,capacity) VALUES('season-0','Season 0 · First Contact',?,?,100) ON CONFLICT(id) DO NOTHING",now,now+7*86_400_000).run();s=await first(e,"SELECT * FROM seasons WHERE id='season-0'");}
 const phase=await first(e,"SELECT value FROM game_settings WHERE key='season_phase'");
 return {...s,phase:phase?.value==='frozen'?'frozen':now>=s.ends_at?'ended':'open',rulesVersion:1};
}
async function requireOpen(e:Env,now:number){const s=await currentSeason(e,now);if(s.phase!=='open')fail(409,'Season 0 is closed for competition. Lifetime points are preserved.');return s;}
async function member(e:Env,a:any,now:number){
 const w=a.wallet;
 const s=await requireOpen(e,now),id=s.id+':'+w;
 if(await first(e,'SELECT id FROM season_members WHERE id=?',id))return s;
 const event=crypto.randomUUID();
 await e.DB.batch([
  q(e,'UPDATE seasons SET enrolled=enrolled+1,last_enroll=? WHERE id=? AND enrolled<capacity AND ends_at>? AND NOT EXISTS(SELECT 1 FROM season_members WHERE id=?) AND EXISTS(SELECT 1 FROM agents WHERE wallet=? AND connected=1 AND version=?) AND NOT EXISTS(SELECT 1 FROM game_settings WHERE key=\'season_phase\' AND value=\'frozen\')',event,s.id,now,id,w,a.version),
  q(e,'INSERT INTO season_members(id,season_id,wallet,joined_at) SELECT ?,?,?,? WHERE EXISTS(SELECT 1 FROM seasons WHERE id=? AND last_enroll=?) ON CONFLICT(id) DO NOTHING',id,s.id,w,now,s.id,event)
 ]);
 if(!await first(e,'SELECT id FROM season_members WHERE id=?',id))fail(409,'The 100 founding competition slots are full. Spectating and lifetime tapping remain open.');
 return s;
}
export function seasonTapStatement(e:Env,a:any,gain:number,taps:number,now:number,event:string){
 return q(e,"INSERT INTO season_scores(id,season_id,wallet,score,taps,updated_at) SELECT ?, 'season-0',?,?,?,? WHERE EXISTS(SELECT 1 FROM agents WHERE wallet=? AND last_event=?) AND EXISTS(SELECT 1 FROM season_members WHERE season_id='season-0' AND wallet=?) AND EXISTS(SELECT 1 FROM seasons WHERE id='season-0' AND starts_at<=? AND ends_at>?) ON CONFLICT(id) DO UPDATE SET score=season_scores.score+excluded.score,taps=season_scores.taps+excluded.taps,updated_at=excluded.updated_at",'season-0:'+a.wallet,a.wallet,gain,taps,now,a.wallet,event,a.wallet,now,now);
}
export async function track(e:Env,user:string|undefined,event:string,now:number){
 if(!user)return;
 const day=utcDay(now),visitor=key(day+':'+user),id=day+':'+visitor+':'+event;
 await q(e,'INSERT INTO analytics_events(id,day,visitor,event,count,updated_at) VALUES(?,?,?,?,1,?) ON CONFLICT(id) DO UPDATE SET count=analytics_events.count+1,updated_at=excluded.updated_at WHERE analytics_events.count<20',id,day,visitor,event,now).run();
 // Keep only a bounded diagnostic history. No IPs, prompts, signatures, or wallet addresses.
 if(event==='visit')await q(e,'DELETE FROM analytics_events WHERE day<?',utcDay(now-30*86_400_000)).run();
}
async function profile(e:Env,w:string){return first(e,'SELECT * FROM agent_profiles WHERE wallet=?',w);}
const publicIdentity=(a:any)=>({wallet:a.wallet,name:a.display_name||a.name||'Agent '+a.wallet.slice(2,8),bio:a.bio||'',avatar:a.avatar||'nib',strategy:a.strategy||'balanced'});
async function publicProfile(e:Env,w:string,now:number){
 const a=await first(e,'SELECT a.wallet,a.name,a.points,a.earned,a.taps,a.runs,a.created_at,p.display_name,p.bio,p.avatar,p.strategy FROM agents a LEFT JOIN agent_profiles p ON p.wallet=a.wallet WHERE a.wallet=?',w);
 if(!a)fail(404,'Agent profile not found. Pair your agent to create a profile.');
 const s=await currentSeason(e,now);
 const score=await first(e,'SELECT score,taps FROM season_scores WHERE season_id=? AND wallet=?',s.id,w);
 const badge=!!await first(e,'SELECT id FROM season_members WHERE season_id=? AND wallet=?',s.id,w);
 const rounds=await rows(e,'SELECT id,room_id,mode,score,taps,started_at,ends_at FROM arena_entries WHERE wallet=? AND ends_at<=? ORDER BY ends_at DESC LIMIT 10',w,now);
 return {...publicIdentity(a),points:a.points,lifetimeEarned:a.earned,lifetimeTaps:a.taps,completedRuns:a.runs,joinedAt:a.created_at,seasonScore:score?.score||0,foundingAgent:badge,rounds};
}
function matchView(m:any,entries:any[],creator:any,now:number){
 const status=m.status==='open'?(now>=m.expires_at?'expired':'open'):m.status==='accepted'?(now>=m.ends_at?'completed':now<m.started_at?'countdown':'running'):m.status;
 let winner=null;if(status==='completed'&&entries.length===2&&entries[0].score!==entries[1].score)winner=entries[0].score>entries[1].score?entries[0].wallet:entries[1].wallet;
 return {id:m.id,creator:creator?publicIdentity(creator):{wallet:m.creator,name:'Agent'},target:m.target,status,parentId:m.parent_id,createdAt:m.created_at,expiresAt:m.expires_at,startsAt:m.started_at,endsAt:m.ends_at,rule:dailyRule(m.rule_day),winner,tie:status==='completed'&&!winner,players:entries.map(a=>({...publicIdentity(a),strategy:status==='completed'?a.strategy:undefined,entryId:a.id,score:a.score,gross:a.gross,taps:a.taps}))};
}
async function publicMatches(e:Env,matches:any[],now:number){
 if(!matches.length)return [];
 const slots=matches.map(()=>'?').join(',');
 const [entries,creators]=await Promise.all([
  rows(e,`SELECT e.id,e.room_id,e.wallet,e.score,e.gross,e.taps,e.strategy,p.display_name,p.avatar,a.name FROM arena_entries e JOIN agents a ON a.wallet=e.wallet LEFT JOIN agent_profiles p ON p.wallet=e.wallet WHERE e.room_id IN (${slots}) ORDER BY e.wallet`,...matches.map(m=>m.id)),
  rows(e,`SELECT a.wallet,a.name,p.display_name,p.avatar FROM agents a LEFT JOIN agent_profiles p ON p.wallet=a.wallet WHERE a.wallet IN (${slots})`,...matches.map(m=>m.creator))
 ]);
 return matches.map(m=>matchView(m,entries.filter(v=>v.room_id===m.id),creators.find(v=>v.wallet===m.creator),now));
}
async function publicMatch(e:Env,id:string,now:number){const m=await first(e,'SELECT * FROM arena_matches WHERE id=?',id);if(!m)fail(404,'Challenge not found.');return (await publicMatches(e,[m],now))[0];}
export async function seasonSnapshot(e:Env,a:any,now:number){
 const s=await currentSeason(e,now),p=await profile(e,a.wallet);
 const entries=await rows(e,'SELECT * FROM arena_entries WHERE wallet=? ORDER BY ends_at DESC LIMIT 10',a.wallet);
 const jobs=await rows(e,"SELECT id,kind,payload,status,error,created_at,started_at,finished_at FROM agent_jobs WHERE wallet=? ORDER BY CASE WHEN status IN ('queued','running') THEN 0 ELSE 1 END,created_at DESC LIMIT 20",a.wallet);
 const related=await rows(e,'SELECT * FROM arena_matches WHERE creator=? OR target=? OR id IN(SELECT room_id FROM arena_entries WHERE wallet=?) ORDER BY created_at DESC LIMIT 12',a.wallet,a.wallet,a.wallet);
 const myScore=await first(e,'SELECT score FROM season_scores WHERE season_id=? AND wallet=?',s.id,a.wallet);
 return {season:s,seasonScore:myScore?.score||0,profile:p?publicIdentity({...p,name:p.display_name}):publicIdentity(a),member:!!await first(e,'SELECT id FROM season_members WHERE season_id=? AND wallet=?',s.id,a.wallet),dailyRule:dailyRule(utcDay(now)),entries:entries.map(v=>arenaView(v,now)),jobs:jobs.map(j=>({...j,payload:JSON.parse(j.payload)})),matches:await publicMatches(e,related,now)};
}
async function queue(e:Env,a:any,b:any,now:number){
 const kind=b.kind;if(!['season-join','daily-join','duel-create','duel-accept','duel-rematch'].includes(kind))fail(400,'Unsupported agent task.');
 const payload:any={};
 if(kind==='daily-join')payload.strategy=strategy(b.payload?.strategy||'balanced');
 if(kind==='duel-create'){payload.strategy=strategy(b.payload?.strategy||'balanced');if(b.payload?.target)payload.target=wallet(b.payload.target);if(payload.target===a.wallet)fail(400,'Challenge another agent.');}
 if(kind==='duel-accept'||kind==='duel-rematch'){payload.matchId=uuid(b.payload?.matchId);payload.strategy=strategy(b.payload?.strategy||'balanced');}
 const serialized=canonical(payload),existing=await first(e,"SELECT id FROM agent_jobs WHERE wallet=? AND kind=? AND payload=? AND status='queued'",a.wallet,kind,serialized);
 if(existing)return {id:existing.id,status:'queued'};
 const id=crypto.randomUUID();
 const results=await e.DB.batch([q(e,"INSERT INTO agent_jobs(id,wallet,kind,payload,created_at) SELECT ?,?,?,?,? WHERE (SELECT COUNT(*) FROM agent_jobs WHERE wallet=? AND status IN ('queued','running'))<8 AND (SELECT COUNT(*) FROM agent_jobs WHERE wallet=? AND created_at>?)<20",id,a.wallet,kind,serialized,now,a.wallet,a.wallet,now-60_000)]);
 if(!results[0].meta.changes)fail(429,'Finish queued tasks before sending another.');
 return {id,status:'queued',message:'Your connected agent must sign and execute this task.'};
}
export async function seasonRoute(request:Request,e:Env,user:string|undefined,a:any,readBody:()=>Promise<any>,now:number):Promise<Response|null>{
 const url=new URL(request.url),path=url.pathname.replace(/^\/api/,'');
 if(path==='/season'&&request.method==='GET'){
  const s=await currentSeason(e,now);
  const leaders=await rows(e,'SELECT a.wallet,a.name,p.display_name,p.avatar,s.score,s.taps FROM season_scores s JOIN agents a ON a.wallet=s.wallet LEFT JOIN agent_profiles p ON p.wallet=a.wallet WHERE s.season_id=? ORDER BY s.score DESC,s.taps DESC,a.wallet LIMIT 50',s.id);
  const daily=await rows(e,"SELECT a.wallet,a.name,p.display_name,p.avatar,e.score,e.taps,e.id FROM arena_entries e JOIN agents a ON a.wallet=e.wallet LEFT JOIN agent_profiles p ON p.wallet=e.wallet WHERE e.daily_day=? AND e.ends_at<=? ORDER BY e.score DESC,e.taps DESC,e.wallet LIMIT 50",utcDay(now),now);
  const wars=await rows(e,"SELECT a.wallet,a.name,p.display_name,p.avatar,SUM(e.score) AS score,SUM(e.taps) AS taps,COUNT(*) AS rounds FROM arena_entries e JOIN agents a ON a.wallet=e.wallet LEFT JOIN agent_profiles p ON p.wallet=e.wallet WHERE e.season_id=? AND e.mode='daily' AND e.ends_at<=? GROUP BY a.wallet,a.name,p.display_name,p.avatar ORDER BY score DESC,taps DESC,a.wallet LIMIT 50",s.id,now);
  const matches=await rows(e,"SELECT * FROM arena_matches WHERE (status='open' AND expires_at>?) OR status='accepted' ORDER BY created_at DESC LIMIT 20",now);
  const count=await first(e,'SELECT COUNT(*) AS agents,COALESCE(SUM(runs),0) AS runs,COALESCE(SUM(taps),0) AS taps FROM agents');
  const events=await rows(e,'SELECT event,SUM(count) AS count FROM analytics_events WHERE day=? GROUP BY event',utcDay(now));
  return response({season:s,rule:dailyRule(utcDay(now)),day:utcDay(now),serverTime:now,leaderboard:leaders.map(l=>({...publicIdentity(l),score:l.score,taps:l.taps})),daily:daily.map(l=>({...publicIdentity(l),score:l.score,taps:l.taps,entryId:l.id})),wars:wars.map(l=>({...publicIdentity(l),score:Number(l.score),taps:Number(l.taps),rounds:Number(l.rounds)})),matches:await publicMatches(e,matches,now),metrics:{agents:count.agents,completedRuns:count.runs,lifetimeTaps:Number(count.taps),foundingAgents:s.enrolled,events:events.map(v=>({...v,count:Number(v.count)}))}});
 }
 if(path.startsWith('/public/agents/')&&request.method==='GET')return response(await publicProfile(e,wallet(path.split('/').pop()),now));
 if(path.startsWith('/public/matches/')&&request.method==='GET')return response(await publicMatch(e,uuid(path.split('/').pop()),now));
 if(path.startsWith('/public/runs/')&&request.method==='GET'){
  const id=uuid(path.split('/').pop()),c=await first(e,"SELECT id,wallet,target,done,earned,status,created_at,finished_at FROM commands WHERE id=? AND status='completed'",id);
  if(!c)fail(404,'Completed run not found.');return response({...c,agent:await publicProfile(e,c.wallet,now)});
 }
 if(path.startsWith('/public/rounds/')&&request.method==='GET'){
  const id=uuid(path.split('/').pop()),entry=await first(e,'SELECT id,wallet,room_id,mode,rule_day,score,gross,taps,started_at,ends_at FROM arena_entries WHERE id=? AND ends_at<=?',id,now);
  if(!entry)fail(404,'Completed round not found.');return response({...entry,rule:dailyRule(entry.rule_day),agent:await publicProfile(e,entry.wallet,now)});
 }
 if(path==='/analytics'&&request.method==='POST'){
  if(!user)fail(401,'A browser session is required.');const b=await readBody();if(!['visit','connect_open','share','challenge_open','first_run_view'].includes(b.event))fail(400,'Unsupported diagnostic event.');await track(e,user,b.event,now);return response({ok:true});
 }
 if(path==='/profile'&&request.method==='POST'){
  if(!a?.connected)fail(409,'Pair your agent before editing its profile.');const b=await readBody();const name=String(b.name||'').trim(),bio=String(b.bio||'').trim();
  if(name.length<2||name.length>28||/[<>\x00-\x1f]/.test(name)||bio.length>160||/[<>\x00-\x1f]/.test(bio))fail(400,'Use a 2–28 character name and a bio of at most 160 characters.');
  const style=strategy(b.strategy||'balanced'),avatar=['nib','bolt','orbit'].includes(b.avatar)?b.avatar:'nib';
  await q(e,'INSERT INTO agent_profiles(wallet,display_name,bio,strategy,avatar,updated_at) VALUES(?,?,?,?,?,?) ON CONFLICT(wallet) DO UPDATE SET display_name=excluded.display_name,bio=excluded.bio,strategy=excluded.strategy,avatar=excluded.avatar,updated_at=excluded.updated_at',a.wallet,name,bio,style,avatar,now).run();return response({ok:true});
 }
 if(path==='/jobs'&&request.method==='POST'){if(!a?.connected)fail(409,'Pair a verified agent before sending tasks.');const s=await requireOpen(e,now);void s;return response(await queue(e,a,await readBody(),now),201);}
 if(path==='/jobs/cancel'&&request.method==='POST'){if(!a?.connected)fail(409,'Pair your agent first.');const b=await readBody();await q(e,"UPDATE agent_jobs SET status='cancelled',finished_at=? WHERE id=? AND wallet=? AND status='queued'",now,uuid(b.id),a.wallet).run();return response({ok:true});}
 return null;
}
async function writeEntry(e:Env,a:any,entry:any,fields:Record<string,any>,kind:string,delta:number,detail:string,now:number){
 const event=crypto.randomUUID(),pairs=Object.entries(fields);
 const results=await e.DB.batch([
  q(e,`UPDATE arena_entries SET ${pairs.map(([k])=>k+'=?').join(',')},version=version+1,last_event=? WHERE id=? AND wallet=? AND version=? AND started_at<=? AND ends_at>? AND EXISTS(SELECT 1 FROM agents WHERE wallet=? AND connected=1 AND version=?) AND NOT EXISTS(SELECT 1 FROM game_settings WHERE key='season_phase' AND value='frozen')`,...pairs.map(([,v])=>v),event,entry.id,entry.wallet,entry.version,now,now,a.wallet,a.version),
  q(e,'INSERT INTO arena_events(id,entry_id,wallet,kind,delta,detail,created_at) SELECT ?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM arena_entries WHERE id=? AND last_event=?)',event,entry.id,entry.wallet,kind,delta,detail,now,entry.id,event)
 ]);
 if(!results[0].meta.changes)fail(409,'Round changed, ended, or paused for maintenance. Refresh the agent state.');
 return arenaView(await first(e,'SELECT * FROM arena_entries WHERE id=?',entry.id),now);
}
export const SEASON_ACTIONS=['season-join','job-start','arena-join','arena-tap','arena-rest','arena-resume','arena-upgrade','arena-finish','duel-create','duel-accept','duel-rematch','job-complete'];
export async function seasonAction(e:Env,a:any,action:string,p:any,now:number){
 if(action==='job-start'){const id=uuid(p.jobId);await q(e,"UPDATE agent_jobs SET status='running',started_at=? WHERE id=? AND wallet=? AND status='queued'",now,id,a.wallet).run();const job=await first(e,'SELECT * FROM agent_jobs WHERE id=? AND wallet=?',id,a.wallet);if(!job||job.status!=='running')fail(409,'Task is no longer queued.');return {job:{...job,payload:JSON.parse(job.payload)}};}
 if(p.jobId&&action!=='job-complete'){const job=await first(e,'SELECT * FROM agent_jobs WHERE id=? AND wallet=?',uuid(p.jobId),a.wallet);if(!job||job.status!=='running')fail(409,'Agent task is not running.');const expected:any={'season-join':'season-join','daily-join':'arena-join','duel-create':'duel-create','duel-accept':'duel-accept','duel-rematch':'duel-rematch'};if(expected[job.kind]!==action)fail(400,'Task does not authorize this action.');const {jobId,...actual}=p;if(canonical(actual)!==canonical(JSON.parse(job.payload)))fail(400,'Task payload does not match its queued instructions.');}
 if(action==='job-complete'){
  const id=uuid(p.jobId),status=p.status==='failed'?'failed':'completed',error=status==='failed'?(['expired','conflict','unavailable','rejected'].includes(p.error)?p.error:'unavailable'):null;
  const job=await first(e,'SELECT id FROM agent_jobs WHERE id=? AND wallet=?',id,a.wallet);if(!job)fail(404,'Agent task not found.');
  await q(e,"UPDATE agent_jobs SET status=?,error=?,finished_at=? WHERE id=? AND wallet=? AND status IN ('queued','running')",status,error,now,id,a.wallet).run();return {ok:true};
 }
 if(action==='season-join'){const season=await member(e,a,now);return {member:true,season};}
 if(action==='arena-join'){
  const s=await member(e,a,now),day=utcDay(now),room='daily:'+day;
  const existing=await first(e,'SELECT * FROM arena_entries WHERE room_id=? AND wallet=?',room,a.wallet);if(existing)return {entry:arenaView(existing,now)};
  const end=Math.min(Date.parse(day+'T00:00:00Z')+86_400_000,s.ends_at);if(end-now<ROUND_MS)fail(409,'The next daily round opens after the current day ends.');
  if(await first(e,'SELECT id FROM arena_entries WHERE wallet=? AND ends_at>?',a.wallet,now))fail(409,'Finish your current arena round first.');
  const id=crypto.randomUUID();await e.DB.batch([q(e,'INSERT INTO arena_entries(id,room_id,wallet,season_id,mode,daily_day,rule_day,strategy,started_at,ends_at,last_tick,updated_at) SELECT ?,?,?,?,\'daily\',?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM seasons WHERE id=? AND ends_at>?) AND EXISTS(SELECT 1 FROM agents WHERE wallet=? AND connected=1 AND version=?) AND NOT EXISTS(SELECT 1 FROM game_settings WHERE key=\'season_phase\' AND value=\'frozen\') AND NOT EXISTS(SELECT 1 FROM arena_entries WHERE wallet=? AND ends_at>?) ON CONFLICT(room_id,wallet) DO NOTHING',id,room,a.wallet,s.id,day,day,strategy(p.strategy||'balanced'),now,now+ROUND_MS,now,now,s.id,now+ROUND_MS,a.wallet,a.version,a.wallet,now)]);
  const entry=await first(e,'SELECT * FROM arena_entries WHERE room_id=? AND wallet=?',room,a.wallet);if(!entry)fail(409,'Season is closed.');return {entry:arenaView(entry,now)};
 }
 if(['duel-create','duel-rematch'].includes(action)){
  const s=await member(e,a,now);let target=p.target?wallet(p.target):null,parent:any=null;
  if(target===a.wallet)fail(400,'Challenge another agent.');
  if(action==='duel-rematch'){
   parent=await first(e,'SELECT * FROM arena_matches WHERE id=?',uuid(p.matchId));
   if(!parent||parent.status!=='accepted'||now<parent.ends_at)fail(409,'Finish the match before requesting a rematch.');
   const players=await rows(e,'SELECT wallet FROM arena_entries WHERE room_id=?',parent.id);if(!players.some(v=>v.wallet===a.wallet))fail(403,'Only a participant can request this rematch.');target=players.find(v=>v.wallet!==a.wallet)?.wallet;if(!target)fail(409,'Opponent not found.');
   const existing=await first(e,'SELECT id FROM arena_matches WHERE parent_id=? AND creator=?',parent.id,a.wallet);if(existing)return {match:await publicMatch(e,existing.id,now)};
  }
  if(p.jobId){const existing=await first(e,'SELECT id,creator FROM arena_matches WHERE id=?',uuid(p.jobId));if(existing&&existing.creator===a.wallet)return {match:await publicMatch(e,existing.id,now)};}
  const id=p.jobId?uuid(p.jobId):crypto.randomUUID(),expires=Math.min(now+86_400_000,s.ends_at-ROUND_MS-15_000);
  if(expires<=now)fail(409,'Season is too close to its end for a new match.');
  const results=await e.DB.batch([q(e,"INSERT INTO arena_matches(id,season_id,creator,target,creator_strategy,rule_day,parent_id,created_at,expires_at) SELECT ?,?,?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM agents WHERE wallet=? AND connected=1 AND version=?) AND (SELECT COUNT(*) FROM arena_matches WHERE creator=? AND status='open' AND expires_at>?)<3 AND (SELECT COUNT(*) FROM arena_matches WHERE creator=? AND created_at>?)<10 AND NOT EXISTS(SELECT 1 FROM game_settings WHERE key='season_phase' AND value='frozen') ON CONFLICT DO NOTHING",id,s.id,a.wallet,target,strategy(p.strategy||'balanced'),utcDay(now),parent?.id||null,now,expires,a.wallet,a.version,a.wallet,now,a.wallet,now-3_600_000)]);
  if(!results[0].meta.changes){const existing=parent?await first(e,'SELECT id FROM arena_matches WHERE parent_id=? AND creator=?',parent.id,a.wallet):null;if(existing)return {match:await publicMatch(e,existing.id,now)};fail(429,'Maximum three open challenges and ten challenges per hour.');}
  return {match:await publicMatch(e,id,now)};
 }
 if(action==='duel-accept'){
  const s=await member(e,a,now),m=await first(e,'SELECT * FROM arena_matches WHERE id=?',uuid(p.matchId));if(!m)fail(404,'Challenge not found.');
  if(m.creator===a.wallet)fail(400,'Another agent must accept your challenge.');if(m.target&&m.target!==a.wallet)fail(403,'This challenge is for another agent.');
  if(m.status==='accepted'){const joined=await first(e,'SELECT id FROM arena_entries WHERE room_id=? AND wallet=?',m.id,a.wallet);if(joined)return {match:await publicMatch(e,m.id,now)};fail(409,'This challenge was already accepted.');}
  if(m.status!=='open'||m.expires_at<=now)fail(409,'This challenge expired or closed.');
  if(await first(e,'SELECT id FROM arena_entries WHERE (wallet=? OR wallet=?) AND ends_at>?',m.creator,a.wallet,now))fail(409,'One of the agents is already in a round. Try again after it ends.');
  const start=now+15_000,end=start+ROUND_MS;if(end>s.ends_at)fail(409,'Season is too close to its end.');
  const event=crypto.randomUUID(),styles=[m.creator_strategy,strategy(p.strategy||'balanced')];
  const inserts=[m.creator,a.wallet].map((w,i)=>q(e,'INSERT INTO arena_entries(id,room_id,wallet,season_id,mode,rule_day,strategy,started_at,ends_at,last_tick,updated_at) SELECT ?,?,?,?,\'duel\',?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM arena_matches WHERE id=? AND last_event=?)',crypto.randomUUID(),m.id,w,s.id,m.rule_day,styles[i],start,end,start,start,m.id,event));
  const result=await e.DB.batch([q(e,"UPDATE arena_matches SET status='accepted',target=?,started_at=?,ends_at=?,version=version+1,last_event=? WHERE id=? AND status='open' AND expires_at>? AND version=? AND EXISTS(SELECT 1 FROM agents WHERE wallet=? AND connected=1 AND version=?) AND NOT EXISTS(SELECT 1 FROM arena_entries WHERE (wallet=? OR wallet=?) AND ends_at>?) AND NOT EXISTS(SELECT 1 FROM game_settings WHERE key='season_phase' AND value='frozen')",a.wallet,start,end,event,m.id,now,m.version,a.wallet,a.version,m.creator,a.wallet,now),...inserts]);
  if(!result[0].meta.changes)fail(409,'Another agent accepted this challenge first.');return {match:await publicMatch(e,m.id,now)};
 }
 const entry=await first(e,'SELECT * FROM arena_entries WHERE id=? AND wallet=?',uuid(p.entryId),a.wallet);if(!entry)fail(404,'Your arena round was not found.');
 if(action==='arena-finish'){if(now<entry.ends_at)fail(409,'The round has not ended.');return {entry:arenaView(entry,now)};}
 await requireOpen(e,now);
 if(now<entry.started_at||now>=entry.ends_at)fail(409,'The round is not active.');
 if(action==='arena-tap'){
  const plan=(()=>{try{return arenaTick(entry,p.taps,now)}catch(error){throw new SeasonError(409,(error as Error).message)}})();
  return {entry:await writeEntry(e,a,entry,{score:entry.score+plan.gain,gross:entry.gross+plan.gain,taps:entry.taps+plan.taps,energy:plan.energy,last_tick:plan.lastTick,updated_at:now},'tap',plan.gain,`${plan.taps} signed arena taps`,now)};
 }
 if(action==='arena-rest'||action==='arena-resume')return {entry:await writeEntry(e,a,entry,{energy:arenaEnergy(entry,now),resting:action==='arena-rest'?1:0,last_tick:now,updated_at:now},action,0,action==='arena-rest'?'Resting to recover energy':'Resumed tapping',now)};
 if(action==='arena-upgrade'){
  if(!['power','speed'].includes(p.kind))fail(400,'Choose power or speed.');const field=p.kind==='power'?'power_level':'speed_level',max=p.kind==='power'?5:3,cost=arenaCost(entry,p.kind);
  if(entry[field]>=max||entry.score<cost)fail(409,'Upgrade unavailable or not enough round points.');
  return {entry:await writeEntry(e,a,entry,{score:entry.score-cost,[field]:entry[field]+1,energy:arenaEnergy(entry,now),last_tick:now,updated_at:now},'upgrade',-cost,p.kind+' upgraded using round points',now)};
 }
 fail(400,'Unsupported arena action.');
}
