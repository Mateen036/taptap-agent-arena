/** Original Nib Foundry artwork. Six mixed-radix traits cover exactly 10,000 unique combinations. */
export const NFT_SUPPLY=10_000;
const BACKGROUNDS=[
 {name:'Night Shift',base:'#111710',line:'#38502f',glow:'#b6d88b'},
 {name:'Soft Signal',base:'#e0e8c4',line:'#b5c28e',glow:'#607648'},
 {name:'Dusk Relay',base:'#2c2239',line:'#62466f',glow:'#e6b6fa'},
 {name:'Deep Current',base:'#102c34',line:'#28616d',glow:'#80e2db'},
 {name:'Solar Dust',base:'#432f20',line:'#805938',glow:'#ffd987'},
] as const;
const CHASSIS=[
 {name:'Carbon',shell:'#30382d',shade:'#171f17',light:'#68775a',accent:'#e7fa78'},
 {name:'Sage',shell:'#a9c489',shade:'#4a6440',light:'#daebb8',accent:'#f4f4eb'},
 {name:'Ceramic',shell:'#edf0dd',shade:'#8c9b7a',light:'#ffffff',accent:'#bcf452'},
 {name:'Signal Orange',shell:'#ed9160',shade:'#87462f',light:'#ffd1a1',accent:'#f4edc5'},
 {name:'Ultraviolet',shell:'#9e8ad2',shade:'#51416f',light:'#d3bdfa',accent:'#e7fa78'},
] as const;
const EYES=['Side Quest','Wide Awake','Laser Focus','Dream Mode','Glitch Wink'] as const;
const HEADGEAR=['Circuit Ears','Crown Relay','Satellite Kit','Halo Array'] as const;
const EMBLEMS=['Double Tap','Orbit','Spark','Foundry'] as const;
const ACCESSORIES=['Idle Hands','Tap Gauntlet','Signal Wand','Pocket Drone','Data Bloom'] as const;
export type NftTraits={background:typeof BACKGROUNDS[number]['name'];chassis:typeof CHASSIS[number]['name'];eyes:typeof EYES[number];headgear:typeof HEADGEAR[number];emblem:typeof EMBLEMS[number];accessory:typeof ACCESSORIES[number];indexes:readonly number[]};
function validateId(tokenId:number){if(!Number.isSafeInteger(tokenId)||tokenId<1||tokenId>NFT_SUPPLY)throw new RangeError('Nib Foundry token ID must be 1–10,000.');}
export function nftTraits(tokenId:number):NftTraits{
 validateId(tokenId);let n=((tokenId-1)*7919+6137)%NFT_SUPPLY;
 const indexes=[5,5,5,4,4,5].map(radix=>{const value=n%radix;n=Math.floor(n/radix);return value;});
 return {background:BACKGROUNDS[indexes[0]].name,chassis:CHASSIS[indexes[1]].name,eyes:EYES[indexes[2]],headgear:HEADGEAR[indexes[3]],emblem:EMBLEMS[indexes[4]],accessory:ACCESSORIES[indexes[5]],indexes};
}
/** Layer strings are exported to keep a Solidity renderer or alternate asset exporter auditable. */
export function nftSvgParts(tokenId:number){
 const t=nftTraits(tokenId),[bi,ci,eye,head,emblem,accessory]=t.indexes,b=BACKGROUNDS[bi],c=CHASSIS[ci],serial=String(tokenId).padStart(5,'0');
 const stroke='stroke="#10170f" stroke-width="8" stroke-linejoin="round" stroke-linecap="round"';
 const symbol=[
  '<path d="M260 389v29m17-29v29m18-21h17m-8-8v18"/>',
  '<ellipse cx="284" cy="405" rx="25" ry="12" transform="rotate(-28 284 405)"/><circle cx="284" cy="405" r="5" fill="currentColor"/>',
  '<path d="m290 381-23 28h18l-7 21 25-30h-18z" fill="currentColor" stroke="none"/>',
  '<path d="m262 418 7-28 15 10 15-10 7 28z"/><path d="M274 416v-9m20 9v-9"/>',
 ][emblem];
 const eyes=[
  '<ellipse cx="232" cy="246" rx="35" ry="43"/><ellipse cx="332" cy="246" rx="35" ry="43"/><ellipse cx="246" cy="249" rx="14" ry="23" fill="#18220f"/><ellipse cx="346" cy="249" rx="14" ry="23" fill="#18220f"/><circle cx="250" cy="239" r="5" fill="#fff"/><circle cx="350" cy="239" r="5" fill="#fff"/>',
  '<ellipse cx="232" cy="246" rx="36" ry="43"/><ellipse cx="332" cy="246" rx="36" ry="43"/><ellipse cx="232" cy="251" rx="15" ry="23" fill="#18220f"/><ellipse cx="332" cy="251" rx="15" ry="23" fill="#18220f"/><circle cx="226" cy="240" r="6" fill="#fff"/><circle cx="326" cy="240" r="6" fill="#fff"/>',
  '<path d="M195 223h73l-9 39h-54zm100 0h73l-10 39h-54z"/><path d="M231 227v28m100-28v28" stroke="#18220f" stroke-width="15"/><path d="m194 211 71 13m34 0 71-13" stroke="#10170f" stroke-width="9"/>',
  '<path d="M201 245q31-35 62 0m38 0q31-35 62 0" fill="none" stroke="currentColor" stroke-width="11" stroke-linecap="round"/><path d="M207 257h13m31 0h8m48 0h13m31 0h8" stroke="currentColor" stroke-width="4"/>',
  '<ellipse cx="232" cy="246" rx="36" ry="43"/><ellipse cx="232" cy="249" rx="14" ry="23" fill="#18220f"/><circle cx="227" cy="237" r="6" fill="#fff"/><path d="m307 240 22 14 27-20" fill="none" stroke="currentColor" stroke-width="12" stroke-linecap="round"/><path d="M365 211h11m-5-6v12" stroke="currentColor" stroke-width="4"/>',
 ][eye];
 const ears=[
  `<path d="m178 168-43-73-39 38 54 68m233-33 44-73 38 38-53 68" fill="${c.accent}" ${stroke}/><path d="m136 126 16 29m276-29-16 29" stroke="${c.shade}" stroke-width="10" stroke-linecap="round"/>`,
  `<path d="m180 163-23-72 59 31 42-56 35 58 67-33 17 73" fill="${c.accent}" ${stroke}/><path d="M212 135h125" stroke="${c.shade}" stroke-width="9"/><circle cx="260" cy="106" r="8" fill="#10170f"/>`,
  `<path d="M180 169 144 96m238 73 34-73" fill="none" ${stroke}/><circle cx="143" cy="89" r="19" fill="${c.accent}" ${stroke}/><circle cx="416" cy="89" r="19" fill="${c.accent}" ${stroke}/><path d="m119 78-13-8m335 8 13-8m-20 27 15 5m-323-5-15 5" stroke="${b.glow}" stroke-width="5" stroke-linecap="round"/>`,
  `<ellipse cx="282" cy="100" rx="100" ry="26" fill="none" stroke="${c.accent}" stroke-width="13"/><path d="M205 155v-39m154 39v-39" ${stroke}/><circle cx="282" cy="75" r="9" fill="${c.accent}" stroke="#10170f" stroke-width="5"/>`,
 ][head];
 const item=[
  `<path d="M181 416q-38-18-54 13l-1 35 49 9m218-57q38-18 54 13l1 35-49 9" fill="${c.shade}" ${stroke}/><path d="M141 449h22m259 0h-22" stroke="${c.accent}" stroke-width="6"/>`,
  `<path d="m376 441 10-53q3-12 12-10t10 15l-2 18 8-28q5-12 14-7t7 17l-7 29 11-13q11-10 19-1t-3 19l-30 37-38 6z" fill="${c.accent}" ${stroke}/><path d="m380 437 43 17m-32-38 11 8m15-19 11 8" stroke="${c.shade}" stroke-width="5"/><path d="m450 358 14-11m-28-2 4-17m24 49 17-3" stroke="${b.glow}" stroke-width="6" stroke-linecap="round"/>`,
  `<path d="m403 463 29-133" stroke="#10170f" stroke-width="15" stroke-linecap="round"/><path d="m403 463 29-133" stroke="${c.light}" stroke-width="7"/><path d="m433 276 14 23 25 4-19 18 2 25-23-13-23 10 5-25-17-20 26-1z" fill="${c.accent}" ${stroke}/><path d="m401 423-18 6 4 27 22 2 11-18-8-9" fill="${c.shade}" ${stroke}/>`,
  `<path d="m390 429 39-8" stroke="${c.accent}" stroke-width="5" stroke-dasharray="5 6"/><path d="m426 348 56-5 25 25-10 44-53 8-26-26z" fill="${c.accent}" ${stroke}/><rect x="440" y="365" width="47" height="25" rx="10" fill="#10170f"/><path d="M450 377h4m17 0h4" stroke="${c.light}" stroke-width="7" stroke-linecap="round"/><path d="m424 356-18-9m96-1 16-13m-78 79-7 13m51-15 6 11" stroke="${c.accent}" stroke-width="6" stroke-linecap="round"/>`,
  `<path d="m408 460 1-77m0 27-25-24m25 42 31-27" stroke="${c.accent}" stroke-width="8" stroke-linecap="round"/><path d="m409 329 20 27-20 27-21-27zM368 360l24 9-8 26-26-9zm75 14 25 11-12 24-24-11z" fill="${c.accent}" stroke="#10170f" stroke-width="6"/><path d="m391 462-17-27 9-15 26 13 23 10-8 24z" fill="${c.shade}" ${stroke}/>`,
 ][accessory];
 const background=`<rect width="560" height="560" fill="${b.base}"/><path d="M0 56h560M0 112h560M0 168h560M0 224h560M0 280h560M0 336h560M0 392h560M0 448h560M0 504h560M56 0v560M112 0v560M168 0v560M224 0v560M280 0v560M336 0v560M392 0v560M448 0v560M504 0v560" fill="none" stroke="${b.line}" stroke-width="1" opacity=".33"/><circle cx="282" cy="278" r="201" fill="${b.line}" opacity=".25"/><circle cx="282" cy="278" r="185" fill="none" stroke="${b.glow}" stroke-width="1" opacity=".35"/><path d="M27 75V28h48m410 0h48v47M27 485v48h48m410 0h48v-48" fill="none" stroke="${b.glow}" stroke-width="2" opacity=".65"/><path d="M50 271h20m-10-10v20m421-79h20m-10-10v20" stroke="${b.glow}" stroke-width="3" opacity=".6"/><text x="40" y="53" fill="${b.glow}" font-family="monospace" font-size="10" letter-spacing="3">NIB / FOUNDRY</text><text x="520" y="53" text-anchor="end" fill="${b.glow}" font-family="monospace" font-size="10">BNB · 10K</text><ellipse cx="282" cy="492" rx="170" ry="19" fill="#10170f" opacity=".32"/>`;
 const body=`<path d="m189 361 49-27h88l50 27 32 112-66 17H218l-64-17z" fill="${c.shade}" ${stroke}/><path d="m226 349 57 16 56-16 27 113-82 20-83-20z" fill="${c.shell}" ${stroke}/><path d="m222 356-10 48m132-48 10 48" stroke="${c.light}" stroke-width="7" stroke-linecap="round"/><path d="m183 369-21 8-17 60 34 12 19-54m184-26 20 8 18 60-35 12-18-54" fill="${c.shell}" ${stroke}/><path d="m225 458 57 13 59-13" fill="none" stroke="${c.light}" stroke-width="5"/><g color="${c.accent}" stroke="currentColor" stroke-width="5" fill="none" stroke-linejoin="round">${symbol}</g><path d="M220 336v-16h125v16l-29 22h-67z" fill="${c.shade}" ${stroke}/>`;
 const face=`<path d="m178 146 72-18 101 10 45 34 12 111-34 46-113 20-84-31-28-67 10-76z" fill="${c.shade}" ${stroke}/><path d="m184 147 67-17 98 9 42 34 4 98-25 39-110 21-73-27-26-59 9-69z" fill="${c.shell}" ${stroke}/><path d="m188 164 64-16 91 8 28 23" fill="none" stroke="${c.light}" stroke-width="7" stroke-linecap="round"/><path d="m189 201 41-17 115 4 26 24 1 58-25 29-100 15-54-21-18-44z" fill="#10170f" stroke="${c.light}" stroke-width="3"/><g fill="${c.accent}" color="${c.accent}">${eyes}</g><path d="m248 291 24 8 29-8" fill="none" stroke="${c.light}" stroke-width="6" stroke-linecap="round"/><path d="m285 296 12-4-6 16z" fill="#f4f4eb"/><circle cx="175" cy="185" r="6" fill="${c.light}"/><circle cx="382" cy="189" r="6" fill="${c.light}"/><path d="m153 212-20 7 2 54 26 8m237-66 22 9-2 49-18 8" fill="${c.accent}" ${stroke}/><path d="M142 234v25m267-25v25" stroke="${c.shade}" stroke-width="6" stroke-linecap="round"/><path d="m202 306 18 7m121-1 16-3" stroke="${c.light}" stroke-width="5" stroke-linecap="round"/>`;
 const label=`<rect x="208" y="493" width="148" height="34" rx="5" fill="#10170f" stroke="${b.glow}" stroke-width="1"/><text x="282" y="515" text-anchor="middle" fill="${b.glow}" font-family="monospace" font-size="16" letter-spacing="3">#${serial}</text><text x="39" y="518" fill="${b.glow}" font-family="monospace" font-size="8" letter-spacing="1">HUMANS COACH.</text><text x="521" y="518" text-anchor="end" fill="${b.glow}" font-family="monospace" font-size="8" letter-spacing="1">AGENTS COLLECT.</text>`;
 return {traits:t,background,body,headgear:ears,face,accessory:item,label};
}
export function nftSvg(tokenId:number):string{const p=nftSvgParts(tokenId);return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 560 560" width="560" height="560" role="img" aria-label="Nib Foundry ${tokenId}">${p.background}${p.headgear}${p.body}${p.face}${p.accessory}${p.label}</svg>`;}
export function nftMetadata(tokenId:number){const t=nftTraits(tokenId);return {name:`Nib Foundry #${String(tokenId).padStart(5,'0')}`,description:'An original Nib Foundry agent collectible from TapTap. A 10,000-piece generative robot collection on BNB Chain. Humans coach. Agents collect.',image:'data:image/svg+xml;utf8,'+encodeURIComponent(nftSvg(tokenId)),attributes:Object.entries(t).filter(([name])=>name!=='indexes').map(([name,value])=>({trait_type:name[0].toUpperCase()+name.slice(1),value})),external_url:'https://taptap-agent-arena.vercel.app/#collection'};}
