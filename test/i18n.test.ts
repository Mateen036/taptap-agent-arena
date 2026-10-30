import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

/** Load the browser i18n scripts into a sandbox with a minimal fake DOM. */
function load(language = 'en', stored: string | null = null) {
  const store = new Map<string, string>();
  if (stored) store.set('taptap.lang', stored);
  const doc: any = {
    readyState: 'complete', title: '', body: { nodeType: 1, tagName: 'BODY', childNodes: [], getAttribute: () => null, hasAttribute: () => false, parentElement: null }, documentElement: { lang: 'en', setAttribute(k: string, v: string) { (this as any)[k] = v; } },
    addEventListener() {}, querySelectorAll: () => [], querySelector: () => null,
  };
  const ctx: any = { document: doc, navigator: { language }, localStorage: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) }, console, setTimeout, clearTimeout };
  ctx.window = ctx; ctx.globalThis = ctx;
  ctx.CustomEvent = class { type: string; detail: any; constructor(type: string, init: any = {}) { this.type = type; this.detail = init.detail; } };
  ctx.dispatchEvent = () => true; ctx.addEventListener = () => {}; ctx.MutationObserver = class { observe() {} disconnect() {} takeRecords() { return []; } };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync('public/i18n-dict.js', 'utf8'), ctx);
  vm.runInContext(fs.readFileSync('public/i18n.js', 'utf8'), ctx);
  return ctx;
}

const base = load();
const pairs: [string, string][] = base.TAPTAP_I18N_PAIRS;
const I = base.TapTapI18n;
const placeholders = (s: string) => (s.match(/\{[a-zA-Z0-9_]+\}/g) || []).sort().join(',');

test('every dictionary entry has English and non-empty Chinese with valid placeholders', () => {
  assert.ok(pairs.length > 500);
  for (const p of pairs) {
    assert.ok(Array.isArray(p) && p.length === 2, 'entry must be [en, zh]: ' + JSON.stringify(p));
    const [en, zh] = p;
    assert.equal(typeof en, 'string'); assert.equal(typeof zh, 'string');
    assert.ok(en.trim(), 'empty English key'); assert.ok(zh.trim(), 'missing Chinese for: ' + en);
    if (zh !== en && /[A-Za-z]{2}/.test(en.replace(/\{\w+\}|\b(TAP|NIB|NFT|BNB|USDT|Gas|gas|NIB—000)\b/g, '').replace(/\b[A-Z]{2,}\b/g, '')) ) assert.match(zh, /[\u3000-\u303f\u4e00-\u9fff]/, 'Chinese text expected for: ' + en);
    // Chinese may drop English-only placeholders (e.g. a plural "s") but must never invent new ones.
    for (const ph of placeholders(zh).split(',').filter(Boolean)) assert.ok(placeholders(en).split(',').includes(ph), 'unknown placeholder ' + ph + ' for: ' + en);
  }
});

test('no duplicate English keys with conflicting translations', () => {
  const seen = new Map<string, string>();
  for (const [en, zh] of pairs) {
    const key = en.replace(/\s+/g, ' ').trim().toLowerCase();
    if (seen.has(key)) assert.equal(seen.get(key), zh, 'conflicting translations for: ' + en);
    seen.set(key, zh);
  }
});

test('glossary terms are used consistently', () => {
  const find = (en: string) => pairs.find(p => p[0] === en)?.[1];
  assert.equal(find('Rankings'), '排行榜');
  assert.equal(find('Mint'), '铸造');
  assert.equal(find('Convert'), '兑换');
  assert.equal(find('Docs'), '文档');
  for (const [en, zh] of pairs) for (const brand of ['TAP', 'NIB', 'NFT', 'BNB']) {
    if (en.split(' ').length <= 3 && new RegExp('\\b' + brand + '\\b').test(en)) assert.ok(zh.includes(brand), brand + ' must stay untranslated in: ' + en);
  }
});

