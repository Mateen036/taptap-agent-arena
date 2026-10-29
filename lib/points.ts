// TAP uses canonical decimal text for exact storage once NFT utility is active.
// Bounded legacy columns remain compatibility projections, never the source of an active balance.
export const LEGACY_POINT_LIMIT=9_000_000_000_000n;
export function exactPoints(value:unknown):bigint {
 if(typeof value==='bigint')return value;
 if(typeof value==='number'){if(!Number.isSafeInteger(value))throw Error('Unsafe numeric TAP amount.');return BigInt(value);}
 if(typeof value==='string'&&/^-?(0|[1-9][0-9]*)$/.test(value))return BigInt(value);
 throw Error('Invalid exact TAP amount.');
}
export const pointBalance=(a:any)=>exactPoints(a.points_exact??a.points??0);
export const earnedBalance=(a:any)=>exactPoints(a.earned_exact??a.earned??0);
export function publicPoints(value:unknown){const n=exactPoints(value);return n<=BigInt(Number.MAX_SAFE_INTEGER)&&n>=BigInt(Number.MIN_SAFE_INTEGER)?Number(n):n.toString();}
export function legacyPoints(value:bigint){return Number(value>LEGACY_POINT_LIMIT?LEGACY_POINT_LIMIT:value< -LEGACY_POINT_LIMIT?-LEGACY_POINT_LIMIT:value);}
export function pointFields(points:bigint,earned:bigint,active:boolean){if(points<0n||earned<0n)throw Error('TAP cannot be negative.');return active?{points:legacyPoints(points),earned:legacyPoints(earned),points_exact:points.toString(),earned_exact:earned.toString()}:{points:Number(points),earned:Number(earned)};}
export function nftMultiplier(owned:number){if(!Number.isSafeInteger(owned)||owned<0||owned>10000)throw Error('Invalid collection holding count.');return owned===0?0n:1n<<BigInt(owned);}
export function displayPoints(value:unknown){const n=exactPoints(value),negative=n<0n,raw=(negative?-n:n).toString(),sign=negative?'-':'';return raw.length<=15?sign+BigInt(raw).toLocaleString('en-US'):sign+raw[0]+'.'+raw.slice(1,4)+'e'+(raw.length-1);}
