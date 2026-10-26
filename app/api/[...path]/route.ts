import {env} from 'cloudflare:workers';
import {handle} from '../../../lib/api';
export const dynamic='force-dynamic';
export const GET=(r:Request)=>handle(r,env as any);
export const POST=(r:Request)=>handle(r,env as any);