test('engine translates, matches templates and is case/whitespace tolerant', () => {
  assert.equal(I._lookup('Rankings'), '排行榜');
  assert.equal(I._lookup('  rankings \n'), '排行榜');
  assert.equal(I._lookup('Totally new sentence nobody wrote'), undefined);
  assert.equal(I._translate('Totally new sentence nobody wrote'), 'Totally new sentence nobody wrote');
  assert.equal(I._translate('  Rankings '), '  排行榜 ', 'surrounding whitespace is kept');
  const tpl = pairs.find(p => p[0] === '{n} verified agent taps')!;
  const out = I._lookup('42 verified agent taps');
  assert.equal(out, tpl[1].replace('{n}', '42'));
  assert.equal(I.t('{n} verified agent taps', { n: 7 }), '7 verified agent taps', 'English t() interpolates');
  const c = load('zh-CN');
  assert.equal(c.TapTapI18n.t('{n} verified agent taps', { n: 7 }), tpl[1].replace('{n}', '7'));
});

test('language defaults to browser language, persists and is validated', () => {
  assert.equal(load('zh-CN').TapTapI18n.lang(), 'zh');
  assert.equal(load('zh-TW').TapTapI18n.lang(), 'zh');
  assert.equal(load('en-US').TapTapI18n.lang(), 'en');
  assert.equal(load('fr-FR').TapTapI18n.lang(), 'en');
  assert.equal(load('zh-CN', 'en').TapTapI18n.lang(), 'en', 'stored choice wins over navigator');
  assert.equal(load('en-US', 'zh').TapTapI18n.lang(), 'zh');
  const c = load('en-US');
  c.TapTapI18n.setLang('zh');
  assert.equal(c.localStorage.getItem('taptap.lang'), 'zh');
  assert.equal(c.document.documentElement.lang, 'zh-CN');
  assert.equal(c.TapTapI18n.t('Rankings'), '排行榜');
  c.TapTapI18n.setLang('en');
  assert.equal(c.document.documentElement.lang, 'en');
  assert.equal(c.TapTapI18n.t('Rankings'), 'Rankings');
});

