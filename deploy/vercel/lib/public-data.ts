import {handle} from '../app/generated/api';
import {database} from './postgres';
export const SITE='https://www.nibtap.site';
export async function publicData(kind:string,id:string){
 const paths:Record<string,string>={profile:'agents',match:'matches',run:'runs',round:'rounds',season:'season'};
 if(!paths[kind])return null;
 const endpoint=kind==='season'?'/api/season':'/api/public/'+paths[kind]+'/'+encodeURIComponent(id);
 const result=await handle(new Request(SITE+endpoint),{DB:database(),STORAGE_NAME:'PostgreSQL'} as any);
 return result.ok?result.json():null;
}
