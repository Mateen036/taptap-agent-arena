/* TapTap i18n — English / 简体中文 toggle.
 * Client-side only. Dictionary: public/i18n-dict.js (English source text -> Chinese).
 * English is the source language: the DOM is authored in English and translated in place when "zh" is active,
 * including content the other scripts render later (a MutationObserver keeps new nodes translated, and the
 * original English is remembered per node so switching back restores it exactly).
 * Public API: window.TapTapI18n = { t, lang, setLang, apply, locale }.
 * Explicit hooks: data-i18n="English key" (replace text), data-i18n-attr="placeholder,title" (translate those attributes),
 * translate="no" (skip subtree). */
(function(){
'use strict';
var STORE='taptap.lang',SUPPORTED=['en','zh'];
var pairs=window.TAPTAP_I18N_PAIRS||[];
var exact=new Map(),templates=[];
function norm(s){return String(s).replace(/\s+/g,' ').trim();}
function esc(s){return s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');}
pairs.forEach(function(p){
  var en=norm(p[0]),zh=p[1];
  if(/\{[a-zA-Z]\w*\}/.test(en)){
    var names=[],src='^'+en.split(/(\{[a-zA-Z]\w*\})/).map(function(part){
      var m=/^\{([a-zA-Z]\w*)\}$/.exec(part);
      if(m){names.push(m[1]);return '(.+?)';}
      return esc(part);
    }).join('')+'$';
    templates.push({re:new RegExp(src,'i'),names:names,zh:zh,weight:en.replace(/\{[a-zA-Z]\w*\}/g,'').length});
  }else exact.set(en.toLowerCase(),zh);
});
templates.sort(function(a,b){return b.weight-a.weight;});

function lookup(core,depth){
  var hit=exact.get(core.toLowerCase());
  if(hit!==undefined)return hit;
  /* Trailing arrow glyphs ("Manage listing ↗") are decoration: translate the stem and keep the glyph. */
  var arrow=/\s*([↗→])$/.exec(core);
  if(arrow&&arrow.index>0){var stem=lookup(core.slice(0,arrow.index),depth);if(stem!==undefined)return stem+' '+arrow[1];}
  for(var i=0;i<templates.length;i++){
    var tpl=templates[i],m=tpl.re.exec(core);
    if(!m)continue;
    var vals={};
    for(var j=0;j<tpl.names.length;j++){
      var raw=m[j+1],tr=depth<2?lookup(raw,depth+1):undefined;
      vals[tpl.names[j]]=tr===undefined?raw:tr;
    }
    return tpl.zh.replace(/\{([a-zA-Z]\w*)\}/g,function(_,k){return k in vals?vals[k]:'';});
  }
  return undefined;
}
/* Translate a string, keeping its surrounding whitespace. Unknown text is returned unchanged. */
function translate(s){
  var m=/^(\s*)([\s\S]*?)(\s*)$/.exec(s);
  if(!m[2])return s;
  var out=lookup(norm(m[2]),0);
  return out===undefined?s:m[1]+out+m[3];
}
function interpolate(s,params){
  return params?s.replace(/\{([a-zA-Z]\w*)\}/g,function(x,k){return k in params?String(params[k]):x;}):s;
}

var lang='en';
function detect(){
  try{var saved=localStorage.getItem(STORE);if(SUPPORTED.indexOf(saved)>-1)return saved;}catch(e){}
  var nav=(navigator.languages&&navigator.languages[0])||navigator.language||'en';
  return /^zh/i.test(nav)?'zh':'en';
}
lang=detect();/* so t() is correct for strings built before DOMContentLoaded */
/* t(key, params): explicit translation helper for strings built in JS. */
function t(key,params){
  if(lang==='zh'){var out=lookup(norm(key),0);if(out!==undefined)return interpolate(out,params);}
  return interpolate(key,params);
}
function locale(fallback){return lang==='zh'?'zh-CN':(fallback||'en-US');}

var SKIP={SCRIPT:1,STYLE:1,NOSCRIPT:1};/* TEXTAREA text is user/agent content (e.g. the English pairing prompt); only its attributes are translated */
var ATTRS=['placeholder','title','aria-label','alt'];
var textRec=new WeakMap(),attrRec=new WeakMap();
function skipped(el){
  for(;el&&el.nodeType===1;el=el.parentElement){
    if(SKIP[el.tagName]||el.getAttribute('translate')==='no'||el.hasAttribute('data-no-i18n'))return true;
  }
  return false;
}
function doText(node){
  var p=node.parentElement;if(p&&p.tagName==='TEXTAREA')return;
  var rec=textRec.get(node),src=rec&&node.data===rec.out?rec.src:node.data;
  var out=lang==='zh'?translate(src):src;
  if(out!==node.data)node.data=out;
  if(out!==src||rec)textRec.set(node,{src:src,out:out});
}
function doAttrs(el){
  var rec=attrRec.get(el);if(!rec){rec={};attrRec.set(el,rec);}
  var names=ATTRS.slice();
  var extra=el.getAttribute('data-i18n-attr');if(extra)names=names.concat(extra.split(','));
  for(var i=0;i<names.length;i++){
    var n=names[i].trim();if(!el.hasAttribute(n))continue;
    var cur=el.getAttribute(n),r=rec[n],src=r&&cur===r.out?r.src:cur;
    var out=lang==='zh'?translate(src):src;
    if(out!==cur)el.setAttribute(n,out);
    if(out!==src||r)rec[n]={src:src,out:out};
  }
}
function doExplicit(el){
  var key=el.getAttribute('data-i18n');if(!key)return;
  var out=t(key);if(el.textContent!==out)el.textContent=out;
}
function walk(root){
  if(!root)return;
  if(root.nodeType===3){if(!skipped(root.parentElement))doText(root);return;}
  if(root.nodeType!==1)return;
  if(skipped(root))return;
  doAttrs(root);
  if(root.tagName==='TEXTAREA')return;
  doExplicit(root);
  var kids=root.childNodes;
  for(var i=0;i<kids.length;i++){
    var k=kids[i];
    if(k.nodeType===3)doText(k);
    else if(k.nodeType===1)walk(k);
  }
}
var observer=null,applying=false;
function run(fn){
  applying=true;
  try{fn();}finally{if(observer)observer.takeRecords();applying=false;}
}
function applyAll(){
  run(function(){
    walk(document.body);
    var title=document.querySelector('title');
    if(title&&title.firstChild)doText(title.firstChild);
    var meta=document.querySelectorAll('meta[name="description"],meta[property="og:title"],meta[property="og:description"],meta[name="twitter:title"],meta[name="twitter:description"]');
    for(var i=0;i<meta.length;i++)doAttrs2(meta[i]);
  });
}
function doAttrs2(el){
  var rec=attrRec.get(el);if(!rec){rec={};attrRec.set(el,rec);}
  var cur=el.getAttribute('content'),r=rec.content,src=r&&cur===r.out?r.src:cur;
  var out=lang==='zh'?translate(src):src;
  if(out!==cur)el.setAttribute('content',out);
  if(out!==src||r)rec.content={src:src,out:out};
}
function onMutations(list){
  if(applying)return;
  run(function(){
    for(var i=0;i<list.length;i++){
      var m=list[i];
      if(m.type==='characterData'){if(!skipped(m.target.parentElement))doText(m.target);}
      else if(m.type==='attributes'){if(m.target.nodeType===1&&!skipped(m.target))doAttrs(m.target);}
      else for(var j=0;j<m.addedNodes.length;j++)walk(m.addedNodes[j]);
    }
  });
}
function syncToggle(){
  var btns=document.querySelectorAll('[data-lang]');
  for(var i=0;i<btns.length;i++){
    var on=btns[i].getAttribute('data-lang')===lang;
    btns[i].setAttribute('aria-pressed',on?'true':'false');
    btns[i].classList.toggle('active',on);
  }
}
function setLang(next,persist){
  if(SUPPORTED.indexOf(next)<0)next='en';
  lang=next;
  document.documentElement.lang=lang==='zh'?'zh-CN':'en';
  if(persist!==false){try{localStorage.setItem(STORE,lang);}catch(e){}}
  syncToggle();
  applyAll();
  try{window.dispatchEvent(new CustomEvent('taptap:langchange',{detail:{lang:lang}}));}catch(e){}
}
function start(){
  lang=detect();
  document.documentElement.lang=lang==='zh'?'zh-CN':'en';
  document.addEventListener('click',function(e){
    var b=e.target.closest&&e.target.closest('[data-lang]');
    if(b)setLang(b.getAttribute('data-lang'));
  });
  syncToggle();
  applyAll();
  observer=new MutationObserver(onMutations);
  observer.observe(document.documentElement,{childList:true,subtree:true,characterData:true,attributes:true,attributeFilter:ATTRS.concat(['data-i18n'])});
}
window.TapTapI18n={t:t,lang:function(){return lang;},setLang:setLang,apply:applyAll,locale:locale,_translate:translate,_lookup:function(s){return lookup(norm(s),0);}};
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start);else start();
})();