/* ---------- coverage of static templates ---------- */
const WHITELIST = new Set(['EN', 'tt', 'tap', 'NIB', 'TAP', 'TAPTAP', 'BNB', 'USDT', 'contact@nibtap.site', 'X / Twitter', 'Telegram']);
const dec = (s: string) => s.replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&middot;/g, '·').replace(/&rarr;/g, '→').replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
function htmlTexts(html: string) {
  html = html.replace(/<!--[\s\S]*?-->/g, '').replace(/<svg class="sprite"[\s\S]*?<\/svg>/, '').replace(/<(script|style)[\s\S]*?<\/\1>/gi, '');
  const out: string[] = [];
  const push = (s: string) => { s = dec(s).replace(/\s+/g, ' ').trim(); if (s && /[A-Za-z]{2}/.test(s)) out.push(s); };
  const re = /<[^>]*>|[^<]+/g; let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    if (m[0][0] === '<') {
      if (/\btranslate="no"/.test(m[0])) continue;
      for (const a of m[0].matchAll(/\s(placeholder|title|aria-label|alt)="([^"]*)"/g)) push(a[2]);
    } else push(m[0]);
  }
  return out;
}
const covered = (s: string) => WHITELIST.has(s) || I._lookup(s.replace(/#+/g, '12')) !== undefined || I._lookup(s) !== undefined;

test('every visible string in the HTML templates has a Chinese translation', () => {
  const missing = new Set<string>();
  for (const f of ['ui/index.html', 'ui/nft.html']) for (const s of htmlTexts(fs.readFileSync(f, 'utf8'))) if (!covered(s)) missing.add(f + ': ' + s);
  assert.deepEqual([...missing], []);
});

test('language switch is present in the header and loaded on every page shell', () => {
  const html = fs.readFileSync('ui/index.html', 'utf8');
  assert.match(html, /data-lang="en"/); assert.match(html, /data-lang="zh"/);
  assert.match(html, /\/i18n-dict\.js/); assert.match(html, /\/i18n\.js/); assert.match(html, /\/i18n\.css/);
  for (const f of ['app/layout.tsx', 'deploy/vercel/app/layout.tsx']) {
    const src = fs.readFileSync(f, 'utf8');
    assert.match(src, /i18n-dict\.js/); assert.match(src, /i18n\.js/); assert.match(src, /suppressHydrationWarning/);
  }
});

/* ---------- coverage of strings the frontend scripts inject at runtime ---------- */
function scriptStrings(file: string) {
  const code = fs.readFileSync(file, 'utf8');
  const sf = ts.createSourceFile(file, code, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const out = new Set<string>();
  const add = (s: string) => { s = dec(s).replace(/\s+/g, ' ').trim(); if (s && /[A-Za-z]{2,}/.test(s)) out.add(s); };
  const html = (s: string) => { for (const t of htmlTexts(s.replace(/\u0000/g, '\u0001'))) out.add(t); };
  const visit = (n: ts.Node) => {
    if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) {
      const v = n.text;
      // 'Part one. ' + variable: the assembled sentence is what reaches the DOM (and is covered as a whole), so skip operands.
      if (ts.isBinaryExpression(n.parent) && n.parent.operatorToken.kind === ts.SyntaxKind.PlusToken && !(ts.isStringLiteral(n.parent.left) && ts.isStringLiteral(n.parent.right))) return;
      if (/<\w/.test(v)) html(v);
      else if ((/^[A-Z“‘’0-9≈+\-#(]/.test(v) && /[A-Za-z]{3,}/.test(v) && (/[ .!?…]|^[A-Z][a-z]+$/.test(v)) && !/^[A-Z_]+$/.test(v)) || /^[A-Z]{3,}( [A-Z·→0-9]+)*$/.test(v)) add(v);
    } else if (ts.isTemplateExpression(n)) {
      const parts = [n.head.text, ...n.templateSpans.map(s => s.literal.text)];
      const joined = parts.join('\u0000');
      if (joined.includes('<')) html(joined); else if (/ /.test(joined)) add(joined);
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return out;
}
// Strings in public/*.js that look like prose but are not shown to people, or are intentionally English
// (agent-facing instructions, CLI commands, trait names from the on-chain art).
// Strings with embedded expressions are often translated per fragment (text nodes are split by markup); check each piece.
const pieces = (s: string) => s.split(/[\u0000\u0001]+/).map(x => x.replace(/^[\s,.:·–/%+0-9-]+|[\s,.:·–/%+0-9-]+$/g, '')).filter(x => /[A-Za-z]{3}/.test(x));
// Does any combination of "expression present / absent" for the embedded-expression markers match a dictionary entry?
function coveredWithOptionalParts(s: string) {
  const parts = s.split(/[\u0000\u0001]/);
  const n = Math.min(parts.length - 1, 10);
  for (let mask = 0; mask < (1 << n); mask++) {
    let out = parts[0];
    for (let i = 1; i < parts.length; i++) out += ((i - 1 < n && (mask >> (i - 1)) & 1) || i - 1 >= n ? '12' : '') + parts[i];
    if (covered(out)) return true;
  }
  return false;
}
const SCRIPT_IGNORE_EXACT = new Set([
  // Fragments of longer sentences that the dictionary covers as a whole (the DOM text node is the whole sentence).
  ', blocks \u0000–\u0000', 'stays in your wallet until an eligible agent buys it. You receive the price minus a 2% seller fee. The buyer pays the price plus a separate 2% buyer fee.',
  '(prefers-reduced-motion: reduce)', '(hover: hover) and (pointer: fine)', // media queries
]);
// Agent-facing instructions and CLI commands are intentionally English (the agent reads them, not the human).
const AGENT_FACING = /^(Connect my Binance Agentic Wallet|Claim my NIB airdrop conversion|node taptap-agent\.mjs)|signed action nib-bid-/;
const SCRIPT_IGNORE = /^(GET|POST|UTC|PUT|DELETE|Content-Type|#[\w-]+ \w+)$/;

test('UI strings written in the frontend scripts have a Chinese translation', () => {
  const missing: string[] = [];
  for (const f of ['app', 'convert', 'nft', 'nibmarket', 'utility', 'motion']) {
    for (const s of scriptStrings(`public/${f}.js`)) {
      if (SCRIPT_IGNORE.test(s) || SCRIPT_IGNORE_EXACT.has(s) || AGENT_FACING.test(s)) continue;
      const probe = s.replace(/[#\u0000\u0001]+/g, '12');
      if (!covered(probe) && !covered(s) && !coveredWithOptionalParts(s) && !pieces(s).every(covered)) missing.push(`${f}.js: ${s}`);
    }
  }
  assert.deepEqual(missing, []);
});
