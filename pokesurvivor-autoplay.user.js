// ==UserScript==
// @name         PokéSurvivor iPhone 自動遊玩
// @namespace    pokesurvivor-bot
// @version      1.4.24
// @description  依體型預判躲彈與敵人追擊、散射彈幕走位、地形風箏、冷卻選招、自動使用祭壇、開箱與進裂縫打王；觸控優先，可重新載入 Bot，單人背景續跑可切換（受瀏覽器限制），附穩定啟動與 GF 更新入口。
// @match        https://pokesurvivor.com/*
// @match        https://www.pokesurvivor.com/*
// @updateURL    https://update.greasyfork.org/scripts/600296/Pok%C3%A9Survivor%20iPhone%20%E8%87%AA%E5%8B%95%E9%81%8A%E7%8E%A9.meta.js
// @downloadURL  https://update.greasyfork.org/scripts/600296/Pok%C3%A9Survivor%20iPhone%20%E8%87%AA%E5%8B%95%E9%81%8A%E7%8E%A9.user.js
// @license      MIT
// @run-at       document-start
// @weight       999
// @inject-into  page
// @grant        none
// ==/UserScript==

(async () => {
  'use strict';
  if (window.top !== window.self) return;
  const VERSION = '1.4.24';
  const UPDATE_URL = 'https://update.greasyfork.org/scripts/600296/Pok%C3%A9Survivor%20iPhone%20%E8%87%AA%E5%8B%95%E9%81%8A%E7%8E%A9.user.js';
  const existing = window.PokeSurvivorBot;
  if (existing?.version === VERSION) { existing.reload(); return; }
  const carry = existing?.handoff?.();
  if (existing && !carry) return; // Older versions need one full refresh to upgrade.

  // The guide has no game runtime. On this explicit entry route, defer all game
  // scripts until this local userscript has installed its capture and controls.
  // This works even if Safari starts the userscript after DOMContentLoaded.
  const launchURL = typeof window.location?.href === 'string' ? new URL(window.location.href) : null;
  const controlledLaunch = launchURL?.pathname === '/guia/' && launchURL.searchParams.get('poke-bot-launch') === '1';
  let pageScripts = null;
  let launchState = 'normal';
  if (controlledLaunch) {
    if (window.__pokeSurvivorLaunch) return;
    window.__pokeSurvivorLaunch = {state:'preparing',version:VERSION};
    try { pageScripts = await prepareControlledLaunch(); launchState = 'prepared'; }
    catch (e) { window.__pokeSurvivorLaunch.state = 'failed'; showLaunchMessage(`穩定啟動失敗：${e.message}。請重新整理此入口重試，或返回遊戲首頁。`); return; }
  }

  function showLaunchMessage(message) {
    let note = document.getElementById('poke-bot-launch-message');
    if (!note) {
      note = document.createElement('p'); note.id = 'poke-bot-launch-message';
      note.style.cssText = 'position:fixed;z-index:2147483647;top:16px;left:16px;right:16px;padding:16px;border-radius:12px;background:#152937;color:#e7efff;font:16px/1.6 -apple-system,sans-serif';
      (document.body || document.documentElement).appendChild(note);
    }
    note.textContent = message;
  }
  async function prepareControlledLaunch() {
    if (document.readyState === 'loading') await new Promise(resolve => document.addEventListener('DOMContentLoaded',resolve,{once:true}));
    if ([...document.scripts].some(s => s.src && /\/js\/app\.min\.js(?:[?#]|$)/.test(s.src))) throw Error('入口頁已包含遊戲程式，請使用 /guia/ 穩定啟動入口');
    showLaunchMessage('穩定啟動：準備遊戲畫面…');
    const gameURL = new URL('/',window.location.href);
    const controller = new AbortController();
    const deadline = setTimeout(()=>controller.abort(),30000);
    let response, html;
    try {
      response = await fetch(gameURL.href,{credentials:'same-origin',cache:'no-store',signal:controller.signal});
      if (!response.ok) throw Error(`遊戲頁面 HTTP ${response.status}`);
      html = await response.text();
    }
    finally { clearTimeout(deadline); }
    const sourceURL = new URL(response.url || gameURL.href);
    if (sourceURL.origin !== gameURL.origin) throw Error('遊戲頁面重新導向其他網域');
    const parsed = new DOMParser().parseFromString(html,'text/html');
    const scripts = [];
    for (const el of [...parsed.querySelectorAll('script')]) {
      const type = (el.getAttribute('type') || '').trim().toLowerCase();
      if (type && !['text/javascript','application/javascript','module'].includes(type)) continue;
      const src = el.getAttribute('src');
      const url = src ? new URL(src,sourceURL.href) : null;
      if (url && url.origin !== gameURL.origin) throw Error('遊戲頁含有其他網域的程式，停止載入');
      scripts.push({src:url?.href || '',text:el.textContent,attrs:[...el.attributes].filter(a=>!['src','async','defer'].includes(a.name)).map(a=>[a.name,a.value])});
      el.remove();
    }
    if (scripts.filter(s=>s.src && new URL(s.src).pathname === '/js/app.min.js').length !== 1) throw Error('找不到唯一的官方遊戲程式');
    // Verify that script elements execute in this world before replacing the
    // document. A content-world bot could not observe the page's Object prototype.
    const probeKey = `__pokeBotProbe${Date.now()}`;
    window[probeKey] = true;
    const probe = document.createElement('script');
    probe.textContent = `document.currentScript.setAttribute('data-poke-bot-world',window[${JSON.stringify(probeKey)}]===true?'page':'content');`;
    try { (document.head || document.documentElement).appendChild(probe); }
    finally { delete window[probeKey]; }
    const world = probe.getAttribute('data-poke-bot-world'); probe.remove();
    if (world !== 'page') throw Error(world === 'content' ? '腳本在隔離環境執行，請保留 @inject-into page' : '網站阻止頁面程式執行，無法建立穩定載入順序');
    parsed.querySelectorAll('base').forEach(el=>el.remove());
    const base = parsed.createElement('base'); base.href = sourceURL.href; parsed.head.prepend(base);
    document.replaceChild(document.importNode(parsed.documentElement,true),document.documentElement);
    return scripts;
  }
  async function releasePageScripts(scripts) {
    for (const spec of scripts) {
      if (stopped) throw Error('Bot 已移除，取消啟動');
      const script = document.createElement('script');
      for (const [name,value] of spec.attrs) script.setAttribute(name,value);
      script.async = false;
      if (spec.src) {
        await new Promise((resolve,reject)=>{
          const timeout = setTimeout(()=>{script.remove();reject(Error('官方遊戲程式載入逾時，請重新整理穩定入口'));},30000);
          script.onload = ()=>{clearTimeout(timeout);resolve();};
          script.onerror = ()=>{clearTimeout(timeout);reject(Error('官方遊戲程式載入失敗'));};
          script.src = spec.src; document.head.appendChild(script);
        });
        // locales.js uses parser-time document.write. Browsers may ignore it
        // when this entry inserts scripts after load; load the native dictionary
        // before app.min.js if it did not arrive. Never choose a language here.
        const localeURL=new URL(spec.src);
        const lang=window.PS_LOCALES?.lang;
        if(localeURL.pathname==='/js/core/locales.js' &&
          ['fr','it','pt-BR','zh-Hans','zh-Hant'].includes(lang) &&
          !window.PS_LANG_Q?.some(entry=>entry[1]===lang)) {
          const dictURL=new URL(`/js/lang/${lang}.js`,localeURL);
          dictURL.search=localeURL.search;
          await releasePageScripts([{src:dictURL.href,attrs:[]}]);
        }
      } else { script.textContent = spec.text; document.head.appendChild(script); }
    }
  }

  // The production bundle closes over G. Observe its Game assignment before
  // deferred scripts run, then immediately remove the temporary accessor.
  let capturedGame = carry?.game || null;
  const captureCandidates = [];
  const injectionState = document.readyState || 'unknown';
  let startedAt = performance.now();
  let captureSetter = null;
  let captureIssue = '';
  function missingInterface(g) {
    return [!g?.Game && 'Game', typeof g?.Input?.axis !== 'function' && 'Input.axis',
      typeof g?.LevelUp?.offer !== 'function' && 'LevelUp.offer', !g?.RunUI && 'RunUI'].filter(Boolean);
  }
  function findInterface() {
    const candidates = [capturedGame, window.G, ...captureCandidates].filter(Boolean);
    return candidates.find(g => !missingInterface(g).length);
  }
  function releaseCapture() {
    const descriptor = Object.getOwnPropertyDescriptor(Object.prototype, 'Game');
    if (captureSetter && descriptor?.set === captureSetter) delete Object.prototype.Game;
    captureSetter = null;
  }
  function armCapture() {
    releaseCapture(); startedAt = performance.now();
    captureIssue = '';
    if (findInterface()) return;
    if (Object.getOwnPropertyDescriptor(Object.prototype, 'Game')) {
      captureIssue = '介面偵測被其他腳本占用'; return;
    }
    captureSetter = function (value) {
      Object.defineProperty(this, 'Game', { value, configurable: true, enumerable: true, writable: true });
      if (typeof value?.startRun === 'function') {
        // Game may be assigned before Input/LevelUp/RunUI on newer builds.
        // Keep candidates and validate on subsequent ticks instead of missing it.
        if (!captureCandidates.includes(this) && captureCandidates.length < 8) captureCandidates.push(this);
        if (!missingInterface(this).length) { capturedGame = this; releaseCapture(); }
      }
    };
    Object.defineProperty(Object.prototype, 'Game', {
      configurable: true, enumerable: false, get() { return undefined; }, set: captureSetter
    });
  }
  armCapture();
  function initializationStatus(now) {
    if (controlledLaunch && launchState === 'loading-game') return `穩定啟動（${VERSION}）：Bot 已就緒，載入官方遊戲…`;
    const elapsed = Math.floor((now-startedAt)/1000);
    const candidate = capturedGame || window.G || captureCandidates[0];
    const detail = captureIssue || (candidate ? `缺少 ${missingInterface(candidate).join('、')}`
      : injectionState === 'complete' ? '注入時網頁已載入，可能錯過初始化' : '尚未偵測到遊戲介面；請確認 page 注入');
    return elapsed >= 30
      ? `未取得介面（${VERSION}）：${detail}。請選「穩定啟動」先準備 Bot 再載入遊戲（會結束本局），或完整重新整理。`
      : `等待遊戲初始化（${VERSION}）${elapsed}/30 秒 · ${detail}`;
  }
  const key = 'pokesurvivor-autoplay-v1';
  let settings = { enabled: false, restart: false, manualPoints: false, background: true, collapsed: false, position: null };
  const restoreSettings = saved => {
    if (!saved || typeof saved !== 'object') return;
    for (const name of Object.keys(settings)) {
      if (Object.prototype.hasOwnProperty.call(saved,name)) settings[name] = saved[name];
    }
  };
  try { restoreSettings(JSON.parse(localStorage.getItem(key) || '{}')); } catch (_) {}
  restoreSettings(carry?.settings);
  let backgroundRunner = null;
  let game, originalAxis, originalOffer, hookedAxis, hookedOffer;
  let dodgeStop = null;
  let vector = [0, 0], offers = carry?.offers || [], offered = carry?.offered || null, lastChoice = 0;
  let rerollState = carry?.rerollState || {player:null,level:null,attempts:0,offers:null};
  let damagePlan = {known:false,insufficient:false}, damageHistory = [], damagePlayer = null;
  let manualUntil = 0, overSince = 0, lastThink = 0, lastStatus = 0;
  let bondPlayer = null, originalBondOptions, hookedBondOptions;
  let originalBond, hookedBond, bondChoice = carry?.bondChoice || null;
  let originalItem, hookedItem, itemChoice = carry?.itemChoice || null;
  let turrets = [], seenCasts = new Map();
  let terrain = null, escapeState = '', objectiveScan = null;
  let projectileCoverCache = new Map();
  let coverLifetimeCache = new Map();
  let chestSiteCache = new WeakMap();
  const terrainDirections = [[1,0],[-1,0],[0,1],[0,-1],[1,1],[1,-1],[-1,1],[-1,-1]];
  let lastSwitch = -Infinity, switchCommitUntil = 0, tactic = '', rotation = '', reloadUntil = 0;
  let previousPlayer = null, trail = [], error = '', stopped = false;
  const held = new Set();
  const root = document.createElement('div');
  root.id = 'pokesurvivor-bot';
  root.style.cssText = 'position:fixed;z-index:2147483647;right:max(12px,env(safe-area-inset-right));bottom:max(12px,env(safe-area-inset-bottom));touch-action:manipulation;--bot-safe-left:env(safe-area-inset-left,0px);--bot-safe-right:env(safe-area-inset-right,0px);--bot-safe-top:env(safe-area-inset-top,0px);--bot-safe-bottom:env(safe-area-inset-bottom,0px)';
  const shadow = root.attachShadow({ mode: 'open' });
  shadow.innerHTML = `<style>
    :host{all:initial;color-scheme:dark;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#e7efff;font-size:12px;line-height:1.4}
    *{box-sizing:border-box}button,.update-link{font:inherit;cursor:pointer;touch-action:manipulation;-webkit-tap-highlight-color:transparent}
    .panel{display:flex;flex-direction:column;max-height:calc(100vh - 24px - env(safe-area-inset-bottom));max-height:min(var(--bot-height,100dvh),calc(100dvh - 24px - env(safe-area-inset-bottom)));width:min(282px,var(--bot-width,calc(100vw - 24px)));border:1px solid #6d9bba55;border-radius:20px;overflow:hidden;background:linear-gradient(145deg,#172b3bf5,#0d1826fa);box-shadow:0 12px 36px #0007,inset 0 1px #ffffff12;backdrop-filter:blur(16px);-webkit-backdrop-filter:blur(16px)}
    .panel[hidden],#restore[hidden]{display:none}#drag-handle{touch-action:none;user-select:none;-webkit-user-select:none;cursor:grab;min-height:44px}:host([data-dragging=true]) #drag-handle{cursor:grabbing}#restore{display:flex;align-items:center;justify-content:center;position:relative;width:52px;height:52px;padding:0;min-height:52px;border-radius:50%;background:linear-gradient(145deg,#244650,#102331);border:1px solid #7da4b87a;box-shadow:0 6px 22px #0006;touch-action:none}#restore .mini-dot{position:absolute;right:2px;bottom:3px;width:10px;height:10px;border-radius:50%;border:2px solid #152937;background:#8298ac}:host([data-running=true]) #restore{border-color:#7ce0c5}:host([data-running=true]) #restore .mini-dot{background:#7ce0c5}
    header{display:flex;flex-shrink:0;align-items:center;gap:8px;padding:12px 12px 9px}.brand{flex:1;display:flex;gap:8px;align-items:center;min-width:0}.ball{width:24px;height:24px;flex:none;border:2px solid #b8cedc;border-radius:50%;background:linear-gradient(#67d4bc 43%,#b8cedc 43%,#b8cedc 56%,#1d3546 56%);position:relative}.ball:after{content:"";position:absolute;left:6px;top:6px;width:8px;height:8px;border:2px solid #b8cedc;border-radius:50%;background:#152937}.brand strong{font-size:12px;letter-spacing:.5px}.version{display:block;font-size:9px;letter-spacing:1.4px;color:#88a8bc}
    button{border:1px solid #67849e55;color:#d7e5f2;background:#20394b;min-height:44px;border-radius:12px;padding:8px 10px;transition:background .15s,transform .15s}button:active{transform:scale(.96)}button:focus-visible{outline:2px solid #7ce0c5;outline-offset:2px}
    .update-link{display:flex;align-items:center;justify-content:center;min-height:44px;margin-top:7px;border:1px solid #67849e55;border-radius:12px;background:#20394b;color:#bde9dc;text-decoration:none;font-size:11px}.update-link[hidden]{display:none}.update-link:active{background:#2c514f}.update-link:focus-visible{outline:2px solid #7ce0c5;outline-offset:2px}.update-note{margin:5px 1px 0;color:#8aabba;font-size:10px;text-align:center}
    #toggle{font-weight:700;background:#294457;min-width:83px;font-size:11px}#toggle[aria-pressed=true]{color:#102d27;background:#7ce0c5;border-color:#a4f4df;box-shadow:0 2px 12px #65e1bc20}#fold{min-width:30px;padding:4px;border:0;background:transparent;color:#9cb6c9;font-size:19px}
    .summary{display:flex;flex-shrink:0;align-items:center;gap:7px;padding:0 14px 11px}.dot{width:6px;height:6px;flex:none;border-radius:50%;background:#8298ac}:host([data-running=true]) .dot{background:#7ce0c5;box-shadow:0 0 9px #7ce0c577}#status{margin:0;color:#a9c1d3;font-size:11px;overflow-wrap:anywhere}
    .body{min-height:0;overflow-y:auto;overscroll-behavior:contain;border-top:1px solid #65849a2b;padding:12px}.body[hidden]{display:none}.row{display:flex;align-items:center;justify-content:space-between;gap:8px}.label{color:#8faabe;font-size:10px;letter-spacing:1px}.hp-value{font-variant-numeric:tabular-nums;color:#c5e7d9;font-size:11px}.hp-track{height:4px;background:#2b4253;border-radius:5px;overflow:hidden;margin:6px 0 12px}.hp-fill{height:100%;width:0;background:linear-gradient(90deg,#45bca0,#a4edb9);transition:width .3s}
    #tactic{color:#d5c296;font-size:11px}.slots{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:5px;margin:7px 0 12px}.slot{position:relative;min-height:62px;padding:7px 5px;border:1px solid #5b81953b;border-radius:10px;background:#0b1a2b85;overflow:hidden}.slot[data-active=true]{border-color:#7ce0c5aa;background:#244b4c77;box-shadow:inset 0 0 14px #79e8ce09}.slot-number{font-size:9px;color:#7799b0}.slot-name{display:block;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;font-size:10px;color:#dce9f2;margin:2px 0}.slot-cd{color:#8da8bd;font-size:9px;font-variant-numeric:tabular-nums}.slot[data-active=true] .slot-cd{color:#8fe2c7}.cd-track{position:absolute;height:2px;background:#68cdb1;bottom:0;left:0;width:0;transition:width .12s}
    .rotation-note{margin:-5px 0 10px;color:#7fa6be;font-size:10px}.actions{display:grid;grid-template-columns:1fr 1fr;gap:7px}.actions button{font-size:11px}#restart[aria-pressed=true]{background:#4d4532;border-color:#c8ac6a88;color:#ffe2a0}#reload{background:#284457;color:#d8eafa}.hint{margin:9px 1px 0;color:#6f91a8;font-size:10px;text-align:center}
    @media(max-height:430px){header{padding:8px 10px 6px}.body{padding:9px 10px}.slots{margin-bottom:9px}.slot{min-height:54px;padding:5px}.hp-track{margin-bottom:8px}.hint{display:none}}
    @media(prefers-reduced-motion:reduce){*{transition:none!important}}
  </style><div class="panel">
    <header><div id="drag-handle" class="brand" title="拖曳標題移動面板"><span class="ball" aria-hidden="true"></span><div><strong>POKÉ PILOT</strong><span class="version">BOT · ${VERSION}</span></div></div><button id="toggle" aria-pressed="false">自動：關</button><button id="fold" aria-label="縮到最小" title="縮成浮動按鈕" aria-expanded="true">−</button></header>
    <div class="summary"><span class="dot" aria-hidden="true"></span><p id="status" role="status" aria-live="polite">等待遊戲載入…</p></div>
    <div class="body"><div class="row"><span class="label">HP</span><span id="hp" class="hp-value">— / —</span></div><div class="hp-track"><div id="hp-fill" class="hp-fill"></div></div>
    <div class="row"><span class="label">招式輪替</span><span id="tactic">準備就緒</span></div><div class="slots">
    ${[0, 1, 2, 3].map(i => `<div id="slot-${i}" class="slot" data-active="false"><span class="slot-number">0${i + 1}</span><span id="move-${i}" class="slot-name">空槽</span><span id="cd-${i}" class="slot-cd">—</span><div id="bar-${i}" class="cd-track"></div></div>`).join('')}
    </div><p id="rotation" class="rotation-note">等待目標</p><div class="actions"><button id="restart" aria-pressed="false">自動重開：關</button><button id="manual-points" aria-pressed="false" title="單人手動選牌、重抽、融合與道具；自動走位和戰鬥繼續">手動加點：關</button><button id="reload">↻ 重新載入 Bot</button><button id="background" aria-pressed="true" title="單人背景續跑；iPhone 切換 App、鎖屏或系統掛起後仍可能停止">背景續跑：開</button></div><p class="update-note">背景續跑受瀏覽器限制；多人背景維持原暫停機制</p><a id="stable" class="update-link" href="/guia/?poke-bot-launch=1" title="重新開啟穩定入口，先準備 Bot 再載入遊戲；目前本局會結束">穩定啟動 · 重開網頁</a><a id="update" class="update-link" href="${UPDATE_URL}" target="_blank" rel="noopener noreferrer" title="開啟 Greasy Fork 最新腳本，由 Userscripts 確認更新；更新後請重整遊戲以載入新版" aria-describedby="update-note">↑ 更新版本 · Greasy Fork ↗</a><p id="update-note" class="update-note">新分頁確認更新；套用新版需重整遊戲</p><p class="hint">觸控移動優先 · 重新載入保留本局</p></div>
  </div><button id="restore" hidden aria-label="展開 Bot 面板" title="點一下展開；拖曳可移動"><span class="ball" aria-hidden="true"></span><span class="mini-dot" aria-hidden="true"></span></button>`;
  const $ = id => shadow.getElementById(id);
  const persist = () => { try { localStorage.setItem(key, JSON.stringify(settings)); } catch (_) {} };
  persist(); // Drop retired settings while preserving the supported preferences.
  function controls() {
    $('toggle').textContent = `自動：${settings.enabled ? '開' : '關'}`;
    $('toggle').setAttribute('aria-pressed', String(settings.enabled));
    renderRestart();
    renderManualPoints();
    renderReload();
    $('background').textContent = `背景續跑：${settings.background ? '開' : '關'}`;
    $('background').setAttribute('aria-pressed', String(settings.background));
    backgroundRunner?.sync();
    if ($('stable')) $('stable').hidden = !!game || controlledLaunch;
    root.setAttribute('data-running', String(settings.enabled));
    shadow.querySelector('.body').hidden = settings.collapsed;
    shadow.querySelector('.panel').hidden = settings.collapsed;
    $('restore').hidden = !settings.collapsed;
    $('restore').setAttribute('aria-label',`展開 Bot 面板（自動${settings.enabled ? '開啟' : '關閉'}）`);
    $('fold').textContent = settings.collapsed ? '+' : '−';
    $('fold').setAttribute('aria-expanded', String(!settings.collapsed));
    $('fold').setAttribute('aria-label', settings.collapsed ? '展開面板' : '縮到最小');
    placePanel();
  }
  $('toggle').onclick = () => { settings.enabled = !settings.enabled; vector = [0, 0]; error = ''; persist(); controls(); };
  $('restart').onclick = () => { if (multiplayer()) return; settings.restart = !settings.restart; overSince = 0; persist(); controls(); };
  $('manual-points').onclick = () => { if(multiplayer()) return; settings.manualPoints=!settings.manualPoints; persist(); controls(); };
  $('background').onclick = () => { settings.background = !settings.background; vector = [0,0]; persist(); controls(); };
  $('fold').onclick = () => { settings.collapsed = !settings.collapsed; persist(); controls(); };
  $('reload').onclick = () => {
    if (needsFreshPage()) {
      // Navigate only after an explicit click. A fresh top-level URL may avoid
      // a cached document, but does not guarantee Safari injects before Game.
      const url = new URL(window.location.href);
      url.searchParams.set('_bot_reconnect',String(Date.now()));
      window.location.assign(url.href);
    } else reloadBot();
  };
  function needsFreshPage() {
    return !game && performance.now()-startedAt >= 30000 && typeof window.location?.assign === 'function';
  }
  function renderReload() {
    const fresh = needsFreshPage();
    $('reload').textContent = fresh ? '↻ 重開網頁連接（結束本局）' : '↻ 重新載入 Bot';
    $('reload').title = fresh ? '重新開啟遊戲網頁以重試初始化；目前未結束的遊戲進度可能遺失' : '重設 Bot，保留目前遊戲；不下載新版';
  }
  let panelDrag = null, suppressRestoreUntil = 0;
  function panelBounds() {
    const view = window.visualViewport;
    const css = typeof getComputedStyle === 'function' ? getComputedStyle(root) : null;
    const inset = edge => Math.max(12, parseFloat(css?.getPropertyValue('--bot-safe-' + edge)) || 0);
    const width = view?.width || window.innerWidth || 1024, height = view?.height || window.innerHeight || 768;
    const left = (view?.offsetLeft || 0) + inset('left'), top = (view?.offsetTop || 0) + inset('top');
    const usableWidth = Math.max(1, width - inset('left') - inset('right'));
    const usableHeight = Math.max(1, height - inset('top') - inset('bottom'));
    root.style.setProperty('--bot-width', usableWidth + 'px');
    root.style.setProperty('--bot-height', usableHeight + 'px');
    const rect = root.getBoundingClientRect();
    return {left, top, right:left + Math.max(0, usableWidth - rect.width), bottom:top + Math.max(0, usableHeight - rect.height)};
  }
  function placePanel(position = settings.position) {
    if (!root.isConnected) return;
    const bounds = panelBounds();
    const x = Number.isFinite(position?.x) ? Math.max(0,Math.min(1,position.x)) : 1;
    const y = Number.isFinite(position?.y) ? Math.max(0,Math.min(1,position.y)) : 1;
    root.style.left = (bounds.left + (bounds.right-bounds.left)*x) + 'px';
    root.style.top = (bounds.top + (bounds.bottom-bounds.top)*y) + 'px';
    root.style.right = 'auto'; root.style.bottom = 'auto';
  }
  function startPanelDrag(e) {
    if (e.isPrimary === false || (e.button != null && e.button !== 0) || panelDrag) return;
    if (!Number.isFinite(e.clientX) || !Number.isFinite(e.clientY)) return;
    e.preventDefault(); e.stopPropagation();
    const rect = root.getBoundingClientRect();
    panelDrag = {id:e.pointerId,handle:e.currentTarget,x:e.clientX,y:e.clientY,left:rect.left,top:rect.top,moved:false};
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch (_) {}
  }
  function movePanelDrag(e) {
    if (!panelDrag || e.pointerId !== panelDrag.id) return;
    e.preventDefault(); e.stopPropagation();
    const dx=e.clientX-panelDrag.x,dy=e.clientY-panelDrag.y;
    if (!panelDrag.moved && Math.hypot(dx,dy)<5) return;
    panelDrag.moved=true; root.setAttribute('data-dragging','true');
    const b=panelBounds(),x=Math.max(b.left,Math.min(b.right,panelDrag.left+dx)),y=Math.max(b.top,Math.min(b.bottom,panelDrag.top+dy));
    const position={x:b.right===b.left?0:(x-b.left)/(b.right-b.left),y:b.bottom===b.top?0:(y-b.top)/(b.bottom-b.top)};
    settings.position=position; placePanel(position);
  }
  function finishPanelDrag(e) {
    if (!panelDrag || e.pointerId !== panelDrag.id) return;
    const drag=panelDrag; panelDrag=null; root.setAttribute('data-dragging','false');
    if (drag.moved) {suppressRestoreUntil=performance.now()+450;persist();}
    try { drag.handle.releasePointerCapture(drag.id); } catch (_) {}
  }
  for (const handle of [$('drag-handle'),$('restore')]) {
    handle.addEventListener('pointerdown',startPanelDrag);
    handle.addEventListener('pointermove',movePanelDrag);
    for (const type of ['pointerup','pointercancel','lostpointercapture']) handle.addEventListener(type,finishPanelDrag);
  }
  $('restore').onclick = () => {
    if (performance.now()<suppressRestoreUntil) return;
    settings.collapsed=false; persist(); controls();
  };
  function onPanelResize() {
    if (panelDrag) finishPanelDrag({pointerId:panelDrag.id});
    placePanel();
  }
  addEventListener('resize',onPanelResize); addEventListener('orientationchange',onPanelResize);
  window.visualViewport?.addEventListener('resize',onPanelResize);
  window.visualViewport?.addEventListener('scroll',onPanelResize);
  // Do not let touches on the panel activate the game's floating joystick.
  for (const type of ['touchstart', 'touchmove', 'touchend', 'pointerdown', 'pointermove', 'pointerup', 'mousedown', 'click']) {
    root.addEventListener(type, e => e.stopPropagation());
  }
  const movementKeys = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']);
  const onDown = e => { if (movementKeys.has(e.code)) { held.add(e.code); manualUntil = performance.now() + 1800; } };
  const onUp = e => { held.delete(e.code); };
  const onBlur = () => { held.clear(); vector = [0, 0]; if (panelDrag) finishPanelDrag({pointerId:panelDrag.id}); };
  addEventListener('keydown', onDown); addEventListener('keyup', onUp); addEventListener('blur', onBlur);
  const visible = id => {
    const el = document.getElementById(id);
    return el && !el.classList.contains('hidden') && el.getClientRects().length > 0;
  };
  function multiplayer() { return !!(game?.Coop?.active || game?.Social?.room); }
  function renderManualPoints() {
    const multi=multiplayer(),button=$('manual-points');
    button.disabled=multi;
    button.textContent=multi?'多人：手動加點':`手動加點：${settings.manualPoints?'開':'關'}`;
    button.setAttribute('aria-pressed',String(multi || settings.manualPoints));
  }
  function renderRestart() {
    const multi = multiplayer();
    $('restart').disabled = multi;
    $('restart').textContent = multi ? '多人：手動重開' : `自動重開：${settings.restart ? '開' : '關'}`;
    $('restart').setAttribute('aria-pressed', String(!multi && settings.restart));
  }
  function blocked() {
    return (document.hidden && !backgroundAllowed()) || visible('rotate') || held.size > 0 || performance.now() < manualUntil;
  }
  function backgroundAllowed() { return settings.enabled && settings.background && !!game && !multiplayer(); }
  function installBackgroundRunner() {
    const originalRAF = window.requestAnimationFrame, originalCancel = window.cancelAnimationFrame;
    if (typeof originalRAF !== 'function' || typeof originalCancel !== 'function') return null;
    const pending = new Map();
    let active = true, resumeTimer = null, frames = 0;
    const running = () => active && document.hidden && backgroundAllowed();
    function arm(record) {
      if (!running() || record.timer != null || record.done) return;
      record.timer = setTimeout(() => {
        record.timer = null;
        if (!running() || record.done) return;
        frames++;
        originalCancel.call(window,record.id);
        tick();
        deliver(record,performance.now());
      }, 1000 / 30);
    }
    function deliver(record,ts) {
      if (record.done) return;
      record.done = true; pending.delete(record.id);
      if (record.timer != null) clearTimeout(record.timer);
      record.callback.call(window,ts);
    }
    const wrappedRAF = function(callback) {
      const record = {callback,done:false,timer:null,id:null};
      record.id = originalRAF.call(window,ts => deliver(record,ts));
      pending.set(record.id,record); arm(record);
      return record.id;
    };
    const wrappedCancel = function(id) {
      const record = pending.get(id);
      if (record) { record.done = true; if (record.timer != null) clearTimeout(record.timer); pending.delete(id); }
      return originalCancel.call(window,id);
    };
    function sync() {
      for (const record of pending.values()) {
        if (running()) arm(record);
        else if (record.timer != null) { clearTimeout(record.timer); record.timer = null; }
      }
    }
    function onVisibility() {
      if (resumeTimer != null) { clearTimeout(resumeTimer); resumeTimer = null; }
      // Observe playing before the native listener auto-pauses. Resume only
      // that transition, after all visibility listeners (including saves) ran.
      const resume = running() && game.Game.state === 'playing' && !visible('rotate');
      if (resume) resumeTimer = setTimeout(() => {
        resumeTimer = null;
        if (running() && !visible('rotate') && game.Game.state === 'paused') game.Game.togglePause?.();
        if (running()) tick();
      },0);
      sync();
    }
    window.requestAnimationFrame = wrappedRAF;
    window.cancelAnimationFrame = wrappedCancel;
    addEventListener('visibilitychange',onVisibility,true);
    return {sync, get frames() {return frames;}, destroy() {
      active = false;
      if (resumeTimer != null) clearTimeout(resumeTimer);
      sync();
      removeEventListener('visibilitychange',onVisibility,true);
      if (window.requestAnimationFrame === wrappedRAF) window.requestAnimationFrame = originalRAF;
      if (window.cancelAnimationFrame === wrappedCancel) window.cancelAnimationFrame = originalCancel;
      // Leave pending native callbacks intact so removing Bot cannot stop Game.
    }};
  }
  function install(g) {
    game = g;
    originalAxis = g.Input.axis;
    hookedAxis = function (...args) {
      const manual = originalAxis.apply(this, args);
      if (manual[0] || manual[1]) { manualUntil = performance.now() + 1800; return manual; }
      if (!settings.enabled || blocked() || g.Game.state !== 'playing') return manual;
      return vector;
    };
    g.Input.axis = hookedAxis;
    originalOffer = g.LevelUp.offer;
    hookedOffer = function (...args) {
      const list = originalOffer.apply(this, args);
      offers = list; offered = null;
      return list;
    };
    g.LevelUp.offer = hookedOffer;
    if(typeof g.RunUI.showItemChoice==='function') {
      originalItem=g.RunUI.showItemChoice;
      hookedItem=function(cur,next,cb,...args) {
        const choice=itemChoice={ids:[cur,next]};
        return originalItem.call(this,cur,next,function(...values) {
          if(itemChoice===choice)itemChoice=null;
          return cb.apply(this,values);
        },...args);
      };
      g.RunUI.showItemChoice=hookedItem;
    }
    if (typeof g.RunUI.showBond === 'function') {
      originalBond = g.RunUI.showBond;
      hookedBond = function (opt, ...args) {
        bondChoice = { opt, first: null };
        return originalBond.call(this, opt, ...args);
      };
      g.RunUI.showBond = hookedBond;
    }
  }
  const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
  const learned = p => p.moves || p.slots.flat();
  const damaging = m => m && m.kind !== 'buff';
  const buffStat = m => ['patk','satk'].includes(m?.stat) ? 'atk' : m?.stat;
  const poisonBuild = p => !!p && learned(p).some(m => damaging(m) && m.poison > 0);
  const buffRank = m => m?.kind === 'buff' ? (poisonBuild(game.Game.player)
    ? {def:4,regen:3,spd:2,atk:1} : {atk:4,spd:3,def:2,regen:1})[buffStat(m)] || 0 : 0;
  const control = m => !!(m.slow || m.burn || m.poison);
  const rangedProjectile = m => ['projectile','homing','bounce'].includes(m?.kind);
  const survivalControl = m => !!(m?.stun || m?.kind==='shove' || m?.kind==='vortex');
  // Trails tick repeatedly; mines persist until triggered, then burst once.
  // Status effects, falling meteors and shooting turrets are not ground residue.
  const groundRank = m => ['trail','vortex'].includes(m?.kind) ? 2 : m?.kind === 'mine' ? 1 : 0;
  function kitePairRank(slot) {
    const attacks = slot.filter(damaging);
    if (attacks.length !== 2 || !attacks.some(rangedProjectile)) return 0;
    return Math.max(...attacks.map(groundRank));
  }
  function moveProfile(m) {
    const radius = m.radius || 60;
    let mode = 'ranged', reach = 300, ideal = 190;
    switch (m.kind) {
      case 'melee': mode = 'close'; reach = radius; ideal = radius * 0.84; break;
      case 'aura': mode = 'close'; reach = radius; ideal = radius * 0.82; break;
      // Orbits are elliptical on the ground: use their smaller vertical radius.
      case 'orbit': mode = 'orbit'; reach = radius * 0.7 + (m.size || 8); ideal = radius * 0.7; break;
      case 'cone': reach = (m.speed || 300) * (m.life || 0.4) * 0.85; ideal = reach * 0.72; break;
      case 'beam': reach = radius; ideal = Math.min(230, reach * 0.75); break;
      case 'charge': reach = radius; ideal = Math.min(230,reach*0.75); break;
      case 'spin': case 'shove': mode='close'; reach=radius; ideal=radius*0.85; break;
      case 'quake': reach=(m.count || 1)*34+radius; ideal=Math.min(230,reach*0.75); break;
      case 'vortex': case 'stun': reach=300; ideal=220; break;
      case 'boomerang': reach = radius; ideal = reach * 0.72; break;
      case 'chain': reach = 280; ideal = 200; break;
      case 'meteor': reach = 340; ideal = 240; break;
      case 'projectile': case 'homing': case 'bounce': reach = Math.min(520, (m.speed || 300) * (m.life || 1.5)); ideal = Math.min(240, reach * 0.65); break;
      case 'nova': reach = (m.speed || 250) * (m.life || 1); ideal = Math.min(160, reach * 0.55); break;
      case 'trail': case 'mine': mode = 'lure'; reach = radius; ideal = 130; break;
      case 'turret': mode = 'turret'; reach = m.range || 280; ideal = reach * 0.65; break;
      case 'dash': mode = 'dash'; reach = radius + 60; ideal = radius * 0.85; break;
    }
    return { mode, reach, ideal, move: m };
  }
  // A heuristic for usable damage/control, not a claim of measured DPS.
  function moveValue(m, companions = []) {
    if (!damaging(m)) return 0;
    const base = ({ projectile: 56, beam: 55, chain: 59, meteor: 53, nova: 48,
      boomerang: 51, aura: 50, orbit: 51, cone: 48, melee: 32, dash: 32,
      trail: 38, mine: 34, turret: 53, homing:58,bounce:57,charge:46,spin:32,
      quake:48,vortex:55,shove:43,stun:54 })[m.kind] || 35;
    let value = base + clamp((m.dmg || 10) / Math.max(0.2, m.cd || 1) / 5, 0, 18);
    value += Math.min(9, (m.count || 1) * 1.5) + Math.min(8, (m.pierce || 0) * 3);
    value += m.slow ? 7 : 0;
    value += m.homing ? 5 : 0;
    value += m.drain ? 15 : 0;
    value += survivalControl(m) ? 10 : 0;
    value += m.evolved ? 24 : 0;
    if (m.hex && companions.some(control)) value += 18;
    if (control(m) && companions.some(other => other.hex)) value += 12;
    // Prefer other attacks when learning or fusing; Substitute remains usable.
    if (m.id === 'substitute') value -= 25;
    const p=game?.Game.player;
    value*=clamp(game.Stats?.fit?.(p?.mon,m.cat) ?? 1,0.25,1.2);
    return value;
  }
  function slotValue(slot) {
    if (!slot?.some(damaging)) return 0;
    return slot.reduce((sum, m) => sum + (m.kind === 'buff'
      ? (m.stat === 'regen' ? 22 : m.stat === 'atk' ? 20 : 12)
      : moveValue(m, slot.filter(other => other !== m))), 0);
  }
  // A conservative damage model for build decisions, not measured combat DPS.
  function moveDamageRate(m) {
    if (!damaging(m)) return 0;
    if(m.kind==='vortex') return (m.dmg || 0)*Math.min(2,(m.dur || 2.6)/Math.max(0.05,m.cd || 3))/0.4;
    if(m.kind==='spin') return (m.dmg || 0)*Math.max(1,m.count || 1)/Math.max(0.05,m.cd || 1)*0.7;
    const count=Math.min(3,1+Math.max(0,(m.count || 1)-1)*0.5);
    const period=m.kind === 'trail' ? 0.5 : m.kind === 'turret' ? (m.rate || 0.6)
      : m.kind === 'orbit' ? 0.5 : Math.max(0.05,m.cd || 1);
    return Math.max(0,m.dmg || 0)*count/period*(m.kind === 'dash' || m.kind === 'melee' ? 0.7 : 1);
  }
  function slotDamageRate(p,slot,castBuff=false) {
    let value=slot.reduce((sum,m)=>sum+(m.kind==='vortex'
      ? (m.dmg || 0)*Math.min(2,(m.dur || 2.6)/Math.max(0.05,(m.cd || 3)*(p.cdMul || 1)))/0.4
      : moveDamageRate(m)/(['trail','turret','orbit'].includes(m.kind) ? 1 : Math.max(0.05,p.cdMul || 1)))
      * Math.max(0.01,p.atk || 1)*(game.Stats?.fit?.(p.mon,m.cat) ?? 1),0);
    // Credit one real attack-buff cast, rather than assuming five free stacks.
    if (castBuff) for (const m of slot.filter(m=>m.kind === 'buff' && m.stat === 'atk')) {
      const b=p.buffs?.atk, factor=1+(b?.n || 0)*(b?.amount || 0);
      if ((b?.n || 0)<(m.stacks || 1)) value*=1+(m.amount || 0)/factor;
    }
    return value;
  }
  function updateDamagePlan(p) {
    const t=game.Game.st?.time;
    if (damagePlayer !== p || !Number.isFinite(t) || t < (damageHistory.at(-1)?.t || 0)) {
      damagePlayer=p;damageHistory=[];damagePlan={known:false,insufficient:false};
    }
    if (!Number.isFinite(t) || t<0) return;
    const foes=(game.EnemyMgr.all() || []).filter(e=>!e.dead && !e.boss && e.hp>0 && distance(p,e)<600);
    const tiers=game.Enemies?.TIERS || [];
    let phase=-1;tiers.forEach((tier,i)=>{if(t>=tier.from)phase=i;});
    const tier=tiers[phase];
    const hp=foes.map(e=>e.maxHp || e.hp).sort((a,b)=>a-b);
    const stageHp=tier ? tier.hp*(game.Enemies.scale?.(t)?.hp || (1+t/95))*(3.3+Math.min(1.7,t/210)) : 0;
    const enemyHp=Math.max(stageHp*0.6,hp.length ? hp[Math.floor(hp.length/2)] : stageHp);
    if (!(enemyHp>0)) {damagePlan={known:false,insufficient:false};return;}
    if (Number.isFinite(p.dmgDealt) && game.Game.state === 'playing') {
      if (p.dmgDealt<(damageHistory.at(-1)?.damage || 0)) damageHistory=[];
      if (!damageHistory.length || t-damageHistory.at(-1).t>=0.5) damageHistory.push({t,damage:p.dmgDealt});
      while(damageHistory.length>1 && t-damageHistory[0].t>6)damageHistory.shift();
    }
    const first=damageHistory[0], span=first ? t-first.t : 0;
    const observed=span>=4 && Number.isFinite(p.dmgDealt) ? Math.max(0,(p.dmgDealt-first.damage)/span) : null;
    const required=enemyHp/clamp(3.5-Math.max(0,phase)*0.2,2,3.5);
    const modeled=Math.max(0,...p.slots.map(slot=>slotDamageRate(p,slot)));
    const ratio=modeled/required, crowded=foes.length>=8 && observed!==null && observed<required*0.9;
    let insufficient=damagePlan.insufficient;
    if (!insufficient && (ratio<0.85 || crowded)) insufficient=true;
    else if (insufficient && ratio>=1.15 && !crowded && t-(damagePlan.changedAt || 0)>=3) insufficient=false;
    const changedAt=insufficient!==damagePlan.insufficient ? t : damagePlan.changedAt || 0;
    damagePlan={known:true,insufficient,phase:phase+1,time:t,modeled,required,observed,ratio,crowded,changedAt};
  }
  function immediateDamageGain(c,p) {
    const moves=learned(p),id=c.key.split(':')[1],m=moves.find(m=>m.id===id) || game.Moves.BY_ID[id];
    const baseline=Math.max(0,...p.slots.map(slot=>slotDamageRate(p,slot)));
    if (c.key === 'stat:atk') return baseline*0.1;
    if (c.key === 'stat:cd') return Math.max(0,...p.slots.map(slot=>slotDamageRate({atk:p.atk || 1,cdMul:(p.cdMul || 1)*0.92},slot)))-baseline;
    if (!m) return 0;
    if (m.kind === 'buff') {
      if (m.stat !== 'atk') return 0;
      const b=p.buffs?.atk, factor=1+(b?.n || 0)*(b?.amount || 0);
      if(c.type === 'new') {
        if(moves.some(other=>other.kind==='buff' && other.stat==='atk') || moves.filter(m=>m.kind==='buff').length>=2)return 0;
        return baseline*(m.amount || 0)/factor;
      }
      if(c.type === 'up' && game.Moves.levelUp) {
        const copy={...m};game.Moves.levelUp(copy);
        return baseline*Math.max(0,(copy.amount || 0)-(m.amount || 0))*Math.max(1,b?.n || 0)/factor;
      }
      return 0;
    }
    if(c.type === 'new') {
      const extra=slotDamageRate(p,[m]);
      // Ground residue can continue hurting while another slot attacks.
      return Math.max(0,extra-baseline,groundRank(m) && !moves.some(groundRank) ? extra*0.25 : 0);
    }
    if(c.type !== 'up' && c.type !== 'evo')return 0;
    const copy={...m};
    if(c.type === 'up')game.Moves.levelUp?.(copy);else game.Moves.evolve?.(copy);
    const after=Math.max(0,...p.slots.map(slot=>slotDamageRate(p,slot.map(other=>other===m?copy:other))));
    return Math.max(0,after-baseline);
  }
  function fastClear() {
    return damagePlan.known && !damagePlan.insufficient && !damagePlan.crowded && damagePlan.ratio>=1.5;
  }
  function completedCore(p) {
    return p.slots.find(slot=>slot.length>=4 && slot.filter(damaging).length>=2) || null;
  }
  function lockCompletedCore(p) {
    if (bondPlayer===p && p?.bondOptions===hookedBondOptions) return;
    if(bondPlayer && hookedBondOptions && bondPlayer.bondOptions===hookedBondOptions) bondPlayer.bondOptions=originalBondOptions;
    bondPlayer=p;originalBondOptions=p?.bondOptions;hookedBondOptions=null;
    if(typeof originalBondOptions!=='function') return;
    const nativeOptions=originalBondOptions;
    hookedBondOptions=function(...args) {
      if(settings.enabled && !settings.manualPoints && !multiplayer() && completedCore(this)) return null;
      return nativeOptions.apply(this,args);
    };
    p.bondOptions=hookedBondOptions;
  }
  function buildStep(p) {
    if(completedCore(p)) return p.slots.length<(p.maxMoves || 4)?'fill':'passive';
    const moves=learned(p),attacks=moves.filter(damaging);
    if(poisonBuild(p)) return !moves.some(m=>m.kind==='buff' && m.stat==='def') ? 'defense'
      : !moves.some(m=>m.kind==='buff' && m.stat==='regen') ? 'recovery' : 'upgrade';
    const defense=moves.some(m=>m.kind==='buff' && m.stat==='def');
    const attackBuff=moves.some(m=>m.kind==='buff' && buffStat(m)==='atk');
    if (!attacks.length) return 'attack';
    if (fastClear()) {
      if(attacks.length<2) return 'second';
      if(!p.slots.some(slot=>slot.filter(damaging).length>=2)) return 'fuse';
    }
    if (!defense) return 'defense';
    if (attacks.length<2) return 'second';
    if (!attackBuff) return 'swords';
    return 'upgrade';
  }
  function fusionValue(slot, available = []) {
    const attackMoves = slot.filter(damaging), attacks = attackMoves.length;
    const stats = new Set(slot.filter(m => m.kind === 'buff').map(buffStat));
    // Normal: damage anchor, defense, second attack, attack buff.
    // Fast clears combine attacks first; reserve two places for attacks.
    const excessBuffs = Math.max(0,slot.filter(m => m.kind === 'buff').length - 2);
    if(poisonBuild(game.Game.player)) return (slot.some(m=>damaging(m) && m.poison>0)?10000000:0)
      + stats.has('def')*1000000 + stats.has('regen')*100000
      + slot.some(m=>m.drain)*50000 + slot.some(survivalControl)*1000
      + (attacks>=2?10000:0) + kitePairRank(slot)*250
      + stats.has('atk')*1000 + stats.has('spd')*100
      - (excessBuffs+Math.max(0,attacks-2))*20000000 + Math.min(99,slotValue(slot)/10);
    if (damagePlan.insufficient && (excessBuffs || attacks>2)) return -1e12;
    if (damagePlan.insufficient) return (attacks>0 ? 1000000 : 0)
      + slotDamageRate(game.Game.player,slot,true)*10000 + kitePairRank(slot)*10
      + (stats.has('atk')*4+stats.has('spd')*3+stats.has('def')*2+stats.has('regen'))*0.1;
    const buffs = stats.has('def') * (fastClear()?100000:1000000) + stats.has('atk') * 10000 + stats.has('spd') * 1000;
    // Look ahead to a still-loose kite partner while choosing the damage
    // anchor, so early buff fusion does not lock out projectile + residue.
    const pair = attacks === 1 ? Math.max(0,...available.filter(m => !slot.includes(m)).map(m => kitePairRank([attackMoves[0],m]))) : kitePairRank(slot);
    return (attacks > 0 ? 10000000 : 0) + (attacks >= 2 ? (fastClear()?1000000:100000) : 0)
      + pair * 250 + buffs - excessBuffs * 2000000
      + Math.min(99, slotValue(slot) / 10);
  }
  function fusionChoiceValue(group, m, candidates, firstPick) {
    if (!firstPick) return fusionValue([...group,m],candidates);
    // The first card anchors a two-step pair. Evaluate its best legal partner
    // rather than rewarding an isolated buff which cannot deal damage.
    const partners = candidates.filter(other => other !== m);
    return Math.max(...partners.map(other => fusionValue([m,other],candidates)),0)
      + (damaging(m) ? 0.1 + moveValue(m) / 10000 : 0);
  }
  function mainSlot(p) {
    return p.slots.reduce((best, slot) => slotValue(slot) > slotValue(best) ? slot : best, p.slots[p.active] || []);
  }
  function cardScore(c, p) {
    const hp = p.hp / p.maxHp;
    const main = mainSlot(p), moves = learned(p);
    const id = c.key.split(':')[1];
    const m = moves.find(move => move.id === id) || game.Moves.BY_ID[id];
    const inMain = main.some(move => move.id === id);
    if (c.key === 'stat:heal') return hp < 0.4 ? 300 : hp < 0.7 ? 95 : -10;
    // Flat recovery must keep pace with max-HP true damage. Never let the
    // damage-deficit or completed-core heuristics override survival stats.
    if (c.key === 'stat:def') return (p.dmgReduce || 0)>=0.7 ? -30 : 280;
    if (c.key === 'stat:rgn') return 270;
    if (c.key === 'stat:hp') return 5;
    if (c.type==='new' && m?.poison>0 && !poisonBuild(p)) return 260;
    if(poisonBuild(p)) {
      if(c.key==='stat:atk') return 35;
      if(m?.kind==='buff' && ['def','regen'].includes(m.stat)) {
        const rank=m.stat==='def'?2:1;
        if(c.type==='up' || c.type==='evo') return 240+rank;
        if(c.type==='new' && moves.filter(m=>m.kind==='buff').length<2
          && !moves.some(other=>other.kind==='buff' && other.stat===m.stat)) return 250+rank;
      }
      if(m?.poison>0 && (c.type==='up' || c.type==='evo')) return 230;
      if(m?.drain && (c.type==='up' || c.type==='evo')) return 235;
      if(c.type==='new' && damaging(m) && moves.filter(damaging).length<2) {
        if(m.drain)return 248;
        if(survivalControl(m))return 238;
      }
      if(c.type==='up' || c.type==='evo') return 30;
      if(c.key==='stat:cd') return 45;
    }
    if (c.key === 'stat:atk') return 250;
    const core=completedCore(p);
    if(core) {
      const full=p.slots.length>=(p.maxMoves || 4);
      if(c.type==='new' && m && !full && !moves.some(other=>other.id===m.id)) {
        // Fill only after the main fusion is finished. Avoid adding more buffs
        // when native rules already reserve both buff places for the core.
        if(m.kind==='buff' && moves.filter(m=>m.kind==='buff').length>=2) return 12;
        return 230+Math.min(4,moveValue(m,core)/25);
      }
      if(full && c.type==='stat') {
        if(id==='cd')return 185;
      }
      if(c.type==='up' && !core.some(other=>other.id===id)) return 70;
    }
    if (damagePlan.insufficient && !poisonBuild(p)) {
      const gain=immediateDamageGain(c,p);
      if(gain>0) return 200+12*gain/(Math.max(1,damagePlan.modeled)+gain);
    }
    if(c.type==='new' && m && (!damagePlan.insufficient || poisonBuild(p))) {
      const step=buildStep(p), buffs=moves.filter(m=>m.kind==='buff');
      if(m.kind==='buff' && buffs.length<2 && !buffs.some(other=>other.stat===m.stat)) {
        if(m.stat==='def') return step==='defense'?225:fastClear() && step==='fuse'?125:205;
        if(buffStat(m)==='atk') return poisonBuild(p)?40:step==='swords'?215:step==='fuse'?45:185;
        // Save the two planned buff places for Harden and Swords Dance.
        return 45;
      }
      if(damaging(m) && m.id!=='substitute' && moves.filter(damaging).length<2 && (groundRank(m) || moveValue(m,main)>=50)) {
        const partner= moves.filter(damaging)[0];
        return (step==='second'?220:210) + kitePairRank([partner,m].filter(Boolean))*5 + moveValue(m,main)/1000;
      }
    }
    if (c.type === 'evo') return inMain ? 180 : 170;
    if (c.type === 'up') {
      // Develop learned moves before expanding the roster, including rotation slots.
      if (!m) return 130;
      if (buffRank(m)) return 195 + buffRank(m) + Math.min(8,m.lvl || 1) * 0.1;
      return 130 + (inMain ? 15 : 0) + Math.min(8, m.lvl || 1) * 3 + (m.kind === 'buff' ? -5 : 0);
    }
    if (c.type === 'new') {
      if (!m) return 30;
      if (m.kind === 'buff') {
        const buffs = moves.filter(move => move.kind === 'buff');
        // Collect useful active boosts even before fusion is available.
        // Two distinct buffs leave the intended two attack places available.
        if (!moves.some(damaging) || buffs.some(move => move.stat === m.stat) || buffs.length >= 2) return 12;
        return buffRank(m) ? 190 + buffRank(m) : 35;
      }
      // Fill the missing kite role before redundant attacks,
      // below every learned upgrade. Stop once both roles are owned or the
      // main fusion already has two attacks; do not add a third core attack.
      const missingGround = groundRank(m) && moves.some(rangedProjectile) && !moves.some(groundRank);
      const missingProjectile = rangedProjectile(m) && moves.some(groundRank) && !moves.some(rangedProjectile);
      if (main.filter(damaging).length < 2 && (missingGround || missingProjectile)) {
        return 124.2 + groundRank(m) * 0.25 + clamp(moveValue(m, main),0,150) / 1000;
      }
      const strongest = main.filter(damaging).reduce((best, move) => Math.max(best, moveValue(move, main)), 0);
      const improvement = moveValue(m, main) - strongest;
      let score = 53 + clamp(improvement, -22, 45);
      if (!main.some(damaging)) score = 150;
      // Escape a short-range starting build with a reliable ranged attack.
      if (main.filter(damaging).every(move => ['melee', 'dash', 'mine', 'trail'].includes(move.kind)) &&
          ['projectile', 'homing', 'bounce', 'beam', 'charge', 'chain', 'meteor', 'turret'].includes(m.kind)) score += 38;
      if (p.bonds > 0 && main.length < 4) score += 27;
      // A filled roster of unused alternatives delays the core build.
      if (p.slots.length >= 3 && !(p.bonds > 0)) score -= 15;
      if(!completedCore(p) && moves.filter(damaging).length>=2)score=Math.min(score,45);
      return Math.min(120, score);
    }
    let score = ({ hp: 126, cd: 81, rgn: hp < 0.7 ? 90 : 61, atk: 250, def: 128, mag: 50, xp: 51, spd: 53 })[id] || 20;
    // Read the runtime evolution table: plan prerequisites before reaching max level.
    for (const move of main) {
      const needs = game.Moves.EVO?.[move.id]?.[1];
      if (!move.evolved && needs === id && !(p.statsTaken?.[id] > 0)) {
        score = Math.max(score, (move.lvl || 1) >= (move.def?.maxLvl || 5) ? 148 : (move.lvl || 1) >= 3 ? 119 : 88);
      }
    }
    return score;
  }
  function fanOffsets(m) {
    const n = Math.max(m.kind === 'cone' ? 2 : 1, m.count | 0);
    const span = m.kind === 'cone' ? (m.arc || 0.9)
      : m.kind === 'boomerang' ? (m.spread || 0.5) * Math.min(n, 3) : (m.spread || 0) * n;
    return Array.from({length:n}, (_, i) => n === 1 ? 0 : (i / (n - 1) - 0.5) * span);
  }
  function fanPathClear(from, end, m, target) {
    if (!game.World.projectileBlock) return !terrain || gridLine(terrain,from,end,true);
    const steps = Math.max(1,Math.ceil(distance(from,end)/12)), props = new Set();
    for (let k=1;k<=steps;k++) {
      const block=game.World.projectileBlock(from.x+(end.x-from.x)*k/steps,from.y+(end.y-from.y)*k/steps,m.size || 6);
      if (!block) continue;
      // Hitting the chest we are opening is the intended collision, not cover.
      if (block === target || block === target.prop) return true;
      if (block === 'wall' || !block.destructible) return false;
      props.add(block);
      if (m.kind !== 'boomerang' && props.size > (m.pierce || 0)) return false;
    }
    return true;
  }
  function fanCoverage(p, m, slot, enemies) {
    const target = targetFor(p, slot, enemies), offsets = fanOffsets(m);
    if (!target) return {hits:0, targetHits:0, count:offsets.length};
    // Player.tick re-aims at the selected target every frame. Moving sideways
    // changes the fan's relation to the pack, not its aim offset from that target.
    const aim = Math.atan2(target.y - p.y, target.x - p.x);
    const speed = m.speed || 300, boom = m.kind === 'boomerang';
    const life = boom ? (m.radius || 200) / speed : (m.life || 1.5);
    const jitter = m.kind === 'cone' ? 0.05 : boom ? 0 : 0.03;
    const candidates = enemies.slice(0, 48);
    let hits = 0, targetHits = 0;
    for (const off of offsets) for (const [noise, weight] of [[-jitter,0.25],[0,0.5],[jitter,0.25]]) {
      const angle = aim + off + noise, ux = Math.cos(angle), uy = Math.sin(angle);
      const muzzle = boom ? 0 : m.kind === 'cone' ? 4 : 3;
      const sx = p.x + ux * muzzle, sy = p.y + uy * muzzle;
      const contacts = [];
      for (const e of candidates) {
        const dx = e.x - sx, dy = e.y - sy, d = Math.hypot(dx, dy);
        const pursuit = (e.spd || 0) * (1 - clamp(e.slow || 0, 0, 1));
        // Approximate ground pursuit during flight; no invented lateral velocity.
        const vx = ux * speed + dx / Math.max(1, d) * pursuit;
        const vy = uy * speed + dy / Math.max(1, d) * pursuit;
        const time = clamp((dx * vx + dy * vy) / (vx * vx + vy * vy), 0, life);
        const miss = Math.hypot(dx - vx * time, dy - vy * time);
        const radius = (e.r || 12) + (m.size || 6);
        // Homing can bend into nearby gaps. It is a discounted estimate, not
        // permission to ignore cover or assume every guided projectile hits.
        const bend = m.homing ? Math.min(d * 0.4, m.homing * d * time * 0.25) : 0;
        const probability = miss <= radius ? 1 : bend > 0 ? clamp(1 - (miss - radius) / bend, 0, 0.7) : 0;
        if (!probability) continue;
        const end = {x:sx + ux * speed * time,y:sy + uy * speed * time};
        if (!fanPathClear({x:sx,y:sy}, end, m, e)) continue;
        contacts.push({e,time,probability});
      }
      contacts.sort((a,b) => a.time - b.time);
      let budget = boom ? Infinity : 1 + (m.pierce || 0);
      for (const contact of contacts) {
        if (budget <= 0) break;
        const expected = Math.min(budget, contact.probability);
        hits += expected * weight;
        if (contact.e === target) targetHits += expected * weight;
        budget -= expected;
      }
    }
    return {hits, targetHits, count:offsets.length};
  }
  function targetFor(p, slot, enemies) {
    let nearest = null, nearestDistance = 520, threat = null, threatDistance = p.r + 24;
    for (const e of enemies) {
      const d = distance(p, e);
      if (d < nearestDistance) { nearest = e; nearestDistance = d; }
      if (d < threatDistance) { threat = e; threatDistance = d; }
    }
    const boss = enemies.find(e => e.boss && distance(p, e) < 330);
    const ranged = ['projectile', 'beam'].includes(slot?.[0]?.kind);
    return (ranged ? boss || threat : threat || boss) || nearest;
  }
  function entryDelay(m, switching) {
    if (m.kind === 'orbit') return switching ? 0.04 : 0;
    const remaining = Math.max(0, m.t || 0);
    // setActive caps the selected slot's t; inactive timers do NOT tick.
    return switching ? Math.min(remaining, (m.cd || 1) * 0.35) + 0.04 : remaining;
  }
  function hitEstimate(p, m, slot, enemies) {
    const target = targetFor(p, slot, enemies);
    if (!target || !damaging(m)) return 0;
    const d = distance(p, target), profile = moveProfile(m);
    const nearby = enemies.filter(e => distance(p, e) <= profile.reach);
    let hits = 1, eligible = true;
    switch (m.kind) {
      case 'melee': case 'aura': case 'shove':
        hits = Math.min(8, nearby.length); break;
      case 'spin':
        hits=Math.min(8,nearby.length)*Math.min(4,m.count || 1)*0.7; break;
      case 'vortex': case 'stun': {
        eligible=d<=300;
        hits=Math.min(6,enemies.filter(e=>distance(e,target)<=(m.radius || 60)+(e.r || 12)).length);
        if(m.kind==='vortex')hits*=Math.min(3,(m.dur || 2.6)/0.4)*0.6;
        else hits*=0.75; // The delayed ground mark can miss a moving target.
        break;
      }
      case 'quake': {
        const ux=(target.x-p.x)/Math.max(1,d),uy=(target.y-p.y)/Math.max(1,d);
        hits=0;
        for(let i=1;i<=(m.count || 1);i++) {
          const spot={x:p.x+ux*i*34,y:p.y+uy*i*34};
          if(game.World.isWall?.(spot.x,spot.y))break;
          hits+=enemies.filter(e=>distance(e,spot)<=(m.radius || 30)+(e.r || 12)).length*0.65;
        }
        hits=Math.min(8,hits);break;
      }
      case 'orbit':
        hits = Math.min(5, enemies.filter(e => {
          const band = Math.hypot(e.x - p.x, (e.y - p.y) / 0.7);
          return Math.abs(band - (m.radius || 60)) <= (e.r || 12) + (m.size || 8) + 12;
        }).length) * Math.min(2.5, (m.count || 1) * 0.65); break;
      case 'chain': {
        eligible = d <= 280;
        let previous = target, total = 1;
        const used = new Set([target]);
        for (let i = 1; i < (m.count || 1); i++) {
          const next = enemies.find(e => !used.has(e) && distance(previous, e) <= (m.radius || 120));
          if (!next) break;
          used.add(next); previous = next; total += Math.pow(0.85, i);
        }
        hits = total; break;
      }
      case 'projectile': case 'homing': case 'bounce': case 'boomerang': case 'cone': {
        eligible = d <= (m.kind === 'boomerang' ? profile.reach + 40 : m.kind === 'cone' ? m.speed * m.life + 30 : 520);
        hits = fanCoverage(p, m, slot, enemies).hits;
        if(m.kind==='bounce' && hits>0)hits*=1+Math.min(m.bounce || 0,
          enemies.filter(e=>e!==target && distance(e,target)<=220).length)*0.45;
        // Only the outward pass is geometrically predicted; a return may hit again.
        if (m.kind === 'boomerang') hits *= 1.3;
        break;
      }
      case 'beam': case 'charge': {
        eligible = d <= profile.reach;
        const ux = (target.x - p.x) / Math.max(1, d), uy = (target.y - p.y) / Math.max(1, d);
        const aligned = enemies.filter(e => {
          const dx = e.x - p.x, dy = e.y - p.y, along = dx * ux + dy * uy;
          return along >= 0 && along <= profile.reach && Math.abs(dx * uy - dy * ux) < (m.width || m.size || 8) + (e.r || 12);
        }).length;
        hits = Math.min(8, aligned);
        // Beams stop at walls; avoid choosing one that cannot hit its target.
        if (game.World.isWall) {
          for (let step = 16; step < d; step += 24) {
            if (game.World.isWall(p.x + ux * step, p.y + uy * step)) { eligible = false; break; }
          }
        }
        if(m.kind==='charge')hits/=1+(m.charge || 0.75);
        break;
      }
      case 'meteor':
        eligible = d <= 340;
        hits = Math.min(nearby.length, m.count || 1) * 1.3; break;
      case 'nova':
        hits = Math.min(nearby.length, Math.max(1, (m.count || 8) * 0.5)); break;
      case 'turret':
        eligible = d <= (m.range || 280);
        // Damage during the first second after deployment, not full lifetime damage.
        hits = Math.min(3, 1 / (m.rate || 0.5)); break;
      case 'mine': case 'trail':
        eligible = d < Math.max(100, (m.radius || 30) + (target.spd || 70) * 0.6);
        hits = Math.min(3, nearby.length || 1) * 0.7; break;
      case 'dash': {
        eligible = d <= (m.radius || 100) + 60;
        const ux = (target.x - p.x) / Math.max(1, d), uy = (target.y - p.y) / Math.max(1, d);
        const landing = { x: p.x + ux * (m.radius || 100), y: p.y + uy * (m.radius || 100) };
        if (!straightFree(p, landing)) eligible = false;
        if (terrain && !forwardRoom(terrain, p, landing, [ux, uy]).exits) eligible = false;
        if ((game.Hazards?.all || []).some(h => !h.hit && game.Hazards.inside(h, landing.x, landing.y, p.r))) eligible = false;
        if (p.hp / p.maxHp < 0.4 && enemies.some(e => distance(e, landing) < p.r + (e.r || 12) + 12)) eligible = false;
        break;
      }
    }
    if (!eligible || !hits) return 0;
    let multiplier = 1;
    if (game.Types?.mult && m.type && target.types) multiplier *= game.Types.mult(m.type, target.types);
    if (game.Weather?.mult && m.type) multiplier *= game.Weather.mult(m.type);
    if (m.hex && (target.burn > 0 || target.poison > 0 || target.slow > 0 || slot.some(other => other !== m && control(other)))) multiplier *= m.hex;
    if (p.hp / p.maxHp < 0.4 && ['close', 'orbit', 'dash'].includes(profile.mode)) multiplier *= 0.65;
    const status = (m.slow ? 1.12 : 1) * (m.burn || m.poison ? 1.08 : 1)
      * (m.drain && p.hp<p.maxHp*0.8 ? 1.35 : 1) * (m.stun || m.kind==='shove' ? 1.15 : 1);
    const fit=game.Stats?.fit?.(p.mon,m.cat) || 1;
    return (m.dmg || 0) * hits * multiplier * status * fit;
  }
  function rotationValue(p, slot, enemies, switching) {
    if (!slot?.length) return 0;
    let score = 0;
    for (const m of slot) {
      if (m.kind === 'buff') {
        const buff = p.buffs?.[m.stat];
        const needsStack = !buff || buff.n < (m.stacks || 1) || buff.t < 1.5;
        if (needsStack && entryDelay(m, switching) < 0.4) {
          // Buff-only slots get a brief turn, then yield to actual damage.
          if(damagePlan.insufficient && m.stat === 'atk')
            score += (damagePlan.modeled || 0)*(m.amount || 0)*3/(1+(buff?.n || 0)*(buff?.amount || 0));
          score += m.stat === 'regen' && p.hp < p.maxHp * 0.7 ? 18 : m.stat === 'atk' ? 10 : 3;
        }
        continue;
      }
      const hit = hitEstimate(p, m, slot, enemies);
      const delay = entryDelay(m, switching), period = Math.max(0.05, (m.cd || 1) * (p.cdMul || 1));
      if (m.kind === 'orbit') {
        score += hit / Math.max(0.12, m.cd || 0.3) * (switching ? 0.8 : 1);
      } else {
        // Favor a shot we can deliver now, while retaining a sustained-output term.
        const near = delay <= 0.65 ? hit * (1 - delay / 0.8) : 0;
        const casts = delay < 1.4 ? 1 + Math.floor((1.4 - delay) / period) : 0;
        score += near * 1.5 + hit * casts / 1.4 * 0.55;
      }
    }
    // Replacing a live turret with the same move has little short-term value.
    if (switching && slot.every(m => m.kind === 'turret') && slot.every(m => turrets.some(t => t.move === m && t.until > performance.now() + 1000))) score *= 0.25;
    return score;
  }
  function buffCastPriority(p,slot,switching,enemies=[]) {
    return Math.max(0,...(slot || []).map(m => {
      // Percentage-HP poison is not represented by the direct damage model.
      // Reapply before expiry and build real stacks, then let other attacks fire.
      if(m.poison>0 && entryDelay(m,switching)<0.4
        && enemies.some(e=>e.kind!=='chest' && e.hp>0 && ((e.poison || 0)<8 || e.poisonT<1.5)
          && hitEstimate(p,m,slot,[e])>0)) return 1.5;
      if (!buffRank(m) || (damagePlan.insufficient && !poisonBuild(p))) return 0;
      const b=p.buffs?.[m.stat];
      const delay=entryDelay(m,switching);
      const refresh=Math.max(1.5,delay+0.25);
      return delay<0.4 && (!b || b.n<(m.stacks || 1) || b.t<refresh) ? buffRank(m) : 0;
    }));
  }
  function selectSlot(p, enemies, now) {
    rotation = '等待目標';
    if (!p.setActive || !enemies.length) return;
    if (p.hasItem?.('choiceband') && p.slots[p.active]) { rotation = '講究頭帶鎖招'; return; }
    const current = p.slots[p.active] || [];
    const currentValue = rotationValue(p, current, enemies, false);
    const ready = current.some(m => damaging(m) && hitEstimate(p, m, current, enemies) > 0 && entryDelay(m, false) <= 0.12);
    rotation = ready ? '持續輸出' : '評估冷卻輪替';
    if (now - lastSwitch < 240 || now < switchCommitUntil) return;
    const currentPriority = enemies.some(e => e.kind !== 'chest') ? buffCastPriority(p,current,false,enemies) : 0;
    let best = p.active, bestValue = currentValue, bestPriority = currentPriority;
    p.slots.forEach((slot, i) => {
      if (i === p.active) return;
      const value = rotationValue(p, slot, enemies, true);
      const priority = enemies.some(e => e.kind !== 'chest') ? buffCastPriority(p,slot,true,enemies) : 0;
      if (priority > bestPriority || (priority === bestPriority && value > bestValue)) { best = i; bestValue = value; bestPriority = priority; }
    });
    // Never swap away from a useful attack that is about to fire for a tiny gain.
    const margin = Math.max(ready ? 5 : 1.5, currentValue * (ready ? 0.25 : 0.06));
    if (best !== p.active && (bestPriority > currentPriority || (bestPriority === currentPriority && bestValue > currentValue + margin))) {
      const selected = p.slots[best];
      const delays = selected.filter(m => (bestPriority > 0 && buffRank(m)) || (damaging(m) && hitEstimate(p, m, selected, enemies) > 0)).map(m => entryDelay(m, true));
      p.setActive(best);
      if (p.active === best) {
        lastSwitch = now;
        // Give the selected move enough active simulation time to fire once.
        switchCommitUntil = now + Math.min(1000, Math.max(240, (Math.min(...delays, 0.8) + 0.12) * 1000));
        rotation = `切換至第 ${best + 1} 槽`;
      }
    }
  }
  function attackPosition(p, q, enemies, profile) {
    if (!enemies.length || !profile || p.hp / p.maxHp < 0.35) return 0;
    const { move: m, mode, reach } = profile;
    // Re-evaluate the game's automatic target selection at the candidate position.
    const origin = {x:q.x,y:q.y,r:p.r};
    const enemy = targetFor(origin, p.slots[p.active], enemies);
    if (!enemy) return 0;
    const d = distance(q, enemy), safe = p.r + (enemy.r || 12) + 18 + bodyCaution(p) * 22;
    let ideal = Math.max(safe, profile.ideal);
    let coverage = null;
    if (['projectile', 'cone', 'boomerang'].includes(m.kind)) {
      coverage = fanCoverage(origin, m, p.slots[p.active], enemies);
      // Even fans have a central gap. Fit the nearest pair across the target's
      // hitbox when safe; never force contact merely to make every pellet hit.
      const gap = Math.min(...fanOffsets(m).map(Math.abs));
      if (gap > 0.01 && !m.homing) {
        const fit = ((enemy.r || 12) + (m.size || 6)) / Math.sin(Math.min(Math.PI / 2, gap + (m.kind === 'cone' ? 0.05 : 0.03)));
        ideal = Math.max(safe + 18, Math.min(ideal, fit * 0.85));
      }
    }
    if (mode === 'close' && m.kind === 'melee' && (m.t || 0) > 0.3) ideal += 35;
    if (mode === 'lure') {
      // Leave mines/patches behind, then let pursuers cross that route.
      const away = (distance(q, enemy) - distance(p, enemy)) * 0.65;
      const laid = trail.some(old => performance.now() - old.t < (m.dur || 4) * 1000 && distance(old, enemy) < reach + (enemy.r || 12));
      return away + (laid ? 12 : 0);
    }
    const error = Math.abs(d - ideal);
    let score = 95 * Math.exp(-error / (mode === 'close' || mode === 'orbit' ? 38 : 85));
    if (d > reach + (enemy.r || 0)) score -= Math.min(100, (d - reach) * 0.55);
    if (coverage) {
      score += 90 * Math.min(3, coverage.hits) + 45 * Math.min(2, coverage.targetHits);
      if (coverage.targetHits < 0.2) score -= 75;
    }
    if (d < safe) score -= 200;
    if (mode === 'orbit') {
      // Prefer circling so an enemy spends time in the orbit band.
      const dx = enemy.x - p.x, dy = enemy.y - p.y;
      const radial = Math.abs((q.x - p.x) * dx + (q.y - p.y) * dy) / Math.max(1, distance(p, enemy));
      score -= radial * 0.15;
    }
    return score;
  }
  function buildCard(c,p) {
    const score=cardScore(c,p);
    if(c.key==='stat:def') return score>0;
    if(c.key==='stat:rgn') return true;
    if(c.key==='stat:hp') return false;
    if(c.key==='stat:atk' && !poisonBuild(p)) return true;
    if(poisonBuild(p)) return score>=119;
    if(damagePlan.insufficient) return immediateDamageGain(c,p)>0 || (c.type==='stat' && score>=119) || (c.type==='evo');
    if (c.type === 'up' || c.type === 'evo' || score >= 124) return true;
    // Evolution prerequisites and escaping a melee-only start are useful now.
    if (c.type === 'stat' && score >= 119) return true;
    const m=game.Moves.BY_ID[c.key.split(':')[1]], main=mainSlot(p).filter(damaging);
    return c.type === 'new' && m && main.length > 0
      && main.every(move => ['melee','dash','mine','trail'].includes(move.kind))
      && ['projectile','homing','bounce','beam','charge','chain','meteor','turret'].includes(m.kind) && score >= 90;
  }
  function rerollEarly(p,now) {
    if (!Number.isFinite(p.level) || p.level > 15 || p.level < 1) return false;
    if (rerollState.player !== p || rerollState.level !== p.level)
      rerollState={player:p,level:p.level,attempts:0,offers:null};
    const button=document.getElementById('lvl-reroll');
    const left=Math.max(0,1+(p.rerollBonus || 0)-(p.rerolls || 0));
    if (!left || rerollState.attempts >= 2 || rerollState.offers === offers
      || !visible('lvl-reroll') || button.disabled || typeof button.click !== 'function') return false;
    // Never discard an immediately useful card, especially emergency healing.
    if (offers.some(c => buildCard(c,p) || (c.key === 'stat:heal' && p.hp/p.maxHp < 0.4))) return false;
    const moves=learned(p);
    let possible=moves.some(m => game.Moves.nextUpText?.(m) && buildCard({type:'up',key:'up:'+m.id},p));
    if (!possible && p.slots.length < (p.maxMoves || 4) && p.mon?.types && game.Moves.poolFor) {
      possible=game.Moves.poolFor(p.mon).some(id => !moves.some(m => m.id === id) && !p.banned?.has(id)
        && buildCard({type:'new',key:'new:'+id},p));
    }
    if (!possible) return false; // Do not chase maxed, banned or unavailable moves.
    rerollState.attempts++; rerollState.offers=offers;
    lastChoice=now; tactic='早期重抽 · 尋找核心招式';
    button.click(); // Native UI alone consumes the legitimate per-run allowance.
    return true; // The native handler replaces both offers and card elements.
  }
  function itemValue(id,p) {
    if(id==='choiceband') return -1000; // Never choose a move-locking item.
    if(id==='lifeorb') return -100; // Repeated self-damage undermines recovery.
    if(id==='leftovers') return 100;
    if(id==='assaultvest') {
      const base=(p.dmgReduce || 0)-(p.item==='assaultvest'?0.2:0)
        +(p.buffs?.def?.n || 0)*(p.buffs?.def?.amount || 0);
      return base>=0.8?20:90+Math.min(1,(0.8-base)/0.2)*5;
    }
    if(id==='focussash') return !Number.isFinite(p.sashT) || performance.now()-p.sashT>60000 ? 85 : 55;
    return ({shellbell:80,choicescarf:65,quickclaw:40,rockyhelmet:30,luckyegg:15,amuletcoin:10})[id] ?? 0;
  }
  function choose(p, now) {
    if (multiplayer() || settings.manualPoints) return; // Leave every choice and reroll to the player.
    if (now - lastChoice < 650) return;
    if (game.Game.state === 'levelup' && visible('scr-levelup')) {
      const cards = [...document.querySelectorAll('#cards .card')];
      const box=document.getElementById('cards');
      // Native RunUI ignores early clicks while its 600 ms input guard is
      // active. Do not mark an ignored click as an applied upgrade.
      if (!cards.length || box.classList.contains('done') || box.classList.contains('guard')) return;
      let index = 0;
      if (offers.length === cards.length) {
        if (offered === offers) return;
        if (rerollEarly(p,now)) return;
        for (let i = 1; i < offers.length; i++) if (cardScore(offers[i], p) > cardScore(offers[index], p)) index = i;
        offered = offers;
      }
      lastChoice = now; cards[index].click();
    } else if (visible('scr-item')) {
      if(document.getElementById('item-cards')?.classList.contains('guard')) return;
      const cards = [...document.querySelectorAll('#item-cards .card')];
      const ids=itemChoice?.ids;
      let index=0;
      if(ids?.length===cards.length)for(let i=1;i<ids.length;i++) {
        if(itemValue(ids[i],p)>itemValue(ids[index],p))index=i;
      }
      const card = cards[index];
      if (card) { lastChoice = now; card.click(); }
    } else if (visible('scr-bond')) {
      if(document.getElementById('bond-cards')?.classList.contains('guard')) return;
      const cards = [...document.querySelectorAll('#bond-cards .card')];
      let index = 0, candidates = [];
      if (bondChoice) {
        const { opt, first } = bondChoice;
        candidates = first ? opt.loose.filter(m => m !== first) : opt.loose;
        const group = opt.group || (first ? [first] : []);
        if (candidates.length === cards.length) {
          let best = -Infinity;
          candidates.forEach((m, i) => {
            const score = fusionChoiceValue(group,m,candidates,opt.mode === 'pair' && !first);
            if (score > best) { best = score; index = i; }
          });
        } else candidates = []; // A manual selection may have changed the step.
      }
      if (cards[index]) {
        if (bondChoice?.opt.mode === 'pair' && !bondChoice.first && candidates[index]) bondChoice.first = candidates[index];
        else bondChoice = null;
        lastChoice = now; cards[index].click();
      }
    }
  }
  const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  function buildTerrain(p, now) {
    const step = Math.max(game.World.TS || 32, Math.min(48, p.r + 8)), r = 9, n = r * 2 + 1;
    if (terrain && now - terrain.at < 400 && distance(p, terrain.center) < step * 0.8) return terrain;
    const ox = p.x - r * step, oy = p.y - r * step;
    const open = new Uint8Array(n * n), cover = new Uint8Array(n * n), costs = new Float32Array(n*n);
    const traps = [...(game.World.specialsNear?.(p.x,p.y,800) || [])]
      .filter(o=>o.type === 'trap' && o.hp !== 0);
    const warnings=(game.Hazards?.all || []).filter(h=>!h.hit && (h.delay ?? 0)-(h.t || 0)<4);
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      const wx = ox + x * step, wy = oy + y * step, i = y * n + x;
      open[i] = game.World.isFree(wx, wy, p.r, false) ? 1 : 0;
      const liquid = game.World.isLiquid?.(wx,wy) && game.World.liquidEffect?.(p.mon?.types || []);
      costs[i] = (liquid ? 1/Math.max(0.1,liquid.slow || 1) + (liquid.dmg ? 12 : liquid.slide ? 0.6 : 0) : 1)
        + (traps.some(o=>Math.hypot(wx-o.x,wy-(o.y-8))<32) ? 9 : 0)
        + (warnings.some(h=>game.Hazards.inside(h,wx,wy,p.r+8)) ? 8 : 0);
      cover[i] = game.World.projectileBlock ? (game.World.projectileBlock(wx, wy, 3) ? 1 : 0)
        : game.World.isWall?.(wx, wy) ? 1 : 0;
    }
    open[r * n + r] = 1; // The player may already be touching an obstacle.
    terrain = { at: now, center: { x:p.x, y:p.y }, step, n, ox, oy, open, cover, costs, traps,
      allOpen:open.every(Boolean), branches:new Map() };
    return terrain;
  }
  function gridIndex(map, x, y) {
    const gx = Math.round((x - map.ox) / map.step), gy = Math.round((y - map.oy) / map.step);
    return gx >= 0 && gy >= 0 && gx < map.n && gy < map.n ? gy * map.n + gx : -1;
  }
  function gridLine(map, a, b, forShots = false) {
    const length = distance(a, b), steps = Math.max(1, Math.ceil(length / (map.step * 0.45)));
    let previous = -1;
    for (let k = 0; k <= steps; k++) {
      const index = gridIndex(map, a.x + (b.x - a.x) * k / steps, a.y + (b.y - a.y) * k / steps);
      if (index < 0) return true; // Unknown ground is never claimed as cover.
      if (forShots ? map.cover[index] : !map.open[index]) return false;
      if (!forShots && previous >= 0) {
        const px = previous % map.n, py = (previous / map.n) | 0;
        const nx = index % map.n, ny = (index / map.n) | 0;
        if (nx !== px && ny !== py && (!map.open[py * map.n + nx] || !map.open[ny * map.n + px])) return false;
      }
      previous = index;
    }
    return true;
  }
  function straightFree(p, q) {
    const d = distance(p, q), steps = Math.max(1, Math.ceil(d / Math.max(6, Math.min(12, p.r))));
    for (let k = 1; k <= steps; k++) {
      if (!game.World.isFree(p.x + (q.x - p.x) * k / steps, p.y + (q.y - p.y) * k / steps, p.r, false)) return false;
    }
    return true;
  }
  function forwardRoom(map, p, q, dir) {
    const start = gridIndex(map, q.x, q.y);
    if (start < 0 || !map.open[start]) return { count:0, exits:0 };
    if (map.allOpen) return { count:map.open.length / 2, exits:map.n * 2 };
    const key = `${start}:${Math.round(dir[0] * 100)},${Math.round(dir[1] * 100)}`;
    if (map.branches.has(key)) return map.branches.get(key);
    const visited = new Uint8Array(map.open.length), queue = [start]; visited[start] = 1;
    const retreatEdge = Math.max(map.step * 0.3, ((q.x - p.x) * dir[0] + (q.y - p.y) * dir[1]) * 0.65);
    let head = 0, exits = 0;
    while (head < queue.length) {
      const index = queue[head++], x = index % map.n, y = (index / map.n) | 0;
      if (x === 0 || y === 0 || x === map.n - 1 || y === map.n - 1) exits++;
      for (const [dx, dy] of terrainDirections) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= map.n || ny >= map.n) continue;
        const next = ny * map.n + nx;
        if (visited[next] || !map.open[next]) continue;
        if (dx && dy && (!map.open[y * map.n + nx] || !map.open[ny * map.n + x])) continue;
        const wx = map.ox + nx * map.step, wy = map.oy + ny * map.step;
        // Exclude the retreat side: a deep pocket is not an escape route merely
        // because it connects back through the entrance we just crossed.
        if ((wx - p.x) * dir[0] + (wy - p.y) * dir[1] < retreatEdge) continue;
        visited[next] = 1; queue.push(next);
      }
    }
    const room = { count:queue.length, exits }; map.branches.set(key, room); return room;
  }
  function terrainPosition(p, q, dir, enemies, profile, map) {
    let score = 0;
    if (dir[0] || dir[1]) {
      const room = forwardRoom(map, p, q, dir);
      // A local dead end remains unattractive even when it contains valuable loot.
      if (!room.exits) score -= 170;
      score -= 100 * Math.exp(-room.count / 16);
      score += Math.min(30, room.exits * 2);
    }
    const close = enemies.filter(e => distance(q, e) < 230).slice(0, 48);
    let safeExits = 0;
    for (const [dx, dy] of terrainDirections) {
      const length = map.step * 3, norm = dx && dy ? Math.SQRT1_2 : 1;
      const end = {x:q.x + dx * norm * length,y:q.y + dy * norm * length};
      if (!gridLine(map, q, end)) continue;
      const blocked = close.some(e => {
        const vx = e.x - q.x, vy = e.y - q.y, along = (vx * dx + vy * dy) * norm;
        const across = Math.abs(vx * dy - vy * dx) * norm;
        // Forecast pursuit closing an exit, instead of looking only at contact now.
        return along > -p.r && along < length + (e.spd || 60) * 0.65 && across < p.r + (e.r || 12) + 16
          && (e.flying || gridLine(map, q, e));
      });
      if (!blocked) safeExits++;
    }
    if (close.length) {
      score -= Math.max(0, 3 - safeExits) * 65;
    } else score -= Math.max(0, 2 - safeExits) * 15;
    score += Math.min(5, safeExits) * 9;
    // Cover is useful while moving, but hiding behind it must not suppress all
    // ranged damage. Reward cover from extra threats, not a blocked main shot.
    if (profile && ['ranged', 'turret'].includes(profile.mode) && enemies.length) {
      const target = enemies.includes(p.target) ? p.target : enemies[0];
      const canFire = gridLine(map, q, target, true);
      if (!canFire && ['beam', 'projectile', 'cone', 'boomerang'].includes(profile.move.kind)) score -= 35;
      for (const e of enemies.slice(0, 8)) {
        if (distance(q, e) < 330 && !gridLine(map, q, e, true)) score += e === target ? 3 : 10;
      }
    }
    return { score, safeExits };
  }
  function altarExits(p, site, map) {
    return terrainDirections.filter(([dx,dy])=>{
      const scale = map.step*3/(dx && dy ? Math.SQRT2 : 1);
      return straightFree({x:site.x,y:site.y,r:p.r},{x:site.x+dx*scale,y:site.y+dy*scale});
    }).length;
  }
  function propDetour(a,b,prop,radius) {
    const da=distance(a,prop),db=distance(b,prop),direct=distance(a,b);
    if(da<=radius || db<=radius) return direct;
    const angle=Math.acos(clamp(((a.x-prop.x)*(b.x-prop.x)+(a.y-prop.y)*(b.y-prop.y))/(da*db),-1,1));
    const arc=angle-Math.acos(radius/da)-Math.acos(radius/db);
    return arc>0 ? Math.sqrt(da*da-radius*radius)+Math.sqrt(db*db-radius*radius)+radius*arc : direct;
  }
  function projectileBlockedAt(s, horizon) {
    if (!game.World.projectileBlock) return Infinity;
    const limit=Math.max(0,Math.min(horizon,s.life == null ? horizon : s.life-(s.t || 0)));
    const vx=s.vx || 0,vy=s.vy || 0,r=s.r ?? 6;
    const key=`${s.x}:${s.y}:${vx}:${vy}:${r}`;
    const cached=projectileCoverCache.get(key);
    if(cached && cached.limit>=limit && !(cached.prop?.hp<=0)
      && cached.hp===cached.prop?.hp && cached.open===cached.prop?.open) return cached.at<=limit ? cached.at : Infinity;
    const speed=Math.hypot(vx,vy),steps=Math.max(1,Math.ceil(speed*limit/Math.max(2,Math.min(5,r))));
    let blocked=Infinity,prop=null;
    for(let i=0;i<=steps;i++) {
      const t=limit*i/steps,hit=game.World.projectileBlock(s.x+vx*t,s.y+vy*t,r);
      if(hit && (typeof hit!=='object' || (!(hit.hp<=0) && t<coverLifetime(hit)))) {blocked=t;prop=hit;break;}
    }
    projectileCoverCache.set(key,{at:blocked,limit,prop,hp:prop?.hp,open:prop?.open});return blocked;
  }
  function coverLifetime(prop) {
    if(prop.type==='bigchest') return Math.max(0,3.5-(prop.open || 0));
    if(!Number.isFinite(prop.hp)) return Infinity;
    const cached=coverLifetimeCache.get(prop);
    if(cached?.hp===prop.hp) return cached.time;
    const hits=[];
    for(const s of game.Projectiles.all()) {
      if(!s.friendly || s.orb || s.gone) continue;
      const vx=s.vx || 0,vy=s.vy || 0,vv=vx*vx+vy*vy;
      if(!vv) continue;
      const dx=s.x-prop.x,dy=s.y-prop.y,b=dx*vx+dy*vy,c=dx*dx+dy*dy-((s.r || 6)+(prop.r || 12))**2;
      const disc=b*b-vv*c;
      if(disc<0 || (b>=0 && c>0)) continue;
      const t=Math.max(0,(-b-Math.sqrt(disc))/vv);
      if(t<=(s.life ?? Infinity)-(s.t || 0)) hits.push({t,damage:s.dmg || 0});
    }
    hits.sort((a,b)=>a.t-b.t);
    let hp=prop.hp,time=Infinity;
    for(const hit of hits) if((hp-=hit.damage)<=0){time=hit.t;break;}
    // Opening by our next cast can remove ordinary cover before an incoming shot.
    const player=game.Game.player;
    if(player?.target===prop) for(const move of player.slots?.[player.active] || []) {
      if(!damaging(move)) continue;
      const damage=(move.dmg || 0)*(player.atk || player.atkMul || 1)*Math.max(1,move.count || 1);
      if(damage>=prop.hp) time=Math.min(time,Math.max(0,move.t || 0)+Math.max(0,distance(player,prop)-player.r-(prop.r || 12))/Math.max(1,move.speed || 350));
    }
    coverLifetimeCache.set(prop,{hp:prop.hp,time});return time;
  }
  function chestSafe(p, chest, map, enemies, shots, hazards, siteOverride = null) {
    if (p.hp < p.maxHp * (chest.type === 'altar' ? 0.2 : 0.35)) return false;
    const locked = chest.type === 'bigchest', d = distance(p, chest);
    const radius = chest.type === 'altar' || locked ? interactionRadii(p,chest).radius : Math.max((chest.r || 12) + p.r + 8, 42);
    const scale = d > radius ? (d - radius * 0.85) / d : 0;
    const site = siteOverride || {x:p.x + (chest.x-p.x)*scale,y:p.y + (chest.y-p.y)*scale};
    // Locked chests require 3.5 seconds of exposure. Check both the current
    // position and the intended interaction spot on every decision, not scan.
    const horizon = chest.type === 'altar' ? 0.65 : locked ? 3.8 : 1.2;
    for (const q of siteOverride ? [site] : [p, site]) {
      for (const e of enemies) {
        const gap = distance(q,e) - p.r - (e.r || 12);
        if (gap < 25) return false;
        const route=chest.type === 'altar' || e.flying ? distance(q,e)
          : propDetour(e,q,chest,(chest.r || 12)+(e.r || 12));
        if ((chest.type !== 'altar' || e.flying || gridLine(map,q,e))
          && route-p.r-(e.r || 12) < 40 + Math.max(0,e.spd ?? 60)*horizon) return false;
      }
      for (const s of shots) {
        const vx = s.vx || 0, vy = s.vy || 0, vv = vx*vx+vy*vy;
        const alive=Math.max(0,Math.min(horizon,s.life == null ? horizon : s.life-(s.t || 0)));
        if(!alive) continue;
        const closest=vv ? clamp(((q.x-s.x)*vx+(q.y-s.y)*vy)/vv,0,alive) : 0;
        if(Math.hypot(q.x-s.x-vx*closest,q.y-s.y-vy*closest)>=p.r+(s.r || 6)+22) continue;
        const blocked=projectileBlockedAt(s,closest);
        const t = Math.min(closest,blocked);
        if (Math.hypot(q.x-s.x-vx*t,q.y-s.y-vy*t) < p.r+(s.r || 6)+22) return false;
      }
      if (hazards.some(h => game.Hazards.inside(h,q.x,q.y,p.r+16))) return false;
    }
    if (distance(p,site) < map.step*6
      && (chest.type === 'altar' || siteOverride ? altarExits(p,site,map) : terrainPosition(p,site,[0,0],enemies,null,map).safeExits) < 2) return false;
    return true;
  }
  function interactionRadii(p, prop) {
    const inner = (prop.r ?? (prop.type === 'altar' ? 9 : 14)) + p.r + 3;
    const trigger = Math.max(prop.type === 'altar' ? 30 : 46,
      (prop.r ?? (prop.type === 'altar' ? 9 : 14)) + p.r + (prop.type === 'altar' ? 14 : 24));
    // Leave room on both sides: collision inside, strict native trigger outside.
    const radius = trigger - 6;
    return {inner,trigger,radius,ring:inner + (radius-inner)*0.45};
  }
  function chestSite(p,chest,map,enemies,shots,hazards) {
    const now=performance.now(),cached=chestSiteCache.get(chest);
    const proximity = ['altar','bigchest'].includes(chest.type), bounds = interactionRadii(p,chest);
    if(cached && ((now-cached.at<150 && distance(p,cached.origin)<32) || (proximity && distance(p,cached.site)<8))
      && (!proximity || distance(cached.site,chest)<bounds.radius)
      && game.World.isFree(cached.site.x,cached.site.y,p.r,false)
      && chestSafe(p,chest,map,enemies,shots,hazards,cached.site)) return cached.site;
    const inner=proximity ? bounds.inner : (chest.r || 12)+p.r+3;
    const outer=proximity ? bounds.radius : Math.max(42,inner+8);
    const radius=proximity ? bounds.ring : inner+(outer-inner)*0.65,base=Math.atan2(p.y-chest.y,p.x-chest.x);
    let best=null,bestScore=-Infinity;
    // Deeper spots resist edge jitter; an outer safe ring remains available
    // when cover is about to expire or another solid prop narrows the pocket.
    const rings=proximity ? [radius,outer-1,inner+1] : [radius];
    for(const ring of rings) for(let i=0;i<16;i++) {
      const angle=base+i*Math.PI/8,q={x:chest.x+Math.cos(angle)*ring,y:chest.y+Math.sin(angle)*ring};
      if(!game.World.isFree(q.x,q.y,p.r,false) || !chestSafe(p,chest,map,enemies,shots,hazards,q)) continue;
      let cover=0;
      for(const e of enemies.filter(e=>e.behavior==='ranged' && distance(e,q)<600).slice(0,12)) {
        const shot={x:e.x,y:e.y,vx:q.x-e.x,vy:q.y-e.y,r:3,life:1};
        if(projectileBlockedAt(shot,1)<1) cover++;
      }
      for(const s of shots) {
        const vx=s.vx || 0,vy=s.vy || 0,vv=vx*vx+vy*vy;
        const t=vv ? ((q.x-s.x)*vx+(q.y-s.y)*vy)/vv : -1;
        if(t>0 && t<3.8 && Math.hypot(q.x-s.x-vx*t,q.y-s.y-vy*t)<p.r+(s.r || 6)+12
          && projectileBlockedAt(s,t)<t) cover++;
      }
      const cost=propDetour(p,q,chest,inner);
      const score=cover*35-cost*0.35-Math.abs(ring-radius)*0.6;
      if(score>bestScore) {best={...q,cover,ring};bestScore=score;}
    }
    if(best) chestSiteCache.set(chest,{at:now,origin:{x:p.x,y:p.y},site:best});
    return best;
  }
  function chooseObjective(p, now, map, enemies, shots, hazards, unsafeChests) {
    if (game.Rift?.inArena) return null;
    const rift = !multiplayer() && game.Rift?.rift;
    const riftGoal = rift && rift.ttl > 0 ? {kind:'rift',x:rift.x,y:rift.y-10,radius:22,
      ttl:rift.ttl,label:'前往裂縫打王'} : null;
    if (riftGoal) {
      objectiveWaypoint(p,riftGoal,map);
      const travel = map.goalRoute?.travelSeconds ?? distance(p,riftGoal)/Math.max(1,p.spd || 100);
      riftGoal.label = `前往裂縫打王 · 剩 ${Math.ceil(rift.ttl)}s / 路程約 ${Math.ceil(travel)}s`;
      riftGoal.urgent = rift.ttl <= travel + 6;
      if (riftGoal.urgent) { riftGoal.label = `裂縫倒數 ${Math.ceil(rift.ttl)}s · 優先進入`; return riftGoal; }
    }
    if (!objectiveScan || now - objectiveScan.at > 700 || distance(p, objectiveScan.center) > 120) {
      const props = [...(game.World.propsInCircle?.(p.x,p.y,600) || []),
        ...(game.World.specialsNear?.(p.x,p.y,600) || [])];
      objectiveScan = {at:now,center:{x:p.x,y:p.y},props:[...new Set(props)].filter(o => ['altar','chest','bigchest'].includes(o.type))};
    }
    // Altars are personal even in co-op. Do not overwrite a fresh 25s power.
    if (!p.power || !(p.power.t > 5)) {
      const labels = ['傷害 ×2','速度 +45%','吸取範圍 ×4','冷卻 −40%'];
      const altars = objectiveScan.props.filter(o=>o.type === 'altar' && !o.used
        && o.hp !== 0 && Number.isInteger(o.kind) && o.kind >= 0 && o.kind < 4 && distance(p,o)<650)
        .sort((a,b)=>distance(p,a)-distance(p,b));
      for (const altar of altars) {
        const site=chestSite(p,altar,map,enemies,shots,hazards);
        if (!site) continue;
        const goal = {kind:'altar',x:altar.x,y:altar.y,prop:altar,site,
          radius:interactionRadii(p,altar).radius,label:`使用祭壇 · ${labels[altar.kind]}`};
        // A blocked altar must not pin navigation to a route with no progress.
        if (distance(p,goal)>goal.radius && distance(p,objectiveWaypoint(p,goal,map))<1) continue;
        return goal;
      }
    }
    if (multiplayer()) return null; // Shared chests/rifts still stay manual.
    if (riftGoal) return riftGoal;
    const sites=new Map();
    const chest = objectiveScan.props.filter(o => {
      if (!['chest','bigchest'].includes(o.type)) return false;
      if (!(o.hp > 0) || distance(p,o) >= 650) return false;
      const site=chestSite(p,o,map,enemies,shots,hazards);
      if (site) {sites.set(o,site);return true;}
      if (o.type === 'bigchest') unsafeChests.push(o);
      return false;
    })
      .sort((a,b) => distance(p,a) / (a.type === 'bigchest' ? 1.4 : 1) - distance(p,b) / (b.type === 'bigchest' ? 1.4 : 1))[0];
    if (!chest) return null;
    const locked = chest.type === 'bigchest';
    const site=sites.get(chest);
    return {kind:locked?'bigchest':'chest',x:chest.x,y:chest.y,prop:chest,site,
      radius:locked ? interactionRadii(p,chest).radius : Math.max((chest.r || 12) + p.r + 8,42),
      label:site.cover ? (locked ? '繞行寶箱 · 掩護開鎖' : '繞行寶箱 · 掩護攻擊') : locked ? '靠近並開啟鎖箱' : '靠近並攻擊寶箱'};
  }
  function objectiveWaypoint(p, goal, map) {
    if (goal.site) {
      const chest=goal.prop,site=goal.site,radial=distance(p,chest);
      if(distance(p,site)<5) return site;
      if(straightFree(p,site)) return site;
      if(radial<site.ring*2.5) {
        const from=Math.atan2(p.y-chest.y,p.x-chest.x),to=Math.atan2(site.y-chest.y,site.x-chest.x);
        let best=null,cost=Infinity;
        for(const sign of [-1,1]) {
          const delta=((to-from)*sign+Math.PI*4)%(Math.PI*2);
          const angle=from+sign*Math.min(0.35,delta);
          const q={x:chest.x+Math.cos(angle)*site.ring,y:chest.y+Math.sin(angle)*site.ring};
          if(!straightFree(p,q)) continue;
          const value=delta*site.ring+distance(p,q);
          if(value<cost){cost=value;best=q;}
        }
        if(best) return best;
      }
      goal={...goal,x:site.x,y:site.y,radius:5};
    }
    if (distance(p,goal) <= goal.radius) return p;
    if (goal.kind === 'altar') {
      // Aim at the reachable edge of the solid altar, not its blocked grid cell.
      const d = distance(p,goal), stop = ((goal.prop.r || 9)+p.r+goal.radius)/2;
      const site = {x:goal.x+(p.x-goal.x)*stop/d,y:goal.y+(p.y-goal.y)*stop/d};
      if (straightFree(p,site)) return site;
    }
    const start = gridIndex(map,p.x,p.y);
    const key = `${start}:${goal.kind}:${goal.kind==='hunt' ? Math.round(goal.x/map.step) : goal.x}:${goal.kind==='hunt' ? Math.round(goal.y/map.step) : goal.y}`;
    const cached = map.goalRoutes?.get(key);
    if (cached) {map.goalRoute=cached;return cached.point;}
    if (start < 0) return p;
    const parents = new Int16Array(map.open.length).fill(-1), costs = new Float64Array(map.open.length).fill(Infinity);
    const visited = new Uint8Array(map.open.length), queue = [start]; parents[start] = start; costs[start]=0;
    let best = start, bestValue = Infinity;
    while (queue.length) {
      queue.sort((a,b)=>costs[b]-costs[a]);
      const i = queue.pop(); if (visited[i]) continue; visited[i]=1;
      const x = i % map.n, y = (i / map.n) | 0;
      const point = {x:map.ox+x*map.step,y:map.oy+y*map.step};
      const remaining = Math.max(0,distance(point,goal) - goal.radius);
      const value = remaining + costs[i] * 0.04;
      if (value < bestValue) {bestValue=value;best=i;}
      for (const [dx,dy] of terrainDirections) {
        const nx=x+dx,ny=y+dy,next=ny*map.n+nx;
        if (nx<0 || ny<0 || nx>=map.n || ny>=map.n || !map.open[next] || visited[next]) continue;
        if (dx && dy && (!map.open[y*map.n+nx] || !map.open[ny*map.n+x])) continue;
        const nextPoint={x:map.ox+nx*map.step,y:map.oy+ny*map.step};
        if (!straightFree({...point,r:p.r},nextPoint)) continue;
        const cost=costs[i]+map.step*(dx && dy ? Math.SQRT2 : 1)*(map.costs[i]+map.costs[next])/2;
        if (cost>=costs[next]) continue;
        parents[next]=i;costs[next]=cost;queue.push(next);
      }
    }
    const path=[];
    for (let i=best;i!==start;i=parents[i]) path.push(i);
    path.reverse();
    let point = p;
    for (const i of path.slice(0,4)) {
      const next={x:map.ox+(i%map.n)*map.step,y:map.oy+((i/map.n)|0)*map.step};
      if (!straightFree(p,next)) break;
      // Do not smooth a safe detour back across a slow pool or a trap.
      const samples=Math.max(1,Math.ceil(distance(p,next)/12));
      let expensive=false;
      for(let s=1;s<=samples;s++) {
        const index=gridIndex(map,p.x+(next.x-p.x)*s/samples,p.y+(next.y-p.y)*s/samples);
        if(index>=0 && map.costs[index]>1.1) {expensive=true;break;}
      }
      if (expensive && point !== p) break;
      point=next;
    }
    if (distance(p,goal)<map.step*2 && straightFree(p,goal) && (!path.length || distance(point,goal)<map.step)) point=goal;
    // Risk penalties guide the route, but must not masquerade as travel seconds.
    const effect=game.World.liquidEffect?.(p.mon?.types || []) || {};
    const baseSpeed=Math.max(1,(p.spd || 100)/(p.inLiquid ? effect.slow || 1 : 1));
    let travel=0,previous=p;
    for(const index of path) {
      const next={x:map.ox+(index%map.n)*map.step,y:map.oy+((index/map.n)|0)*map.step};
      const wet=game.World.isLiquid?.((previous.x+next.x)/2,(previous.y+next.y)/2);
      travel+=distance(previous,next)/(baseSpeed*(wet ? effect.slow || 1 : 1));previous=next;
    }
    travel+=Math.max(0,distance(previous,goal)-goal.radius)/baseSpeed;
    map.goalRoute={key,point,travelSeconds:travel};
    if (!map.goalRoutes) map.goalRoutes=new Map();
    map.goalRoutes.set(key,map.goalRoute);
    return point;
  }
  function objectiveScore(p,q,dir,goal,waypoint) {
    const d=distance(q,goal), before=distance(p,goal);
    if(goal.site) return (d<=goal.radius ? 105 : 0)
      +(distance(p,waypoint)-distance(q,waypoint))*4-distance(q,goal.site)*0.5
      +(goal.kind==='bigchest' && d<=goal.radius && !dir[0] && !dir[1] ? 32 : 0)
      -(before<=goal.radius && d>goal.radius ? 100 : 0);
    if (d <= goal.radius) {
      // Stay inside the actual interaction radius for 3.5 s, without directly
      // opening a prop or forcing arena entry. Combat/hazard penalties still win.
      return 105 + (goal.kind==='bigchest' && !dir[0] && !dir[1] ? 24 : 0);
    }
    const progress=distance(p,waypoint)-distance(q,waypoint);
    return progress * (goal.urgent ? 12 : goal.kind === 'hunt' ? 5 : goal.kind === 'altar' ? 4 : 3) + clamp(before-d,-35,35)*0.1
      - (before<=goal.radius ? 90 : 0);
  }
  // Predict on the ground plane used by Combat.resolve, not sprite height.
  // Extra body width takes time to clear a shot or a closing passage.
  function bodyCaution(p) { return clamp((p.r - 12) / 20, 0, 1.5); }
  function survivalHorizon(p, speed) {
    return clamp(0.65 + 2.8 * p.r / Math.max(25, speed), 0.9, 2.2);
  }
  function movementPlan(p, dir, speed, horizon = 0.9, stopAfter = Infinity) {
    const segments = [];
    const effect = game.World.liquidEffect?.(p.mon?.types || []) || {};
    const currentSlow = p.inLiquid ? effect.slow || 1 : 1;
    const baseSpeed = speed / currentSlow / (p.slowT > 0 ? 0.5 : 1);
    const traps = terrain?.traps || [];
    const dynamic = !!game.World.isLiquid || traps.length > 0 || p.slowT > 0;
    let stickyUntil = p.slowT || 0, terrainScore = 0, trapHit = false, previousWet=!!p.inLiquid;
    const triggeredTraps=new Set();
    let x = p.x, y = p.y, vx = p.svx || 0, vy = p.svy || 0;
    for (let start = 0; start < horizon - 1e-6;) {
      const wet = game.World.isLiquid ? game.World.isLiquid(x,y) : p.inLiquid;
      if (wet && !previousWet && (effect.slow || effect.dmg || effect.slide)) terrainScore -= effect.dmg ? 400 : 90;
      previousWet=wet;
      const slide = wet && effect.slide;
      const pace = baseSpeed * (wet ? effect.slow || 1 : 1) * (start < stickyUntil ? 0.5 : 1);
      const targetX = p.frozen ? 0 : dir[0] * pace * (slide ? 1.15 : 1);
      const targetY = p.frozen ? 0 : dir[1] * pace * (slide ? 1.15 : 1);
      const tx = start < stopAfter ? targetX : 0, ty = start < stopAfter ? targetY : 0;
      const end = Math.min(horizon,slide || dynamic ? start+0.06 : horizon,start < stopAfter ? stopAfter : horizon), dt = end-start;
      // Integrate the game's exponential ice damping; each short segment uses
      // its average velocity, so stopping does not assume instant braking.
      const k = slide ? (1-Math.exp(-1.6*dt))/(1.6*dt) : 0;
      const ax = tx+(vx-tx)*k, ay = ty+(vy-ty)*k;
      segments.push({x,y,vx:ax,vy:ay,start,end});
      x += ax*dt; y += ay*dt;
      if (wet) terrainScore -= dt*(effect.dmg ? 1400 : effect.slow ? 90*(1/effect.slow-1) : effect.slide ? 18 : 0);
      for (const trap of traps) {
        if (trap.hp === 0 || triggeredTraps.has(trap)) continue;
        // Native traps trigger within 13px of (x,y-8), independently of body radius.
        const seg = segments[segments.length-1], dx=x-seg.x, dy=y-seg.y, vv=dx*dx+dy*dy;
        const u=vv ? clamp(((trap.x-seg.x)*dx+(trap.y-8-seg.y)*dy)/vv,0,1) : 0;
        if (Math.hypot(seg.x+dx*u-trap.x,seg.y+dy*u-(trap.y-8))<17) {
          terrainScore -= trap.kind === 1 ? 900 : 1600;
          trapHit = true;
          triggeredTraps.add(trap);
          if (trap.kind === 1) stickyUntil = Math.max(stickyUntil,start+3.5);
        }
      }
      vx = tx+(vx-tx)*Math.exp(-1.6*dt); vy = ty+(vy-ty)*Math.exp(-1.6*dt);
      start = end;
    }
    return {segments,horizon,terrainScore,trapHit,at(t) {
      t = clamp(t,0,horizon);
      const seg = segments.find(s=>t<=s.end) || segments[segments.length-1];
      return {x:seg.x+seg.vx*(t-seg.start),y:seg.y+seg.vy*(t-seg.start)};
    }};
  }
  function projectileDanger(p, plan, shots) {
    let score = 0, hits = 0, actualHits = 0, imminentHits = 0, earliest = Infinity, clearance = Infinity;
    for (const s of shots) {
      const remaining = s.life == null ? Infinity : s.life-(s.t || 0);
      if (!(remaining > 0)) continue;
      const bvx = s.vx || 0, bvy = s.vy || 0;
      const radius = p.r+(s.r ?? 6);
      const margin = 5+Math.min(9,Math.hypot(bvx,bvy)*0.015)+bodyCaution(p)*8;
      const blocked=projectileBlockedAt(s,Math.min(remaining,plan.horizon));
      let closest = Infinity, entry = Infinity, actualEntry = Infinity;
      for (const seg of plan.segments) {
        const duration = Math.min(seg.end,remaining,blocked)-seg.start;
        if (duration <= 0) break;
        const rx = s.x+bvx*seg.start-seg.x, ry = s.y+bvy*seg.start-seg.y;
        const vx = bvx-seg.vx, vy = bvy-seg.vy, vv = vx*vx+vy*vy;
        const t = vv > 1e-8 ? clamp(-(rx*vx+ry*vy)/vv,0,duration) : 0;
        closest = Math.min(closest,Math.hypot(rx+vx*t,ry+vy*t)-radius);
        const actualC = rx*rx+ry*ry-radius*radius, b = rx*vx+ry*vy;
        if (actualC <= 0) actualEntry = Math.min(actualEntry,seg.start);
        else if (vv > 1e-8 && b < 0) {
          const disc = b*b-vv*actualC;
          if (disc >= 0) {
            const enter = (-b-Math.sqrt(disc))/vv;
            if (enter >= 0 && enter <= duration) actualEntry = Math.min(actualEntry,seg.start+enter);
          }
        }
        const c = rx*rx+ry*ry-(radius+margin)**2;
        if (c <= 0) entry = Math.min(entry,seg.start);
        else if (vv > 1e-8) {
          const b = rx*vx+ry*vy, disc = b*b-vv*c;
          if (b < 0 && disc >= 0) {
            const enter = (-b-Math.sqrt(disc))/vv;
            if (enter >= 0 && enter <= duration) entry = Math.min(entry,seg.start+enter);
          }
        }
      }
      clearance = Math.min(clearance,closest);
      if (closest < 0) actualHits++;
      if (actualEntry <= 0.65) imminentHits++;
      if (entry < Infinity) {
        hits++; earliest = Math.min(earliest,entry);
        const damage = clamp((s.dmg || 10)/Math.max(1,p.hp),0.05,2);
        score -= (2600+1800*Math.exp(-entry/0.22))*(1+damage);
      }
      score -= 90*Math.exp(-Math.max(0,closest)/22);
    }
    return {score,hits,actualHits,imminentHits,earliest,clearance};
  }
  function pursuitDanger(p, plan, enemies, profile) {
    let score = 0, contact = false;
    const caution = bodyCaution(p), health = p.hp / p.maxHp;
    const closeBuild = profile && ['close', 'orbit'].includes(profile.mode);
    const weight = health < 0.35 ? 2 : closeBuild && health >= 0.6 ? 0.35 + caution * 0.65 : 1 + caution * 0.4;
    for (const e of enemies) {
      let x = e.x, y = e.y;
      const radius = p.r + (e.r || 12);
      const speed = Math.max(0, e.spd ?? 0) * (1 - clamp(e.slow || 0, 0, 1))
        * (game.Weather?.speedFor?.(e.types || []) ?? 1);
      // Cull only enemies unable to reach this trajectory, including dash speed.
      if (distance(e,p) > radius + (speed * 3.4 + Math.max(p.spd || 0,Math.hypot(p.svx || 0,p.svy || 0))) * plan.horizon + 260) continue;
      if (distance(e,p) > radius + (speed*(e.phase === 'dash' ? 3.4 : 1)
        + Math.max(p.spd || 0,Math.hypot(p.svx || 0,p.svy || 0))) * plan.horizon + 60) {
        const gap = distance(e,plan.at(0.65))-radius;
        score -= 210*weight*Math.exp(-Math.max(0,gap)/(55+caution*12));
        continue;
      }
      for (let t = 0; t < plan.horizon - 1e-6;) {
        const a = plan.at(t);
        // Resolve close pursuit more finely so a pursuer cannot overshoot us
        // in a long prediction step and make running through it look safer.
        const dt = Math.min(Math.hypot(a.x-x,a.y-y)-radius < 30 ? 0.08 : 0.24,plan.horizon-t);
        const b = plan.at(t+dt);
        let dx = a.x-x, dy = a.y-y, d = Math.hypot(dx,dy), pace = speed;
        if (!e.flying && !e.legend && !e.judge && game.World.isLiquid?.(x,y)) {
          const liquid=game.World.liquidEffect?.(e.types || []);
          if(liquid?.slow) pace*=liquid.slow<0.5 ? 0.45 : 0.55;
        }
        if (e.behavior === 'runner') {
          const lead = clamp(d / Math.max(60,speed),0,1.4);
          dx += (b.x-a.x)/dt*lead; dy += (b.y-a.y)/dt*lead;
        }
        if (e.keepsDistance?.()) {
          const keep = (e.def?.range || 200)*0.82;
          if (d < keep*0.75) pace *= -0.8;
          else if (d < keep) pace *= 0.1;
        }
        if (e.phase === 'aim' || e.phase === 'fuse' || e.jump) pace = 0;
        if (e.phase === 'dash' && t < (e.pt ?? 0.42)) {
          dx = e.dx || 0; dy = e.dy || 0; pace = speed*3.4;
        }
        if (e.behavior === 'thief') {
          const angle=Math.atan2(-dy,-dx)+Math.sin(((e.zig || 0)+t)*2.2)*0.7;
          dx=Math.cos(angle);dy=Math.sin(angle);pace*=d<300 ? 1 : 0.35;
        }
        const norm = Math.hypot(dx,dy) || 1;
        let nx = x + dx/norm*pace*dt, ny = y + dy/norm*pace*dt;
        if (!e.flying && !straightFree({x,y,r:e.r || 12},{x:nx,y:ny})) {
          // Obstacles constrain ground pursuers; allow sliding along an edge.
          if (straightFree({x,y,r:e.r || 12},{x:nx,y})) ny = y;
          else if (straightFree({x,y,r:e.r || 12},{x,y:ny})) nx = x;
          else { nx = x; ny = y; }
        }
        const rx = x-a.x, ry = y-a.y, vx = nx-x-(b.x-a.x), vy = ny-y-(b.y-a.y);
        const vv = vx*vx+vy*vy, u = vv > 1e-8 ? clamp(-(rx*vx+ry*vy)/vv,0,1) : 0;
        const gap = Math.hypot(rx+vx*u,ry+vy*u)-radius;
        if (gap < 0) contact = true;
        // Integrate pressure so lengthening the horizon does not multiply it.
        score -= (210*weight*Math.exp(-Math.max(0,gap)/(55+caution*12))
          + (gap < 5+caution*10 ? 720 : 0)) * dt / plan.horizon;
        x = nx; y = ny; t += dt;
      }
    }
    return {score,contact};
  }
  function enteringRiftPlan(plan, goal) {
    if (goal?.kind !== 'rift') return plan;
    let arrival=Infinity;
    for (const seg of plan.segments) {
      const dx=seg.x-goal.x,dy=seg.y-goal.y,vv=seg.vx**2+seg.vy**2;
      const c=dx*dx+dy*dy-goal.radius**2,b=dx*seg.vx+dy*seg.vy;
      if(c<=0) {arrival=seg.start;break;}
      const disc=b*b-vv*c;
      if(vv>0 && b<0 && disc>=0) {
        const t=(-b-Math.sqrt(disc))/vv;
        if(t<=seg.end-seg.start) {arrival=seg.start+t;break;}
      }
    }
    if(!Number.isFinite(arrival)) return plan;
    const horizon=Math.max(0.001,arrival);
    return {...plan,horizon,segments:plan.segments.filter(s=>s.start<horizon).map(s=>({...s,end:Math.min(s.end,horizon)})),
      at:t=>plan.at(Math.min(t,horizon))};
  }
  function steer(p, now) {
    // Replan at most 16 times/s; use analytic sweeps instead of tiny time steps.
    projectileCoverCache.clear();
    coverLifetimeCache.clear();
    const liveEnemies = game.EnemyMgr.all().filter(e => !e.dead && distance(e,p) < 1200);
    const enemies = liveEnemies.filter(e => (distance(e, p) < 560 || e.phase === 'dash')).sort((a, b) => distance(a, p) - distance(b, p));
    const map = buildTerrain(p, now);
    const hostileShots = game.Projectiles.all().filter(s => !s.friendly);
    const hazards = (game.Hazards?.all || []).filter(h => !h.hit);
    const unsafeChests = [];
    let objective = chooseObjective(p, now, map, liveEnemies, hostileShots, hazards, unsafeChests);
    selectSlot(p, enemies.length ? enemies : objective?.kind === 'chest' ? [objective] : [], now);
    const group = p.slots[p.active] || [];
    const primary = group.filter(damaging).reduce((best, m) => !best || moveValue(m, group) > moveValue(best, group) ? m : best, null);
    const profile = primary ? moveProfile(primary) : null;
    const thief = !objective?.urgent && p.hp>=p.maxHp*0.35 && profile && liveEnemies
      .filter(e=>e.behavior === 'thief' && (e.life == null || e.life>0) && distance(p,e)<650)
      .sort((a,b)=>(distance(p,a)/(a.dex===1000 ? 1.3 : 1))-(distance(p,b)/(b.dex===1000 ? 1.3 : 1)))[0];
    if(thief) objective={kind:'hunt',x:thief.x,y:thief.y,radius:Math.max(p.r+(thief.r || 12)+26,Math.min(125,profile.ideal)),
      enemy:thief,label:thief.dex===1000 ? '追擊賽富豪' : '追擊喵喵'};
    for (const m of group) {
      if (m.kind === 'turret' && m.castAt != null && seenCasts.get(m) !== m.castAt) {
        seenCasts.set(m, m.castAt);
        const angle = p.aim || 0;
        turrets.push({ x: p.x - Math.cos(angle) * 26, y: p.y - Math.sin(angle) * 20,
          until: m.castAt + (m.dur || 6) * 1000, range: m.range || 280, move: m });
        const own = turrets.filter(t => t.move === m);
        if (own.length > (m.count || 1)) turrets = turrets.filter(t => t !== own[0]);
      }
    }
    turrets = turrets.filter(t => t.until > now);
    tactic = profile ? ({ close: '近距離收放', orbit: '環繞切邊', ranged: '保持射程', lure: '鋪場誘敵', turret: '砲台牽制', dash: '突進收放' })[profile.mode] : '撿物';
    const speed = p.frozen ? 0 : Math.max(0,p.spd ?? p.baseSpd ?? 100);
    const horizon = Math.min(survivalHorizon(p,speed),hostileShots.length || enemies.length || hazards.length ? Infinity : 1.2);
    // A fast incoming shot can be dangerous well outside the old 330px window.
    // Do not truncate by insertion order: a later shot may be the nearest hit.
    const shots = hostileShots.filter(s => (s.life == null || s.life > (s.t || 0))
      && distance(s,p) <= (Math.hypot(s.vx || 0,s.vy || 0)+Math.max(speed*1.15,Math.hypot(p.svx || 0,p.svy || 0)))*horizon+p.r+(s.r ?? 6)+32);
    const currentDanger = projectileDanger(p,movementPlan(p,vector,speed,horizon),shots);
    const dodge = currentDanger.hits > 0 || projectileDanger(p,movementPlan(p,[0,0],speed,horizon),shots).hits > 0;
    if (!dodge || (dodgeStop && distance(p,dodgeStop)>speed*1.8+20)) dodgeStop = null;
    const pickups = game.Pickups.all();
    let target = null, targetScore = 0;
    for (const item of pickups) {
      const d = distance(item, p);
      if (d > 650) continue;
      let weight = ({ xp: 1, xpBig: 2, coin: 0.7, ticket: 5, ticket10: 9, magnet: 4, item: 2, bomb: 2 })[item.kind] || 0;
      if (item.kind === 'heal') weight = p.hp < p.maxHp * 0.8 ? 12 : 0;
      const score = weight / (d + 65);
      if (score > targetScore) { targetScore = score; target = item; }
    }
    if (target?.kind === 'heal' && p.hp < p.maxHp * 0.35) objective = null;
    if (objective) target = null;
    const waypoint = objective ? objectiveWaypoint(p, objective, map) : null;
    const docking = objective?.site && ['altar','bigchest','chest'].includes(objective.kind);
    let stride = objective?.kind === 'altar'
      ? clamp((distance(p,objective)-((objective.prop.r || 9)+p.r+objective.radius)/2)/Math.max(1,speed*horizon),0.06,1)
      : objective ? clamp((distance(p,objective) - objective.radius * 0.7) / (speed * 0.65), 0.12, 1) : 1;
    if (objective && waypoint && distance(p,waypoint)>1) stride=Math.min(stride,clamp(distance(p,waypoint)/Math.max(1,speed*horizon),0.08,1));
    let best = -Infinity, result = [0, 0], exits = 8, bestUnsafe = Infinity, nextStop = null;
    const dense = enemies.length > 48 || shots.length > 128;
    const directions = !dense && (dodge || bodyCaution(p) >= 0.5) ? 32 : 16;
    // Long forecasts also try moving into a gap and braking there. Extending
    // a straight run forever can reject a safe pocket between crossing waves.
    const brakeDirections = dodge && horizon > 1 ? (dense ? 8 : 24) : 0;
    const routeDirections = objective && waypoint && distance(p,waypoint)>1 ? 1 : 0;
    const candidates = directions + brakeDirections + routeDirections;
    for (let i = 0; i <= candidates; i++) {
      const still = i === candidates, route = routeDirections && i===candidates-1;
      const brake = i >= directions && !still && !route;
      const angle = route ? Math.atan2(waypoint.y-p.y,waypoint.x-p.x) : brake ? ((i-directions)%8)*Math.PI*2/8 : i*Math.PI*2/directions;
      // Near a chest, dodge at full speed rather than retaining opening stride.
      const dockPace = route && docking ? clamp(distance(p,waypoint)/Math.max(1,speed*0.2),0,1) : stride;
      const pace = dodge ? 1 : dockPace;
      const dir = still ? [0, 0] : [Math.cos(angle) * pace, Math.sin(angle) * pace];
      const brakeAt = brake ? dodgeStop
        ? clamp(((dodgeStop.x-p.x)*dir[0]+(dodgeStop.y-p.y)*dir[1])/Math.max(1,speed),0.01,0.9)
        : [0.25,0.5,0.9][Math.floor((i-directions)/8)] : Infinity;
      // Forecast braking at the precise waypoint instead of extrapolating
      // through the solid prop; tiny corrections have no minimum stride.
      const dockStop = route && docking && !dodge ? distance(p,waypoint)/Math.max(0.001,speed*pace) : Infinity;
      const plan = enteringRiftPlan(movementPlan(p,dir,speed,horizon,Math.min(brakeAt,dockStop)),objective);
      if (plan.segments.some(seg=>!straightFree({x:seg.x,y:seg.y,r:p.r},
        {x:seg.x+seg.vx*(seg.end-seg.start),y:seg.y+seg.vy*(seg.end-seg.start)}))) continue;
      const danger = projectileDanger(p,plan,shots);
      const pursuit = pursuitDanger(p,plan,enemies,profile);
      let score = danger.score + pursuit.score + plan.terrainScore, contact = pursuit.contact;
      for (const t of [0.15, 0.35, 0.65]) {
        const q = plan.at(t);
        if (!still && !game.World.isFree(q.x, q.y, p.r, false)) { score -= 2000; break; }
        for (const h of hazards) if (game.Hazards.inside(h, q.x, q.y, p.r + 8)) score -= 500;
      }
      for (const h of hazards) {
        const detonation = Math.max(0,(h.delay ?? 0)-(h.t || 0));
        if (detonation <= plan.horizon) {
          const at = plan.at(detonation);
          if (game.Hazards.inside(h,at.x,at.y,p.r+5)) contact = true;
        }
      }
      const q = plan.at(0.65);
      let ground = terrainPosition(p, q, dir, enemies, profile, map);
      if ((objective?.kind === 'altar' || docking) && distance(q,objective)<objective.radius+map.step
        && game.World.isFree(q.x,q.y,p.r,false)) {
        // Large players can reach the activation ring inside a coarse cell
        // marked solid by the altar's center. Verify real escape segments.
        const localExits = altarExits(p,q,map);
        if (localExits >= 2) ground = {score:Math.min(5,localExits)*9,safeExits:localExits};
      }
      score += ground.score * (1 + (enemies.length ? bodyCaution(p)*0.5 : 0));
      for (const chest of unsafeChests) {
        const radius = Math.max(46,(chest.r || 14)+p.r+24);
        if (distance(p,chest) < radius) {
          // Cancel native proximity opening by leaving, while collision and
          // immediate combat danger retain their stronger penalties.
          if (distance(q,chest) < radius) score -= 180;
          score += clamp(distance(q,chest)-distance(p,chest),-40,40)*1.2;
        }
      }
      score += attackPosition(p, q, enemies, profile) * (objective?.urgent ? 0 : objective?.kind==='hunt' ? 0.65 : objective ? 0.35 : 1);
      if(thief && targetFor({x:q.x,y:q.y,r:p.r},group,enemies)===thief) score+=110;
      if (objective) score += objectiveScore(p,q,dir,objective,waypoint);
      for (const turret of turrets) {
        // Stay within support range of a recently observed deployment.
        if (enemies.some(e => distance(e, turret) < turret.range)) {
          score += 12 * Math.exp(-distance(q, turret) / (turret.range * 0.7));
        }
      }
      if (target) score += (distance(p, target) - distance(q, target)) * (target.kind === 'heal' ? 0.9 : enemies.length ? 0.3 : 0.65);
      else if (!objective) {
        const wander = now / 9000;
        score += 9 * (dir[0] * Math.cos(wander) + dir[1] * Math.sin(wander));
      }
      if (profile?.mode === 'lure' && still && enemies.length) score -= 30;
      // Penalize recently visited ground so a blocked target does not trap us forever.
      for (const old of trail) score -= 6 * Math.exp(-distance(q, old) / 30);
      score += (primary?.kind === 'boomerang' ? 10 : 4) * (dir[0] * vector[0] + dir[1] * vector[1]);
      // Do not trade an imminent hit for fewer speculative later hits. Later
      // waves may need another turn after we reach the first safe gap.
      const unsafe = contact || danger.imminentHits > 0 ? 3 : danger.actualHits > 0 ? 2 : danger.hits > 0 ? 1 : 0;
      // A predicted clear route wins over damage, loot or opening a chest.
      if (unsafe < bestUnsafe || (bestUnsafe === unsafe && score > best)) {
        best = score; bestUnsafe = unsafe; result = dir; exits = ground.safeExits;
        nextStop = brake ? plan.at(brakeAt) : still ? dodgeStop : null;
      }
    }
    vector = result; dodgeStop = nextStop;
    if (dodge) tactic = '預判閃避彈幕' + (bestUnsafe ? ' · 尋找最小風險' : '');
    else if (objective) tactic = objective.label;
    else if (game.Rift?.inArena) tactic = '裂縫戰鬥 · ' + tactic;
    escapeState = enemies.some(e => distance(e, p) < 230) ? (exits < 2 ? '尋找突破口' : '保留退路') : '避開窄路';
    if (!trail.length || now - trail[trail.length - 1].t > 700) {
      trail.push({ x: p.x, y: p.y, t: now });
      if (trail.length > 12) trail.shift();
    }
  }

  function tick() {
    if (stopped) return;
    const now = performance.now();
    try {
      if (!root.isConnected && document.body) { document.body.appendChild(root); placePanel(); }
      const g = findInterface();
      if (captureSetter && now - startedAt > 30000 && !(controlledLaunch && launchState === 'loading-game')) releaseCapture();
      if (!game && g) { capturedGame = g; releaseCapture(); install(g); }
      if (game) {
        const p = game.Game.player;
        if (p !== previousPlayer) { previousPlayer = p; lastSwitch = -Infinity; switchCommitUntil = 0; tactic = ''; terrain = null; dodgeStop = null; objectiveScan = null; trail = []; turrets = []; seenCasts.clear(); vector = [0, 0]; overSince = 0; }
        if (!settings.enabled || blocked()) { vector = [0, 0]; dodgeStop = null; }
        else {
          if (p) {lockCompletedCore(p);updateDamagePlan(p);choose(p, now);}
          if (p && !p.dead && game.Game.state === 'playing' && now - lastThink >= 60) {
            lastThink = now; steer(p, now);
          }
          if (game.Game.state !== 'playing') vector = [0, 0];
          if (!multiplayer() && settings.restart && game.Game.state === 'over' && visible('scr-over')) {
            if (!overSince) overSince = now;
            if (now - overSince > 5000 && game.DB?.save?.partner) {
              // Go through the normal summary/menu flow before beginning the next run.
              document.getElementById('btn-again')?.click();
              if (game.Game.state === 'ui' && visible('scr-menu')) {
                document.querySelector('#scr-menu [data-go="play"]')?.click();
              }
              overSince = 0;
            }
          } else overSince = 0;
        }
      }
    } catch (e) {
      error = e.message; vector = [0, 0]; settings.enabled = false; persist(); controls();
      console.error('[PokéSurvivor Bot]', e);
    }
    if (now - lastStatus > 500) {
      lastStatus = now;
      $('status').textContent = error ? `已停止：${error}` : !game ? initializationStatus(now)
        : now < reloadUntil ? 'Bot 已重新載入 · 本局繼續'
        : !settings.enabled ? '手動模式 · 點「自動：開」啟動'
        : document.hidden ? (backgroundAllowed() ? '背景續跑中（受瀏覽器限制）' : '背景暫停') : visible('rotate') ? '請將 iPhone 轉成橫向'
        : held.size || now < manualUntil ? '手動接管中…' : game.Game.state === 'paused' ? '遊戲已暫停；請手動繼續'
        : multiplayer() && (game.Game.state === 'levelup' || visible('scr-levelup') || visible('scr-bond') || visible('scr-item')) ? '多人：請手動選牌／融合／道具'
        : settings.manualPoints && (game.Game.state === 'levelup' || visible('scr-levelup') || visible('scr-bond') || visible('scr-item')) ? '單人：請手動選牌／重抽／融合／道具'
        : multiplayer() && game.Game.state === 'over' ? '多人本局結束；請手動重開'
        : game.Game.state === 'over' ? (settings.restart ? '結算後 5 秒重開' : '本局結束')
        : multiplayer() ? (game.Game.state === 'playing' ? `多人自動：${tactic || '走位'} · 升級手動` : '多人房間：等待手動開局')
        : game.Game.state === 'playing' ? `自動：${tactic || '走位'} / 撿物` : '等待開始 / 自動選牌';
      try {
        renderPanel();
        if (!panelDrag) placePanel();
      } catch (e) {
        error = `面板更新失敗：${e.message}`; vector = [0,0]; settings.enabled = false; persist();
        $('status').textContent = `已停止：${error}`;
        console.error('[PokéSurvivor Bot]', e);
      }
    }
  }
  function renderPanel() {
    renderRestart();
    renderManualPoints();
    renderReload();
    if ($('stable')) $('stable').hidden = !!game || controlledLaunch;
    const p = game?.Game.player;
    $('hp').textContent = p ? `${Math.ceil(p.hp)} / ${Math.ceil(p.maxHp)}` : '— / —';
    $('hp-fill').style.width = `${p ? clamp(p.hp / p.maxHp * 100, 0, 100) : 0}%`;
    $('tactic').textContent = [tactic || '準備就緒',p && completedCore(p) ? (p.slots.length<(p.maxMoves || 4)?'主技完成 · 補滿招式槽':'滿槽 · 能力成長') : '',poisonBuild(p) ? '毒傷生存 · 減傷＞回血 · 控制血量' : damagePlan.known ? `${damagePlan.phase ? '階段 '+damagePlan.phase+' · ' : ''}${damagePlan.insufficient ? '補強輸出優先' : '輸出足夠 · 強化優先'}` : ''].filter(Boolean).join(' / ');
    for (let i = 0; i < 4; i++) {
      const slot = p?.slots?.[i] || [];
      $('slot-' + i).setAttribute('data-active', String(!!slot.length && i === p.active));
      $('move-' + i).textContent = slot.map(m => game?.I18n?.t?.(m.name || m.id || '招式','move') ?? (m.name || m.id || '招式')).join(' + ') || '空槽';
      $('move-' + i).title = $('move-' + i).textContent;
      const delay = slot.length ? Math.min(...slot.map(m => m.kind === 'orbit' ? 0 : Math.max(0, m.t || 0))) : 0;
      const cd = Math.max(0.05, ...slot.map(m => (m.cd || 1) * (p.cdMul || 1)));
      $('cd-' + i).textContent = !slot.length ? '—' : delay <= 0.05 ? '可施放' : `${delay.toFixed(1)}s${i !== p.active ? ' · 待機' : ''}`;
      $('bar-' + i).style.width = `${slot.length ? clamp((1 - delay / cd) * 100, 0, 100) : 0}%`;
    }
    $('rotation').textContent = [rotation || '等待目標', escapeState].filter(Boolean).join(' · ');
  }
  function detachHooks() {
    if(bondPlayer && hookedBondOptions && bondPlayer.bondOptions===hookedBondOptions) bondPlayer.bondOptions=originalBondOptions;
    bondPlayer=null;originalBondOptions=null;hookedBondOptions=null;
    if (!game) return;
    if (game?.Input.axis === hookedAxis) game.Input.axis = originalAxis;
    if (game?.LevelUp.offer === hookedOffer) game.LevelUp.offer = originalOffer;
    if (hookedBond && game?.RunUI.showBond === hookedBond) game.RunUI.showBond = originalBond;
    if (hookedItem && game?.RunUI.showItemChoice === hookedItem) game.RunUI.showItemChoice = originalItem;
  }
  function reloadBot() {
    if (stopped) return false;
    const cached = game || findInterface();
    detachHooks(); game = null;
    projectileCoverCache.clear();coverLifetimeCache.clear();chestSiteCache=new WeakMap();
    vector = [0, 0]; terrain = null; dodgeStop = null; objectiveScan = null; escapeState = ''; trail = []; turrets = []; seenCasts.clear(); held.clear();
    error = ''; manualUntil = 0; overSince = 0; lastThink = 0; lastStatus = 0;
    lastSwitch = -Infinity; switchCommitUntil = 0; tactic = ''; rotation = '';
    // Keep current card offers/fusion step so reloading cannot select twice or lose a dialog.
    if (cached && !missingInterface(cached).length) {
      releaseCapture(); install(cached); reloadUntil = performance.now() + 2500;
    } else armCapture();
    controls(); tick();
    return !!game;
  }
  backgroundRunner = installBackgroundRunner();
  controls();
  const timer = setInterval(tick, 60);
  tick();
  const api = {
    version: VERSION,
    get enabled() { return settings.enabled; },
    get diagnostics() {
      const candidate = game || capturedGame || window.G || captureCandidates[0];
      return {version:VERSION, connected:!!game, elapsedSeconds:Math.floor((performance.now()-startedAt)/1000),controlledLaunch,launchState,
        manualPoints:settings.manualPoints, background:settings.background, backgroundFrames:backgroundRunner?.frames || 0, injectionState, damage:{...damagePlan,fastClear:fastClear(),buildStep:game?.Game.player ? buildStep(game.Game.player) : null}, documentState:document.readyState || 'unknown', missing:missingInterface(candidate), captureIssue, error};
    },
    reload: reloadBot,
    handoff() {
      const state = { game: game || capturedGame, offers, offered, bondChoice, itemChoice, rerollState, settings: { ...settings } };
      api.destroy();
      return state;
    },
    destroy() {
      if (panelDrag) finishPanelDrag({pointerId:panelDrag.id});
      removeEventListener('resize',onPanelResize); removeEventListener('orientationchange',onPanelResize);
      window.visualViewport?.removeEventListener('resize',onPanelResize);
      window.visualViewport?.removeEventListener('scroll',onPanelResize);
      stopped = true; clearInterval(timer); releaseCapture(); capturedGame = null; captureCandidates.length = 0; vector = [0, 0]; root.remove();
      detachHooks(); backgroundRunner?.destroy();
      removeEventListener('keydown', onDown); removeEventListener('keyup', onUp); removeEventListener('blur', onBlur);
      if (window.PokeSurvivorBot === api) delete window.PokeSurvivorBot;
    }
  };
  window.PokeSurvivorBot = api;
  if (pageScripts) {
    launchState = 'loading-game'; window.__pokeSurvivorLaunch.state = launchState;
    try {
      await releasePageScripts(pageScripts);
      tick();
      if (!game) throw Error('遊戲程式已載入，但介面不相容；請回報此訊息');
      launchState = 'connected'; window.__pokeSurvivorLaunch.state = launchState;
    } catch (e) {
      launchState = 'failed'; window.__pokeSurvivorLaunch.state = launchState;
      error = `穩定啟動失敗：${e.message}`; vector = [0,0]; settings.enabled = false; persist(); releaseCapture(); controls();
      $('status').textContent = error;
    }
  }
})();
