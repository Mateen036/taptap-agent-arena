import {createHmac,randomBytes,timingSafeEqual} from 'node:crypto';
const COOKIE='taptap_session';
export function browserSession(request:Request){
 const secret=process.env.AUTH_SECRET;if(!secret||Buffer.byteLength(secret)<32)throw Error('Configure AUTH_SECRET with at least 32 random bytes.');
 const incoming=request.headers.get('cookie')?.split(';').map(v=>v.trim()).find(v=>v.startsWith(COOKIE+'='))?.slice(COOKIE.length+1)||'';
 const [identifier,signature]=incoming.split('.');const mac=(id:string)=>createHmac('sha256',secret).update('taptap-browser-v1:'+id).digest('hex');
 if(/^[a-f0-9]{64}$/.test(identifier||'')&&/^[a-f0-9]{64}$/.test(signature||'')){const expected=Buffer.from(mac(identifier),'hex'),received=Buffer.from(signature,'hex');if(timingSafeEqual(expected,received))return {userId:'wallet:'+identifier,cookie:null};}
 const id=randomBytes(32).toString('hex');const secure=new URL(request.url).protocol==='https:';return {userId:'wallet:'+id,cookie:`${COOKIE}=${id}.${mac(id)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=7776000${secure?'; Secure':''}`};
}
