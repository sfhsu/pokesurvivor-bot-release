// ==UserScript==
// @name         PokéSurvivor iPhone 自動遊玩
// @namespace    pokesurvivor-bot
// @version      1.4.21
// @description  依體型預判躲彈與敵人追擊、散射彈幕走位、地形風箏、冷卻選招、自動使用祭壇、開箱與進裂縫打王；觸控優先，可重新載入 Bot，中文翻譯與單人背景續跑可切換（受瀏覽器限制），附穩定啟動與 GF 更新入口。
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
  const VERSION = '1.4.21';
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
  let settings = { enabled: false, restart: false, manualPoints: false, chinese: true, background: true, collapsed: false, position: null };
  const restoreSettings = saved => {
    if (!saved || typeof saved !== 'object') return;
    for (const name of Object.keys(settings)) {
      if (Object.prototype.hasOwnProperty.call(saved,name)) settings[name] = saved[name];
    }
  };
  try { restoreSettings(JSON.parse(localStorage.getItem(key) || '{}')); } catch (_) {}
  restoreSettings(carry?.settings);
  let localization = null;
  let backgroundRunner = null;
  let game, originalAxis, originalOffer, hookedAxis, hookedOffer;
  let dodgeStop = null;
  let vector = [0, 0], offers = carry?.offers || [], offered = carry?.offered || null, lastChoice = 0;
  let rerollState = carry?.rerollState || {player:null,level:null,attempts:0,offers:null};
  let damagePlan = {known:false,insufficient:false}, damageHistory = [], damagePlayer = null;
  let manualUntil = 0, overSince = 0, lastThink = 0, lastStatus = 0;
  let bondPlayer = null, originalBondOptions, hookedBondOptions;
  let originalBond, hookedBond, bondChoice = carry?.bondChoice || null;
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
    </div><p id="rotation" class="rotation-note">等待目標</p><div class="actions"><button id="restart" aria-pressed="false">自動重開：關</button><button id="manual-points" aria-pressed="false" title="單人手動選牌、重抽、融合與道具；自動走位和戰鬥繼續">手動加點：關</button><button id="reload">↻ 重新載入 Bot</button><button id="chinese" aria-pressed="true" title="切換遊戲介面的繁體中文翻譯">中文翻譯：開</button><button id="background" aria-pressed="true" title="單人背景續跑；iPhone 切換 App、鎖屏或系統掛起後仍可能停止">背景續跑：開</button></div><p class="update-note">背景續跑受瀏覽器限制；多人背景維持原暫停機制</p><a id="stable" class="update-link" href="/guia/?poke-bot-launch=1" title="重新開啟穩定入口，先準備 Bot 再載入遊戲；目前本局會結束">穩定啟動 · 重開網頁</a><a id="update" class="update-link" href="${UPDATE_URL}" target="_blank" rel="noopener noreferrer" title="開啟 Greasy Fork 最新腳本，由 Userscripts 確認更新；更新後請重整遊戲以載入新版" aria-describedby="update-note">↑ 更新版本 · Greasy Fork ↗</a><p id="update-note" class="update-note">新分頁確認更新；套用新版需重整遊戲</p><p class="hint">觸控移動優先 · 重新載入保留本局</p></div>
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
    $('chinese').textContent = `中文翻譯：${settings.chinese ? '開' : '關'}`;
    $('chinese').setAttribute('aria-pressed', String(settings.chinese));
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
  $('chinese').onclick = () => {
    settings.chinese = !settings.chinese;
    if (settings.chinese) { localization = installChinese(); localization?.refresh(game); }
    else { localization?.destroy(); localization = null; }
    persist(); controls(); renderPanel();
  };
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
    localization?.refresh(g);
    originalOffer = g.LevelUp.offer;
    hookedOffer = function (...args) {
      const list = originalOffer.apply(this, args);
      offers = list; offered = null;
      return list;
    };
    g.LevelUp.offer = hookedOffer;
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
  const poisonBuild = p => !!p && learned(p).some(m => damaging(m) && m.poison > 0);
  const buffRank = m => m?.kind === 'buff' ? (poisonBuild(game.Game.player)
    ? {def:4,regen:3,spd:2,atk:1} : {atk:4,spd:3,def:2,regen:1})[m.stat] || 0 : 0;
  const control = m => !!(m.slow || m.burn || m.poison);
  // Trails tick repeatedly; mines persist until triggered, then burst once.
  // Status effects, falling meteors and shooting turrets are not ground residue.
  const groundRank = m => m?.kind === 'trail' ? 2 : m?.kind === 'mine' ? 1 : 0;
  function kitePairRank(slot) {
    const attacks = slot.filter(damaging);
    if (attacks.length !== 2 || !attacks.some(m => m.kind === 'projectile')) return 0;
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
      case 'boomerang': reach = radius; ideal = reach * 0.72; break;
      case 'chain': reach = 280; ideal = 200; break;
      case 'meteor': reach = 340; ideal = 240; break;
      case 'projectile': reach = Math.min(520, (m.speed || 300) * (m.life || 1.5)); ideal = Math.min(240, reach * 0.65); break;
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
      trail: 38, mine: 34, turret: 53 })[m.kind] || 35;
    let value = base + clamp((m.dmg || 10) / Math.max(0.2, m.cd || 1) / 5, 0, 18);
    value += Math.min(9, (m.count || 1) * 1.5) + Math.min(8, (m.pierce || 0) * 3);
    value += m.slow ? 7 : 0;
    value += m.homing ? 5 : 0;
    value += m.evolved ? 24 : 0;
    if (m.hex && companions.some(control)) value += 18;
    if (control(m) && companions.some(other => other.hex)) value += 12;
    // Prefer other attacks when learning or fusing; Substitute remains usable.
    if (m.id === 'substitute') value -= 25;
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
    const count=Math.min(3,1+Math.max(0,(m.count || 1)-1)*0.5);
    const period=m.kind === 'trail' ? 0.5 : m.kind === 'turret' ? (m.rate || 0.6)
      : m.kind === 'orbit' ? 0.5 : Math.max(0.05,m.cd || 1);
    return Math.max(0,m.dmg || 0)*count/period*(m.kind === 'dash' || m.kind === 'melee' ? 0.7 : 1);
  }
  function slotDamageRate(p,slot,castBuff=false) {
    let value=slot.reduce((sum,m)=>sum+moveDamageRate(m)
      /(['trail','turret','orbit'].includes(m.kind) ? 1 : Math.max(0.05,p.cdMul || 1)),0)*Math.max(0.01,p.atk || 1);
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
    const attackBuff=moves.some(m=>m.kind==='buff' && m.stat==='atk');
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
    const stats = new Set(slot.filter(m => m.kind === 'buff').map(m => m.stat));
    // Normal: damage anchor, defense, second attack, attack buff.
    // Fast clears combine attacks first; reserve two places for attacks.
    const excessBuffs = Math.max(0,slot.filter(m => m.kind === 'buff').length - 2);
    if(poisonBuild(game.Game.player)) return (slot.some(m=>damaging(m) && m.poison>0)?10000000:0)
      + stats.has('def')*1000000 + stats.has('regen')*100000
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
        if(m.stat==='atk') return poisonBuild(p)?40:step==='swords'?215:step==='fuse'?45:185;
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
      const missingGround = groundRank(m) && moves.some(move => move.kind === 'projectile') && !moves.some(groundRank);
      const missingProjectile = m.kind === 'projectile' && moves.some(groundRank) && !moves.some(move => move.kind === 'projectile');
      if (main.filter(damaging).length < 2 && (missingGround || missingProjectile)) {
        return 124.2 + groundRank(m) * 0.25 + clamp(moveValue(m, main),0,150) / 1000;
      }
      const strongest = main.filter(damaging).reduce((best, move) => Math.max(best, moveValue(move, main)), 0);
      const improvement = moveValue(m, main) - strongest;
      let score = 53 + clamp(improvement, -22, 45);
      if (!main.some(damaging)) score = 150;
      // Escape a short-range starting build with a reliable ranged attack.
      if (main.filter(damaging).every(move => ['melee', 'dash', 'mine', 'trail'].includes(move.kind)) &&
          ['projectile', 'beam', 'chain', 'meteor', 'turret'].includes(m.kind)) score += 38;
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
      case 'melee': case 'aura':
        hits = Math.min(8, nearby.length); break;
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
      case 'projectile': case 'boomerang': case 'cone': {
        eligible = d <= (m.kind === 'boomerang' ? profile.reach + 40 : m.kind === 'cone' ? m.speed * m.life + 30 : 520);
        hits = fanCoverage(p, m, slot, enemies).hits;
        // Only the outward pass is geometrically predicted; a return may hit again.
        if (m.kind === 'boomerang') hits *= 1.3;
        break;
      }
      case 'beam': {
        eligible = d <= profile.reach;
        const ux = (target.x - p.x) / Math.max(1, d), uy = (target.y - p.y) / Math.max(1, d);
        const aligned = enemies.filter(e => {
          const dx = e.x - p.x, dy = e.y - p.y, along = dx * ux + dy * uy;
          return along >= 0 && along <= profile.reach && Math.abs(dx * uy - dy * ux) < (m.width || m.size || 8) + (e.r || 12);
        }).length;
        hits = Math.min(8, aligned);
        // Beams stop at walls; avoid choosing one that cannot hit its target.
        if (m.kind === 'beam' && game.World.isWall) {
          for (let step = 16; step < d; step += 24) {
            if (game.World.isWall(p.x + ux * step, p.y + uy * step)) { eligible = false; break; }
          }
        }
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
    const status = (m.slow ? 1.12 : 1) * (m.burn || m.poison ? 1.08 : 1);
    return (m.dmg || 0) * hits * multiplier * status;
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
      && ['projectile','beam','chain','meteor','turret'].includes(m.kind) && score >= 90;
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
  function choose(p, now) {
    if (multiplayer() || settings.manualPoints) return; // Leave every choice and reroll to the player.
    if (now - lastChoice < 650) return;
    if (game.Game.state === 'levelup' && visible('scr-levelup')) {
      const cards = [...document.querySelectorAll('#cards .card')];
      if (!cards.length || document.getElementById('cards').classList.contains('done')) return;
      let index = 0;
      if (offers.length === cards.length) {
        if (offered === offers) return;
        if (rerollEarly(p,now)) return;
        for (let i = 1; i < offers.length; i++) if (cardScore(offers[i], p) > cardScore(offers[index], p)) index = i;
        offered = offers;
      }
      lastChoice = now; cards[index].click();
    } else if (visible('scr-item')) {
      const cards = [...document.querySelectorAll('#item-cards .card')];
      const card = cards[0];
      if (card) { lastChoice = now; card.click(); }
    } else if (visible('scr-bond')) {
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
      $('move-' + i).textContent = slot.map(m => m.name || m.id || '招式').join(' + ') || '空槽';
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
  function installChinese() {
    // DOM translation does not need access to the game's private interface.
    if (typeof MutationObserver !== 'function' || !document.documentElement || !document.createTreeWalker) return null;
    const sharedMarker = Symbol.for('pokesurvivor.zhHant.displayPatch');
    const externalPatch = !!window[sharedMarker];
    const owner = {botVersion:VERSION};
    if (!externalPatch) window[sharedMarker] = owner;
    let active = true, boundGame = null, judgmentHook = null, originalJudgment = null;
    const restorers = [];
    // Dictionary: PokéSurvivor 繁體中文補丁 1.3.3 (MIT).
    // https://greasyfork.org/zh-TW/scripts/599869/code
    // Original upstream MIT notice and PokeAPI name attribution retained below.
/* MIT License — upstream source strings: https://github.com/JPTER78/pokesurvivor
 * Copyright (c) 2026 JPTER78
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */

/* Name data: PokeAPI, Traditional Chinese (language 4).
 * UI descriptions are independently translated for this fan game.
 * This script does not fetch code, read credentials, change game data,
 * write storage, or modify network requests. Disable it and reload to undo.
 */

    const DICT = {
  "Acero": "鋼",
  "Agua": "水",
  "Bicho": "蟲",
  "Dragón": "龍",
  "Eléctrico": "電",
  "Fantasma": "幽靈",
  "Fuego": "火",
  "Hada": "妖精",
  "Hielo": "冰",
  "Lucha": "格鬥",
  "Planta": "草",
  "Psíquico": "超能力",
  "Roca": "岩石",
  "Siniestro": "惡",
  "Tierra": "地面",
  "Veneno": "毒",
  "Volador": "飛行",
  "Ascuas": "火花",
  "Lanzallamas": "噴射火焰",
  "Giro Fuego": "火焰旋渦",
  "Onda Ígnea": "熱風",
  "Llamarada": "大字爆炎",
  "Sofoco": "過熱",
  "Fuego Sagrado": "神聖之火",
  "Erupción": "噴火",
  "Pistola Agua": "水槍",
  "Burbuja": "泡沫",
  "Hidrobomba": "水炮",
  "Escaldar": "熱水",
  "Hidrocañón": "加農水炮",
  "Acua Aro": "水流環",
  "Látigo Cepa": "藤鞭",
  "Hoja Afilada": "飛葉快刀",
  "Tormenta Floral": "落英繽紛",
  "Gigadrenado": "終極吸取",
  "Hierba Lazo": "打草結",
  "Latigazo": "強力鞭打",
  "Lluevehojas": "飛葉風暴",
  "Danza Pétalo": "花瓣舞",
  "Planta Feroz": "瘋狂植物",
  "Impactrueno": "電擊",
  "Chispazo": "放電",
  "Rayo": "十萬伏特",
  "Trueno": "打雷",
  "Campo Eléctrico": "電氣場地",
  "Electrocañón": "電磁炮",
  "Confusión": "念力",
  "Psicorrayo": "幻象光線",
  "Psicocarga": "精神衝擊",
  "Premonición": "預知未來",
  "Vasta Fuerza": "廣域戰力",
  "Residuos": "污泥攻擊",
  "Picotazo Veneno": "毒針",
  "Tóxico": "劇毒",
  "Bomba Lodo": "污泥炸彈",
  "Puya Nociva": "毒擊",
  "Gas Venenoso": "毒瓦斯",
  "Disparo Lodo": "泥巴射擊",
  "Terratemblor": "重踏",
  "Tierra Viva": "大地之力",
  "Terremoto": "地震",
  "Tornado": "起風",
  "Ataque Ala": "翅膀攻擊",
  "Vendaval": "暴風",
  "Pájaro Osado": "勇鳥猛攻",
  "Picadura": "蟲咬",
  "Disparo Demora": "吐絲",
  "Zumbido": "蟲鳴",
  "Tijera X": "十字剪",
  "Red Viscosa": "黏黏網",
  "Lanzarrocas": "落石",
  "Avalancha": "岩崩",
  "Roca Afilada": "尖石攻擊",
  "Trampa Rocas": "隱形岩",
  "Rayo Hielo": "冰凍光束",
  "Nieve Polvo": "細雪",
  "Ventisca": "暴風雪",
  "Viento Hielo": "冰凍之風",
  "Golpe Kárate": "空手劈",
  "Esfera Aural": "波導彈",
  "A Bocajarro": "近身戰",
  "Onda Certera": "真氣彈",
  "Lengüetazo": "舌舔",
  "Bola Sombra": "暗影球",
  "Tinieblas": "黑夜魔影",
  "Puño Sombra": "暗影拳",
  "Golpe Fantasma": "潛靈奇襲",
  "Pesadilla": "惡夢",
  "Furia Dragón": "龍之怒",
  "Cometa Draco": "流星群",
  "Danza Dragón": "龍之舞",
  "Viento Feérico": "妖精之風",
  "Brillo Mágico": "魔法閃耀",
  "Fuerza Lunar": "月亮之力",
  "Campo de Niebla": "薄霧場地",
  "Garra Metal": "金屬爪",
  "Foco Resplandor": "加農光炮",
  "Cabeza de Hierro": "鐵頭",
  "Rayo Metálico": "鐵蹄光線",
  "Mordisco": "咬住",
  "Pulso Umbrío": "惡之波動",
  "Triturar": "咬碎",
  "Alarido": "大聲咆哮",
  "Placaje": "撞擊",
  "Ataque Rápido": "電光一閃",
  "Golpe Cuerpo": "泰山壓頂",
  "Vozarrón": "巨聲",
  "Derribo": "猛撞",
  "Velocidad Extrema": "神速",
  "Gigaimpacto": "終極衝擊",
  "Alboroto": "吵鬧",
  "Danza Espada": "劍舞",
  "Agilidad": "高速移動",
  "Fortaleza": "變硬",
  "Surf": "衝浪",
  "Síntesis": "光合作用",
  "Imán": "磁鐵",
  "Mejora": "強化",
  "Baya Zidra": "文柚果",
  "Restos": "吃剩的東西",
  "Cinta Elección": "講究頭帶",
  "Garra Rápida": "先制之爪",
  "Banda Focus": "氣勢披帶",
  "Cascabel Concha": "貝殼之鈴",
  "Moneda Amuleto": "護符金幣",
  "Huevo Suerte": "幸運蛋",
  "Vidasfera": "生命寶珠",
  "Pañuelo Elección": "講究圍巾",
  "Casco Dentado": "凸凸頭盔",
  "Chaleco Asalto": "突擊背心",
  "Fuerza": "力量",
  "Furia": "狂怒",
  "Tormenta de arena": "沙暴",
  "Niebla": "霧",
  "Diario": "冒險筆記",
  "Normal": "一般",
  "Código Cero": "屬性：空",
  "Huesomerang": "骨頭回力鏢",
  "Psicocorte": "精神利刃",
  "Púas": "撒菱",
  "Púas Tóxicas": "毒菱",
  "Granizo": "冰雹",
  "Puño Meteoro": "彗星拳",
  "Fuego Fatuo": "鬼火",
  "Sustituto": "替身",
  "Golpe Aéreo": "燕返",
  "Rueda Fuego": "火焰輪",
  "Rayo Burbuja": "泡沫光線",
  "Infortunio": "禍不單行",
  "Ataque Óseo": "骨棒亂打",
  "Psicocolmillo": "精神之牙",
  "Fisura": "地裂",
  "Lanza Mugre": "垃圾射擊",
  "Alud": "雪崩",
  "Bomba Imán": "磁鐵炸彈",
  "Infierno": "煉獄",
  "Doble Equipo": "影子分身",
  "Acróbata": "雜技",
  "Envite Ígneo": "閃焰衝鋒",
  "Acua Cola": "水流尾",
  "Poltergeist": "靈騷",
  "Teselia": "合眾",
  "Enjambre": "蟲之預感",
  "Abanico de tres hojas perforantes.": "扇形射出三片可貫穿敵人的葉片。",
  "Aguijón rápido que envenena.": "快速刺擊，使敵人中毒。",
  "Barrido de alas amplio que empuja.": "大範圍揮動翅膀，擊退敵人。",
  "Bola de fuego al enemigo más cercano.": "向最近的敵人發射火球。",
  "Brisa mágica en todas direcciones.": "向四面八方吹出魔法微風。",
  "Burbujas en abanico que ralentizan a quien tocan.": "扇形發射泡泡，使碰到的敵人減速。",
  "Campo eléctrico permanente alrededor de ti.": "在周圍持續產生電場。",
  "Cañonazo de agua lento pero devastador.": "緩慢但威力驚人的水炮。",
  "Chorro de fuego que atraviesa todo en línea recta.": "直線噴火，貫穿沿途所有敵人。",
  "Chorro perforante. Fiable a cualquier distancia.": "可貫穿敵人的水柱，遠近皆宜。",
  "Dentellada rápida que hace retroceder.": "快速咬擊，擊退敵人。",
  "Descarga rapidísima que atraviesa varios enemigos.": "極快的電流，可貫穿多個敵人。",
  "Destello a tu alrededor.": "在周圍釋放閃光。",
  "Drena vida de todo lo cercano y te cura con cada golpe.": "吸取附近敵人的生命，每次命中都能回復體力。",
  "Raíces que atrapan y machacan todo lo que tienes cerca.": "用根部困住並重擊附近的敵人。",
  "Embiste en arco a todo lo que tengas delante.": "向前方弧形範圍衝撞。",
  "Esfera de energía que nunca falla.": "必定命中的能量球。",
  "Esfera oscura que atraviesa a varios.": "可貫穿多個敵人的暗影球。",
  "Estallido mental radial que busca enemigos.": "向周圍釋放追蹤敵人的精神衝擊。",
  "Explota en llamas en todas las direcciones.": "向四面八方爆發火焰。",
  "Golpe seco y potente al frente.": "向正前方使出強力打擊。",
  "Hilos pegajosos en todas direcciones que frenan mucho.": "向四周射出黏絲，大幅降低敵人速度。",
  "Lametazo espectral que paraliza un poco.": "幽靈般的舌舔，使敵人短暫麻痺。",
  "Látigos de largo alcance en arco amplio.": "遠距離、大範圍的弧形鞭擊。",
  "Llamarada dracónica en línea recta.": "直線噴出龍之火焰。",
  "Llamas que giran a tu alrededor. Defensa constante.": "火焰繞著自身旋轉，持續防禦。",
  "Lluvia de rocas alrededor tuyo.": "在周圍降下岩石雨。",
  "Lodo tóxico que envenena al impactar.": "命中時使敵人中毒的毒污泥。",
  "Mordisco rápido en arco corto.": "小範圍快速咬擊。",
  "No hace daño: acumula ATAQUE más rápido que Danza Espada.": "不造成傷害：累積攻擊力的速度比劍舞更快。",
  "No hace daño: acumula ATAQUE mientras esté activo.": "不造成傷害：啟用時持續累積攻擊力。",
  "No hace daño: acumula DEFENSA mientras esté activo.": "不造成傷害：啟用時持續累積防禦力。",
  "No hace daño: acumula REGENERACIÓN de vida.": "不造成傷害：持續累積體力回復效果。",
  "No hace daño: acumula VELOCIDAD mientras esté activo.": "不造成傷害：啟用時持續累積速度。",
  "Nube venenosa a tu alrededor que intoxica.": "在周圍產生使敵人中毒的毒霧。",
  "Onda de energía oscura en todas direcciones.": "向四面八方釋放惡之能量波。",
  "Onda que persigue sola a su objetivo.": "自動追蹤目標的波動。",
  "Onda sonora que sale en todas direcciones.": "向四面八方擴散的聲波。",
  "Pedrusco pesado que empuja al enemigo.": "沉重的巨石，能擊退敵人。",
  "Placaje con todo el peso: lento, corto y brutal.": "全力撞擊：緩慢、近距離，但威力強大。",
  "Ráfaga veloz y constante. Poco daño, mucha cadencia.": "快速連續射擊，傷害低但射速高。",
  "Rayo de luz metálica que perfora.": "可貫穿敵人的金屬光束。",
  "Rayo helado que congela casi del todo.": "幾乎能將敵人完全凍住的冰冷光束。",
  "Rayo psíquico ancho y contundente.": "寬廣且強力的精神光束。",
  "Remolinos de viento que te escoltan.": "旋風環繞身旁，為你護航。",
  "Sacude el suelo: daña y frena a lo cercano.": "震動地面，傷害附近敵人並使其減速。",
  "Salpica lodo alrededor y ralentiza.": "向周圍潑灑泥漿，使敵人減速。",
  "Un ciclón de hojas gira amplio a tu alrededor.": "葉片旋風在周圍大範圍旋轉。",
  "Un rayo instantáneo que perfora en línea.": "瞬間射出直線貫穿的電光。",
  "Una sombra te rodea y consume lo cercano.": "暗影環繞自身，吞噬附近敵人。",
  "Ventisca a tu alrededor que ralentiza.": "周圍刮起暴風雪，使敵人減速。",
  "Vibración constante que machaca lo cercano.": "持續振動，重擊附近敵人。",
  "Zarpazo de acero en arco.": "弧形的鋼爪斬擊。",
  "+1 proyectil": "投射物 +1",
  "+1 proyectil y +1 perforación": "投射物 +1、貫穿 +1",
  "+45% daño": "傷害 +45%",
  "-25% recarga": "冷卻時間 -25%",
  "+40% daño": "傷害 +40%",
  "+25% alcance": "射程 +25%",
  "Golpea en 360° y +50% daño": "360° 全方位攻擊、傷害 +50%",
  "+30% alcance y grosor": "射程與寬度 +30%",
  "+50% daño": "傷害 +50%",
  "+1 orbe": "光球 +1",
  "+55% daño": "傷害 +55%",
  "+25% radio y gira más rápido": "半徑 +25%，旋轉速度加快",
  "+1 orbe y +55% daño": "光球 +1、傷害 +55%",
  "+4 proyectiles": "投射物 +4",
  "+4 proyectiles y +1 perforación": "投射物 +4、貫穿 +1",
  "+30% radio": "半徑 +30%",
  "+30% radio y +50% daño": "半徑 +30%、傷害 +50%",
  "+40% potencia": "威力 +40%",
  "+1 acumulación máxima": "疊加上限 +1",
  "+50% duración": "持續時間 +50%",
  "+1 acumulación y +40% potencia": "疊加 +1、威力 +40%",
  "Golpea un 40% más a menudo": "攻擊頻率提高 40%",
  "×1,8 daño, +2 proyectiles, +2 perforación y más grandes": "傷害 ×1.8、投射物 +2、貫穿 +2，體積增大",
  "×1,9 daño, más alcance y golpea en 360°": "傷害 ×1.9、射程增加、360° 全方位攻擊",
  "×1,8 daño, rayo un 50% más grueso y más largo": "傷害 ×1.8，光束寬度與長度增加 50%",
  "+2 orbes, ×1,7 daño y más radio": "光球 +2、傷害 ×1.7、半徑增加",
  "+6 proyectiles, ×1,6 daño y +1 perforación": "投射物 +6、傷害 ×1.6、貫穿 +1",
  "×1,8 daño y un 35% más de radio": "傷害 ×1.8、半徑增加 35%",
  "Vigor": "活力",
  "Potencia": "威力",
  "Carrera": "衝刺",
  "Reflejos": "反應",
  "Coraza": "護甲",
  "Aprendizaje": "學習",
  "EVOLUCIÓN": "進化",
  "Evoluciona": "進化為",
  "Nuevo · {x}": "新招式 · {x}",
  "Nv.": "等級",
  "+20 de vida máxima (y la recupera).": "最大體力 +20，並回復等量體力。",
  "+10% de daño con todos los movimientos.": "所有招式傷害 +10%。",
  "+7% de velocidad de movimiento.": "移動速度 +7%。",
  "-8% de recarga en todos los movimientos.": "所有招式冷卻時間 -8%。",
  "+6% de reducción de daño recibido.": "受到的傷害降低 6%。",
  "+0.9 de vida regenerada por segundo.": "每秒回復 0.9 體力。",
  "+30% de radio de recogida de experiencia.": "經驗值拾取半徑 +30%。",
  "+12% de experiencia ganada.": "獲得的經驗值 +12%。",
  "Recupera el 45% de tu vida ahora mismo.": "立即回復 45% 體力。",
  "¡Nivel": "升級！等級",
  "¡Nivel {x}!": "升到 {x} 級！",
  "Elige una recompensa ·": "選擇獎勵 ·",
  "Elige tu carta": "選擇卡牌",
  "Faltan por elegir: {x}": "尚未選擇：{x}",
  "Esperando a {x}…": "正在等待 {x}…",
  "tú": "你",
  "Recuperas un 1,5% de tu vida por segundo.": "每秒回復 1.5% 體力。",
  "+40% de daño, pero no puedes cambiar de movimiento.": "傷害 +40%，但無法切換招式。",
  "-20% de recarga en todos tus movimientos.": "所有招式冷卻時間 -20%。",
  "Un golpe que te dejaría KO te deja con 1 de vida (cada 60 s).": "受到致命一擊時保留 1 點體力（每 60 秒一次）。",
  "Recuperas vida con el daño que haces.": "依造成的傷害回復體力。",
  "+50% de Pokémonedas al acabar la run.": "本局結束時獲得的寶可幣 +50%。",
  "+30% de experiencia.": "經驗值 +30%。",
  "+30% de daño, pero cada ataque te quita un poco de vida.": "傷害 +30%，但每次攻擊會消耗少量體力。",
  "+35% de velocidad.": "速度 +35%。",
  "Los que te golpean cuerpo a cuerpo reciben daño.": "以近身攻擊命中你的敵人會受到傷害。",
  "+20% de reducción de daño recibido.": "受到的傷害降低 20%。",
  "¡Un objeto!": "發現道具！",
  "Sólo puedes llevar uno ·": "只能攜帶一件 ·",
  "Quedarme con": "保留",
  "Cambiar a": "換成",
  "¡Llevas {x}!": "你攜帶了 {x}！",
  "Ya llevas {x}": "你已經攜帶 {x}",
  "¡Banda Focus!": "氣勢披帶！",
  "Vitalidad": "生命力",
  "Zancada": "步伐",
  "Fortuna": "幸運",
  "Sabiduría": "智慧",
  "Repertorio": "招式庫",
  "+8 vida": "體力 +8",
  "+4% daño": "傷害 +4%",
  "+3% velocidad": "速度 +3%",
  "-3% recarga": "冷卻時間 -3%",
  "+2% defensa": "防禦 +2%",
  "+0.2 vida/s": "每秒回復 0.2 體力",
  "+12% recogida": "拾取範圍 +12%",
  "+8% Pokémonedas": "寶可幣 +8%",
  "+5% experiencia": "經驗值 +5%",
  "Empiezas con 2 movimientos": "開局擁有 2 個招式",
  "Máx.": "已滿",
  "Cada Pokémon tiene sus propias mejoras: sólo cuentan cuando juegas con él.": "每隻寶可夢的強化獨立計算，只有使用該寶可夢時才會生效。",
  "(compañero)": "（夥伴）",
  "¡Poder {x}! {x} durante {x} s": "{x}之力！{x}，持續 {x} 秒",
  "Prisa": "迅捷",
  "daño ×2": "傷害 ×2",
  "+45% velocidad": "速度 +45%",
  "-40% recarga": "冷卻時間 -40%",
  "atraes todo desde lejos": "從遠處吸引所有物品",
  "¡Pegajoso!": "黏住了！",
  "El manantial se ha secado (se recarga solo)": "泉水已乾涸（會自行補充）",
  "Lluvia": "下雨",
  "Sol abrasador": "烈日",
  "Nevada": "降雪",
  "el Agua se potencia y el Fuego se debilita": "水系增強，火系減弱",
  "el Fuego se potencia y el Agua se debilita": "火系增強，水系減弱",
  "Roca, Tierra y Acero se potencian; el resto sufre": "岩石、地面與鋼系增強，其他系受到傷害",
  "el Hielo se potencia; el resto sufre y va más lento": "冰系增強，其他系受到傷害並減速",
  "Fantasma, Hada y Psíquico se potencian": "幽靈、妖精與超能力系增強",
  "Pradera Eterna": "永恆草原",
  "Volcán Ígneo": "熾焰火山",
  "Gruta Marina": "海濱洞窟",
  "Selva Esmeralda": "翡翠叢林",
  "Central Voltio": "電力工廠",
  "Glaciar Eterno": "永恆冰川",
  "Dojo Ancestral": "遠古道場",
  "Ciénaga Tóxica": "劇毒沼澤",
  "Desierto Rojo": "赤紅沙漠",
  "Pico Celeste": "蒼穹之巔",
  "Templo Mental": "心靈神殿",
  "Bosque Colmena": "蜂巢森林",
  "Cantera Antigua": "古老採石場",
  "Cementerio Sombrío": "幽暗墓園",
  "Santuario Dragón": "龍之聖域",
  "Callejón Oscuro": "幽暗小巷",
  "Fortaleza de Acero": "鋼鐵堡壘",
  "Bosque Encantado": "魔法森林",
  "Bosque Umbrío": "陰影森林",
  "Cueva Cristal": "水晶洞窟",
  "Volcán Ceniza": "灰燼火山",
  "Grieta · {x}": "裂隙 · {x}",
  "Grieta ·": "裂隙 ·",
  "GRIETA ·": "裂隙 ·",
  "¡{x} salvaje apareció!": "野生的 {x} 出現了！",
  "¡{x} shiny salvaje apareció!": "野生的閃光 {x} 出現了！",
  "¡Un {x} shiny anda cerca!": "附近有閃光 {x}！",
  "¡Marea de Pokémon!": "寶可夢大潮來襲！",
  "¡Has conseguido a {x} shiny!": "獲得了閃光 {x}！",
  "¡Otro {x} shiny! (+300 monedas)": "又一隻閃光 {x}！（+300 金幣）",
  "¡{x} te esperaba en la grieta!": "{x} 正在裂隙中等著你！",
  "¡{x} shiny te esperaba en la grieta!": "閃光 {x} 正在裂隙中等著你！",
  "¡Has vencido a {x}! Recoge el premio…": "你擊敗了 {x}！去領取獎勵吧…",
  "Criptomonedas": "加密貨幣",
  "PokéSurvivor no tiene ninguna criptomoneda, token ni NFT oficial, y su autor no ha creado ninguno. Cualquier token que use el nombre del juego lo han creado terceros: no nos hacemos cargo de ninguna compra, venta o inversión que hagas con ellos, y nada de lo que hay aquí es una recomendación de inversión.": "PokéSurvivor 沒有任何官方加密貨幣、代幣或 NFT，作者也未發行過。使用遊戲名稱的代幣皆由第三方建立；我們不對任何相關買賣或投資負責，此處內容也不構成投資建議。",
  "¡Vínculo!": "羈絆！",
  "Vínculo": "羈絆",
  "Atrás": "返回",
  "Los movimientos unidos se lanzan a la vez y ocupan un solo hueco": "連結的招式會同時施放，且只佔一個欄位",
  "Elige qué movimiento se une a {x}": "選擇要與 {x} 連結的招式",
  "¿Con cuál unes {x}?": "要將 {x} 與哪個招式連結？",
  "Elige el primer movimiento que vas a unir": "選擇第一個要連結的招式",
  "Se lanzará a la vez que {x}. Queda un hueco libre.": "會與 {x} 同時施放，並空出一個欄位。",
  "Se lanzará a la vez que {x}.": "會與 {x} 同時施放。",
  "¡Vínculo! {x} movimientos a la vez": "羈絆！同時施放 {x} 個招式",
  "Guardas el vínculo: aprende otro movimiento para usarlo": "已保留羈絆：學會另一個招式後即可使用",
  "¡Se ha abierto una grieta misteriosa!": "神祕的裂隙開啟了！",
  "Has entrado en la grieta…": "你進入了裂隙…",
  "La grieta os ha expulsado…": "裂隙將你們彈了出來…",
  "{x} ha dejado la partida": "{x} 離開了遊戲",
  "+1 ticket": "抽獎券 +1",
  "¡Ticket ×10!": "十連抽獎券！",
  "· ×{x} Fortuna": "· 幸運 ×{x}",
  "Has caído: un compañero puede levantarte": "你倒下了：隊友可以救起你",
  "Habéis caído todos…": "所有人都倒下了…",
  "¡{x} necesita ayuda! · {x} m": "{x} 需要救援！· {x} 公尺",
  "CAÍDO": "倒地",
  "Quédate a su lado": "待在隊友身旁",
  "Grieta · {x} m · {x} s": "裂隙 · {x} 公尺 · {x} 秒",
  "DERROTADOS ·": "擊敗 ·",
  "MONEDAS": "金幣",
  "{x} · {x} DERROTADOS · {x} MONEDAS": "{x} · 擊敗 {x} · 金幣 {x}",
  "Arrastra el dedo para moverte · toca un ataque para cambiarlo": "拖曳手指移動 · 點擊招式切換",
  "WASD moverse · 1-4 / Q / E o clic en un ataque para cambiarlo · Esc pausa": "WASD 移動 · 1–4／Q／E 或點擊切換招式 · Esc 暫停",
  "El anfitrión ha terminado la partida": "房主已結束遊戲",
  "Se ha perdido la conexión con el anfitrión.": "與房主的連線中斷。",
  "Pausa": "暫停",
  "Continuar": "繼續",
  "Abandonar run": "結束本局",
  "moverse ·": "移動 ·",
  "movimiento ·": "移動 ·",
  "ciclar ·": "切換 ·",
  "pausa": "暫停",
  "Partida en grupo: el juego sigue mientras estás aquí.": "多人遊戲：開啟此畫面時，遊戲仍會繼續進行。",
  "Has caído…": "你倒下了…",
  "Run terminada": "本局結束",
  "Volver al menú": "返回選單",
  "Salir de la partida": "離開遊戲",
  "Tiempo": "時間",
  "Nivel": "等級",
  "Derrotados": "擊敗數",
  "Jefes": "首領",
  "Pokémonedas ganadas": "獲得寶可幣",
  "Movimientos": "招式",
  "¡Nuevo récord de tiempo!": "生存時間新紀錄！",
  "· ¡nuevo!": "· 新紀錄！",
  "{x} Shinies conseguidos": "捕獲 {x} 隻閃光寶可夢",
  "Tickets del gacha": "扭蛋抽獎券",
  "Nivel máximo": "最高等級",
  "Mundo Misterioso": "不可思議的迷宮",
  "Entrar": "登入",
  "Crear cuenta": "註冊",
  "Nombre": "名稱",
  "Contraseña": "密碼",
  "Entrar con Google": "使用 Google 登入",
  "Jugar como invitado": "以訪客身分遊玩",
  "3-16 letras, números o _": "3～16 個英文字母、數字或底線",
  "Sobrevive a las hordas con tu compañero Pokémon · gratis, en PC y móvil": "與寶可夢夥伴抵擋敵潮 · 電腦與手機皆可免費遊玩",
  "Juego de supervivencia con Pokémon, gratis en el navegador y en el móvil.": "免費的寶可夢生存遊戲，可在瀏覽器與手機遊玩。",
  "Cargando…": "載入中…",
  "Guía": "遊戲指南",
  "Aviso legal y privacidad": "法律聲明與隱私權",
  "Tu partida se guarda en la nube: entra desde cualquier ordenador. Como invitado no se guarda.": "遊戲進度儲存在雲端，可從任何電腦登入。訪客進度不會保留。",
  "Abierto desde un archivo: la partida sólo se guarda en este navegador. Para guardar en la nube, juega en la versión publicada.": "目前以檔案開啟，進度只會儲存在此瀏覽器。雲端存檔需使用線上版本。",
  "No se pudo conectar con la nube: la partida sólo se guarda en este navegador.": "無法連線至雲端，進度只會儲存在此瀏覽器。",
  "Nube sin configurar: la partida sólo se guarda en este navegador.": "未設定雲端服務，進度只會儲存在此瀏覽器。",
  "Este navegador no deja guardar datos: juega como invitado.": "瀏覽器不允許儲存資料，請以訪客身分遊玩。",
  "Usuario o contraseña incorrectos.": "帳號名稱或密碼錯誤。",
  "Ese nombre ya existe.": "此名稱已被使用。",
  "La contraseña debe tener al menos 6 caracteres.": "密碼至少需要 6 個字元。",
  "La contraseña debe tener al menos {x} caracteres.": "密碼至少需要 {x} 個字元。",
  "El nombre debe tener 3-16 letras, números o _.": "名稱需為 3～16 個英文字母、數字或底線。",
  "Demasiados intentos seguidos. Espera un poco.": "嘗試次數過多，請稍候再試。",
  "Sin conexión a internet.": "沒有網路連線。",
  "El navegador bloqueó la ventana de Google. Permite las ventanas emergentes.": "瀏覽器封鎖了 Google 登入視窗，請允許彈出式視窗。",
  "Este dominio no está autorizado en Firebase (Authentication > Configuración > Dominios autorizados).": "此網域尚未獲得 Firebase 授權（Authentication > Settings > Authorized domains）。",
  "Entrar con Google necesita la versión publicada del juego.": "Google 登入需使用遊戲的線上版本。",
  "Ese método de inicio de sesión no está activado en Firebase.": "Firebase 尚未啟用此登入方式。",
  "La base de datos rechazó el acceso (revisa las reglas de Firestore).": "資料庫拒絕存取，請檢查 Firestore 規則。",
  "Sin conexión con la base de datos.": "無法連線至資料庫。",
  "El navegador no deja guardar datos (¿modo incógnito?).": "瀏覽器不允許儲存資料，可能是無痕模式。",
  "Por seguridad, vuelve a iniciar sesión y repite la operación.": "為確保安全，請重新登入後再操作。",
  "No hay cuenta que borrar.": "沒有可刪除的帳號。",
  "Error:": "錯誤：",
  "Invitado": "訪客",
  "Entrenador": "訓練家",
  "Tu personalidad es…": "你的性格是…",
  "Pregunta {x} de {x}": "第 {x} 題，共 {x} 題",
  "Selecciona un Pokémon": "選擇寶可夢",
  "¡{x} se une a ti!": "{x} 加入了！",
  "Elige a tu compañero": "選擇你的夥伴",
  "Los iniciales de todas las regiones, y dos amigos más.": "各地區的最初夥伴，以及另外兩位朋友。",
  "Elegir": "選擇",
  "Elegir otro": "重新選擇",
  "¡Vamos juntos!": "一起出發吧！",
  "Tu compañero:": "你的夥伴：",
  "¡Hay una pelea en mitad del pueblo! ¿Qué haces?": "有人在城鎮中央打架！你會怎麼做？",
  "Me meto a ayudar sin pensarlo.": "不加思索地上前幫忙。",
  "Busco a alguien que pueda pararla.": "尋找能阻止衝突的人。",
  "Lo observo todo desde lejos.": "在遠處觀察。",
  "Me río y animo a los dos.": "笑著替雙方加油。",
  "Te encuentras una cartera en el suelo.": "你在地上撿到一個錢包。",
  "La llevo enseguida a la policía.": "馬上交給警察。",
  "Busco a su dueño aunque tarde horas.": "就算花上幾個小時，也要找到失主。",
  "Primero miro qué hay dentro…": "先看看裡面有什麼…",
  "Ni la toco, no vaya a ser.": "為了保險起見，我不會碰它。",
  "Mañana tienes un examen importante.": "明天有一場重要考試。",
  "Estudio hasta las tantas.": "熬夜讀書。",
  "Repaso lo justo: confío en mí.": "稍微複習就好，我相信自己。",
  "Me agobio muchísimo.": "我會非常緊張。",
  "¿Examen? Ya veré mañana.": "考試？明天再說吧。",
  "Alguien se burla de ti delante de todos.": "有人當眾嘲笑你。",
  "Le contesto en el acto.": "立刻回嘴。",
  "Le devuelvo una broma mejor.": "用更好笑的笑話反擊。",
  "Le ignoro por completo.": "完全不理會對方。",
  "Me afecta, aunque no lo diga.": "雖然不說出口，但我很受傷。",
  "¿Qué es lo más importante para ti?": "你最重視什麼？",
  "Ser el mejor.": "成為最優秀的人。",
  "La amistad.": "友情。",
  "La libertad.": "自由。",
  "La calma.": "平靜。",
  "El camino se divide: uno oscuro y corto, otro largo y soleado.": "前方有岔路：一條陰暗但較短，另一條較長且陽光充足。",
  "El oscuro, ¡más emoción!": "選陰暗的路，更刺激！",
  "El largo, sin prisa.": "走長路，不急。",
  "Me siento a pensarlo un rato.": "坐下來好好想想。",
  "Ninguno: abro un atajo nuevo.": "都不選，自己開闢捷徑。",
  "¿Qué dicen de ti tus amigos?": "朋友怎麼形容你？",
  "Que siempre pueden contar conmigo.": "總是值得信賴。",
  "Que soy lo más divertido del grupo.": "團體裡最有趣的人。",
  "Que soy un poco misterioso.": "有點神祕。",
  "Que no me rindo nunca.": "永不放棄。",
  "Tu día libre ideal es…": "你理想中的假日是…",
  "Entrenar para ser mejor.": "鍛鍊自己，變得更強。",
  "Quedar con todos mis amigos.": "和所有朋友一起玩。",
  "Una aventura sin ningún plan.": "毫無計畫地去冒險。",
  "Leer, pensar, estar tranquilo.": "閱讀、思考，享受寧靜。",
  "No te lo piensas dos veces cuando alguien necesita ayuda.": "有人需要幫忙時，你總是毫不猶豫。",
  "Tus amigos saben que pueden contar contigo siempre.": "朋友都知道，你永遠值得信賴。",
  "Mides cada paso antes de darlo.": "每一步行動前，你都會仔細思考。",
  "Contagias energía allá donde vas.": "你走到哪裡，就把活力帶到哪裡。",
  "Mantienes la calma cuando todo se complica.": "遇到複雜的狀況，你依然保持冷靜。",
  "Actúas primero y piensas después. ¡A veces sale bien!": "你先行動再思考，有時效果還不錯！",
  "Te exiges ser el mejor, y casi siempre lo consigues.": "你努力追求最好，而且幾乎總能做到。",
  "Siempre tienes una broma preparada.": "你隨時都能講出笑話。",
  "Vas a tu aire y no te importa.": "你做自己想做的事，不在意別人眼光。",
  "Te cuesta dar el primer paso, pero sientes mucho.": "你不容易踏出第一步，但感情很深。",
  "Nada te altera. Nada.": "沒有任何事能動搖你，真的。",
  "Sabes esperar el momento justo.": "你善於等待最佳時機。",
  "Ni tú sabes qué vas a hacer después.": "連你自己都不知道下一步會做什麼。",
  "Rendirse no entra en tus planes.": "你的計畫裡沒有放棄。",
  "Ves soluciones donde otros ven problemas.": "別人看見難題，你看見解法。",
  "Tu amabilidad tranquiliza a todos los que te rodean.": "你的溫柔讓身邊的人安心。",
  "Jugar": "開始遊戲",
  "Entra en la mazmorra": "進入迷宮",
  "Pokémon": "寶可夢",
  "Tu colección": "你的收藏",
  "Mejoras": "強化",
  "Haz más fuerte cada run": "讓每一局都更強",
  "9 regiones · Pokémon y shinies": "9 個地區 · 寶可夢與閃光寶可夢",
  "Misiones": "任務",
  "Misiones, logros y perfil": "任務、成就與個人檔案",
  "Amigos": "好友",
  "Juega en grupo, hasta 4": "最多 4 人一起遊玩",
  "Ranking": "排行榜",
  "Quién aguanta más": "誰能生存最久",
  "Ajustes": "設定",
  "Sonido, gráficos, controles y cuenta": "音效、畫質、操作與帳號",
  "{x} premio por recoger": "有 {x} 項獎勵可領取",
  "{x} premios por recoger": "有 {x} 項獎勵可領取",
  "premio por recoger": "項獎勵可領取",
  "premios por recoger": "項獎勵可領取",
  "Volver a tu sala ({x})": "返回你的房間（{x}）",
  "{x} en línea": "{x} 人在線上",
  "en línea": "在線上",
  "{x} solicitud": "{x} 個邀請",
  "{x} solicitudes": "{x} 個邀請",
  "Runs": "遊玩場次",
  "· Mejor tiempo": "· 最佳時間",
  "Mejor nivel": "最高等級",
  "· Derrotados": "· 擊敗數",
  "Modo invitado: no se guarda": "訪客模式：不會存檔",
  "Salir": "登出",
  "Eres invitado: se perderá todo el progreso. ¿Salir?": "你目前是訪客，登出將失去所有進度。確定登出？",
  "Proyecto de fan sin ánimo de lucro · Sprites: SpriteCollab (CC BY-NC 4.0) · Pokémon © Nintendo/Creatures/GAME FREAK ·": "非營利同人作品 · 精靈圖：SpriteCollab（CC BY-NC 4.0）· 寶可夢 © Nintendo／Creatures／GAME FREAK ·",
  "Aviso legal": "法律聲明",
  "Volver": "返回",
  "Todos": "全部",
  "Tengo": "已擁有",
  "Me faltan": "未擁有",
  "Legendaria": "傳說",
  "Épica": "史詩",
  "Rara": "稀有",
  "Poco común": "少見",
  "Común": "普通",
  "Ninguno con este filtro.": "沒有符合條件的寶可夢。",
  "Ataque": "攻擊",
  "Vida": "體力",
  "Velocidad": "速度",
  "Empieza con": "初始招式",
  "Es tu compañero": "這是你的夥伴",
  "Elegir de compañero{x}": "選為夥伴{x}",
  "(shiny)": "（閃光）",
  "Aún no lo tienes.": "你尚未擁有這隻寶可夢。",
  "Consíguelo en el banner de": "可從此地區的卡池獲得：",
  "o derrotándolo cuando salga shiny.": "或在野外遇見其閃光版本並擊敗牠。",
  "{x} es ahora tu compañero": "{x} 成為你的夥伴了",
  "{x} shiny es ahora tu compañero": "閃光 {x} 成為你的夥伴了",
  "· {x} shiny": "· {x} 閃光",
  "{x} · {x}: nivel {x}": "{x} · {x}：等級 {x}",
  "Gacha": "扭蛋",
  "Misterioso": "神祕",
  "Los {x} Pokémon de la generación {x}. ¡Los legendarios esperan!": "共 {x} 隻第 {x} 世代寶可夢，傳說寶可夢等著你！",
  "Tienes {x} de {x}": "已擁有 {x}／{x}",
  "Tienes {x}": "你擁有 {x}",
  "Gen {x}": "第 {x} 世代",
  "Probabilidades": "機率",
  "Tiradas sin legendaria en {x}: {x} / {x}": "{x} 卡池未抽中傳說的次數：{x}／{x}",
  "· A las {x} tiradas sin Legendaria en un banner, la siguiente lo es.": "· 同一卡池連續 {x} 抽未獲得傳說寶可夢，下次必定獲得。",
  "· La tirada ×10 garantiza al menos una Épica.": "· 十連抽保證至少獲得一隻史詩寶可夢。",
  "· Los repetidos dan Pokémonedas (los shiny repetidos, el triple).": "· 重複寶可夢會轉換成寶可幣，重複閃光可得三倍。",
  "· Los tickets se consiguen jugando: algunos Pokémon los sueltan al caer, y los jefes y los legendarios de las grietas dan tickets ×10.": "· 抽獎券可透過遊玩獲得：部分寶可夢被擊敗時會掉落，首領與裂隙中的傳說寶可夢會掉落十連抽獎券。",
  "Tirar ×1 ·": "單抽 ·",
  "Tirar ×10 ·": "十連抽 ·",
  "tickets ×10": "十連抽獎券",
  "tickets y {x}": "抽獎券與 {x}",
  "No tienes tickets suficientes: consíguelos jugando": "抽獎券不足，請透過遊玩獲得",
  "¡NUEVO!": "首次獲得！",
  "¡SHINY NUEVO!": "新閃光！",
  "Repetido ·": "重複 ·",
  "· {x} {x} shiny": "· {x} {x} 閃光",
  "{x} Shiny": "{x} 閃光",
  "Clic para acelerar": "點擊加速",
  "TIRADA": "抽獎",
  "TIRADA ×10": "十連抽",
  "¡SUERTE!": "祝你好運！",
  "¡¿SHINY?!": "閃光？！",
  "¡¿LEGENDARIO?!": "傳說？！",
  "¡¿ÉPICO?!": "史詩？！",
  "SHINY ·": "閃光 ·",
  "Logros": "成就",
  "Perfil": "個人檔案",
  "Diarias": "每日",
  "Semanales": "每週",
  "Se renuevan en {x}": "將於 {x} 後更新",
  "Recoger": "領取",
  "Recogido": "已領取",
  "En curso": "進行中",
  "Cambiar": "更換",
  "Cambia esta misión por otra (una vez al día)": "更換此任務（每日限一次）",
  "¡Premio recogido!": "已領取獎勵！",
  "Misión completada: {x}": "任務完成：{x}",
  "Recoge el premio en Misiones": "前往任務頁面領取獎勵",
  "¡Logro: {x}!": "成就達成：{x}！",
  "Nuevo título: {x}": "新稱號：{x}",
  "¡Conseguido!": "已解鎖！",
  "{x} de {x} logros · títulos: {x}": "成就 {x}／{x} · 稱號：{x}",
  "Legendarios vencidos {x} / {x}": "已擊敗傳說寶可夢 {x}／{x}",
  "· ¡vencido!": "· 已擊敗！",
  "Así te ven los demás jugadores (desde el ranking y la lista de amigos).": "其他玩家會在排行榜與好友清單中看到這份個人檔案。",
  "Tus 3 Pokémon favoritos": "你最喜愛的 3 隻寶可夢",
  "Elige el favorito {x}": "選擇第 {x} 隻最愛",
  "Título": "稱號",
  "Título: {x}": "稱號：{x}",
  "(sin título)": "（無稱號）",
  "Consigue logros para desbloquear títulos.": "解鎖成就以獲得稱號。",
  "Ver mi perfil público": "檢視我的公開個人檔案",
  "Tu perfil se publica cuando juegas con una cuenta online.": "使用線上帳號遊玩時，會公開你的個人檔案。",
  "Este jugador aún no tiene perfil.": "這位玩家尚未建立個人檔案。",
  "Sin favoritos todavía.": "尚未設定最愛。",
  "Aún sin medallas.": "尚未獲得獎章。",
  "Medallas": "獎章",
  "Mejor tiempo": "最佳時間",
  "En grupo": "多人",
  "Legendarios": "傳說寶可夢",
  "Cerrar": "關閉",
  "Derrota a {x} Pokémon": "擊敗 {x} 隻寶可夢",
  "Derrota a {x} Pokémon de tipo {x}": "擊敗 {x} 隻 {x}系寶可夢",
  "Derrota a {x} jefes": "擊敗 {x} 隻首領",
  "Derrota a un jefe": "擊敗一隻首領",
  "Aguanta {x} minutos en una run": "在一局中生存 {x} 分鐘",
  "Aguanta {x} minutos con un Pokémon de tipo {x}": "生存 {x} 分鐘，使用 {x}系寶可夢",
  "Llega al nivel {x} en una run": "在一局中達到 {x} 級",
  "Recoge {x} monedas en tus runs": "遊玩時收集 {x} 枚金幣",
  "Abre un cofre con candado": "開啟一個上鎖寶箱",
  "Abre {x} cofres con candado": "開啟 {x} 個上鎖寶箱",
  "Gana una pelea en una grieta": "贏得一場裂隙戰鬥",
  "Gana {x} peleas en grietas": "贏得 {x} 場裂隙戰鬥",
  "Evoluciona un movimiento": "進化一個招式",
  "Evoluciona {x} movimientos": "進化 {x} 個招式",
  "Encuentra un objeto equipable": "找到一件攜帶道具",
  "Completa {x} misiones diarias": "完成 {x} 個每日任務",
  "Colección": "收藏",
  "Supervivencia": "生存",
  "Combate": "戰鬥",
  "Grietas": "裂隙",
  "Misiones y más": "任務與其他",
  "Primer compañero": "第一位夥伴",
  "Pequeño equipo": "小小隊伍",
  "Coleccionista": "收藏家",
  "Enciclopedia": "百科全書",
  "Profesor Pokémon": "寶可夢博士",
  "Maestro Pokémon": "寶可夢大師",
  "Anticuario": "古物收藏家",
  "Ten 1 Pokémon.": "擁有 1 隻寶可夢。",
  "Ten 10 Pokémon.": "擁有 10 隻寶可夢。",
  "Ten 50 Pokémon.": "擁有 50 隻寶可夢。",
  "Ten 100 Pokémon.": "擁有 100 隻寶可夢。",
  "Ten 250 Pokémon.": "擁有 250 隻寶可夢。",
  "Ten 500 Pokémon.": "擁有 500 隻寶可夢。",
  "Ten los {x} Pokémon del juego.": "擁有遊戲中全部 {x} 隻寶可夢。",
  "Ten todos los Pokémon del juego.": "擁有遊戲中的所有寶可夢。",
  "Algo brilla": "閃耀的光芒",
  "Ojo para el brillo": "慧眼識閃光",
  "Cazashinies": "閃光獵人",
  "Consigue 1 shiny.": "獲得 1 隻閃光寶可夢。",
  "Consigue 5 shinies.": "獲得 5 隻閃光寶可夢。",
  "Consigue 20 shinies.": "獲得 20 隻閃光寶可夢。",
  "Calentando": "熱身中",
  "Superviviente": "生存者",
  "Resistente": "堅韌",
  "Duro de pelar": "難以擊倒",
  "Imparable": "勢不可擋",
  "Aguanta 5 minutos.": "生存 5 分鐘。",
  "Aguanta 10 minutos.": "生存 10 分鐘。",
  "Aguanta 15 minutos.": "生存 15 分鐘。",
  "Aguanta 20 minutos.": "生存 20 分鐘。",
  "Creciendo": "茁壯成長",
  "Veterano": "老練訓練家",
  "Llega al nivel 20 en una run.": "在一局中達到 20 級。",
  "Llega al nivel 40 en una run.": "在一局中達到 40 級。",
  "Llega al nivel 15 en una run.": "在一局中達到 15 級。",
  "Llega al nivel 30 en una run.": "在一局中達到 30 級。",
  "Primeros combates": "初次交鋒",
  "Valiente": "勇敢",
  "Leyenda": "傳奇",
  "Leyenda viva": "活傳奇",
  "Derrota a 1.000 Pokémon.": "擊敗 1,000 隻寶可夢。",
  "Derrota a 10.000 Pokémon.": "擊敗 10,000 隻寶可夢。",
  "Derrota a 100.000 Pokémon.": "擊敗 100,000 隻寶可夢。",
  "Derrota a un jefe.": "擊敗一隻首領。",
  "Derrota a 25 jefes.": "擊敗 25 隻首領。",
  "Derrota a 100 jefes.": "擊敗 100 隻首領。",
  "Cazajefes": "首領獵人",
  "Matagigantes": "巨人殺手",
  "Terror de los jefes": "首領剋星",
  "Al otro lado": "另一端",
  "Saltagrietas": "裂隙跳躍者",
  "Viajero de grietas": "裂隙旅人",
  "Explorador": "探索者",
  "Gana tu primera pelea en una grieta.": "贏得第一場裂隙戰鬥。",
  "Gana 10 peleas en grietas.": "贏得 10 場裂隙戰鬥。",
  "Gana en las 18 arenas (una por tipo).": "在全部 18 座系別競技場獲勝。",
  "Cazalegendarios": "傳說獵人",
  "Domador de mitos": "神話馴服者",
  "Vence a 10 legendarios distintos.": "擊敗 10 種不同的傳說寶可夢。",
  "Vence a 30 legendarios distintos.": "擊敗 30 種不同的傳說寶可夢。",
  "Vence a los {x} legendarios.": "擊敗全部 {x} 隻傳說寶可夢。",
  "Vence a todos los legendarios.": "擊敗所有傳說寶可夢。",
  "Vence a {x}": "擊敗 {x}",
  "Derrota a {x} en una grieta.": "在裂隙中擊敗 {x}。",
  "Evolución": "進化",
  "Evolucionista": "進化專家",
  "Maestro de movimientos": "招式大師",
  "Evoluciona un movimiento.": "進化一個招式。",
  "Evoluciona 25 movimientos.": "進化 25 個招式。",
  "Evoluciona los {x} movimientos distintos.": "進化全部 {x} 種不同招式。",
  "Evoluciona los 47 movimientos distintos.": "進化全部 47 種不同招式。",
  "Coleccionista de objetos": "道具收藏家",
  "Bolsa llena": "背包滿滿",
  "Encuentra 5 objetos distintos.": "找到 5 種不同道具。",
  "Encuentra los 11 objetos.": "找到全部 11 種道具。",
  "Cumplidor": "可靠",
  "Constante": "持之以恆",
  "Incansable": "不知疲倦",
  "Completa 10 misiones.": "完成 10 個任務。",
  "Completa 50 misiones.": "完成 50 個任務。",
  "Completa 200 misiones.": "完成 200 個任務。",
  "En compañía": "有伴真好",
  "Cien amigos": "好友滿天下",
  "Juega una partida en grupo.": "遊玩一場多人遊戲。",
  "Juega 10 partidas en grupo.": "遊玩 10 場多人遊戲。",
  "Compañero fiel": "忠實夥伴",
  "Juega 50 runs.": "遊玩 50 局。",
  "Afortunado": "幸運兒",
  "Tragaperras": "扭蛋常客",
  "Haz 100 tiradas en el gacha.": "進行 100 次扭蛋抽獎。",
  "Brillante": "光彩奪目",
  "Elige tu apodo": "選擇你的暱稱",
  "Guardar apodo": "儲存暱稱",
  "Ahora no": "稍後再說",
  "Es el nombre que verán tus amigos y el que sale en el ranking. Tu nombre y tu correo de Google no se enseñan a nadie.": "好友與排行榜會顯示這個名稱。你的真實姓名與 Google 電子郵件不會向其他人公開。",
  "Tu apodo:": "你的暱稱：",
  "· dáselo a tus amigos para que te añadan.": "· 將暱稱告訴朋友，讓他們加你為好友。",
  "Tu apodo es {x}": "你的暱稱是 {x}",
  "Apodo de tu amigo": "好友的暱稱",
  "Añadir amigo": "新增好友",
  "Aún no tienes amigos añadidos. Escribe arriba el apodo de un amigo.": "你尚未新增好友，請在上方輸入好友的暱稱。",
  "Quiere ser tu amigo": "想加你為好友",
  "Solicitud enviada": "已送出邀請",
  "Desconectado": "離線",
  "Jugando": "遊玩中",
  "En línea": "在線上",
  "Visto hace {x} min": "{x} 分鐘前上線",
  "Visto hace {x} h": "{x} 小時前上線",
  "Visto hace {x} días": "{x} 天前上線",
  "hace {x} min": "{x} 分鐘前",
  "hace {x} h": "{x} 小時前",
  "hace {x} días": "{x} 天前",
  "Visto": "上次上線",
  "Aceptar": "接受",
  "Rechazar": "拒絕",
  "Quitar": "移除",
  "Invitar": "邀請",
  "En la sala": "在房間中",
  "En tu sala": "在你的房間中",
  "¿Quitar a {x} de tus amigos?": "確定要將 {x} 從好友中移除？",
  "Cancelar": "取消",
  "Crea una cuenta para jugar con amigos y salir en el ranking.": "建立帳號即可與好友遊玩並登上排行榜。",
  "Esto necesita la versión online del juego (con la nube).": "此功能需要有雲端服務的線上版本。",
  "Primero elige tu apodo.": "請先選擇暱稱。",
  "Escribe el apodo exacto de tu amigo.": "請輸入好友的完整暱稱。",
  "No hay ningún jugador con ese apodo.": "找不到使用此暱稱的玩家。",
  "Ese eres tú.": "這是你自己。",
  "Ya sois amigos.": "你們已經是好友了。",
  "Ya le enviaste una solicitud.": "你已經送出邀請了。",
  "Solicitud enviada a {x}": "已向 {x} 送出好友邀請",
  "Ahora eres amigo de {x}": "你和 {x} 成為好友了",
  "No hay solicitud.": "沒有邀請。",
  "El apodo debe tener 3-16 letras, números o _.": "暱稱需為 3～16 個英文字母、數字或底線。",
  "Ese apodo ya lo tiene otro jugador.": "此暱稱已被使用。",
  "No se pudo guardar el apodo ({x}).": "無法儲存暱稱（{x}）。",
  "No se pudo enviar ({x}).": "無法送出（{x}）。",
  "No se pudo aceptar ({x}).": "無法接受（{x}）。",
  "No se pudo borrar ({x}).": "無法移除（{x}）。",
  "No se pudo invitar ({x}).": "無法送出邀請（{x}）。",
  "Sala": "房間",
  "Menú": "選單",
  "Salir de la sala": "離開房間",
  "Invitar amigos": "邀請好友",
  "Empezar partida": "開始遊戲",
  "Empezar partida ({x})": "開始遊戲（{x}）",
  "Anfitrión": "房主",
  "Libre": "空位",
  "Tú": "你",
  "Conectado": "已連線",
  "Conectado (por servidor)": "已連線（透過伺服器）",
  "Conectando…": "連線中…",
  "Conectando con tus amigos…": "正在連線至好友…",
  "Ningún amigo en línea ahora mismo.": "目前沒有好友在線上。",
  "Eres el anfitrión. Invita a tus amigos (hasta {x}) y empezad cuando estéis.": "你是房主，最多可邀請 {x} 位好友，準備好就開始吧。",
  "Estás en la sala de {x}. El anfitrión empezará la partida.": "你在 {x} 的房間中，請等待房主開始遊戲。",
  "Cuando el anfitrión empiece, entraréis todos a la vez.": "房主開始後，所有人會同時進入遊戲。",
  "La partida empieza para todos a la vez.": "所有人會同時開始遊戲。",
  "Necesitas al menos un amigo en la sala.": "房間中至少需要一位好友。",
  "La sala se ha cerrado": "房間已關閉",
  "Invitación enviada a {x}": "已向 {x} 送出邀請",
  "Sólo puedes invitar a tus amigos.": "只能邀請好友。",
  "La sala está llena.": "房間已滿。",
  "Sólo el anfitrión de la sala puede invitar.": "只有房主可以邀請。",
  "La invitación ha caducado.": "邀請已過期。",
  "Esa sala ya no existe.": "此房間已不存在。",
  "La partida de esa sala ya ha empezado.": "此房間的遊戲已經開始。",
  "No se pudo entrar en la sala.": "無法加入房間。",
  "La sala está llena (máximo {x}).": "房間已滿（最多 {x} 人）。",
  "{x} te invita a jugar en su sala": "{x} 邀請你加入房間一起遊玩",
  "te invita a jugar en su sala": "邀請你加入房間一起遊玩",
  "Unirme": "加入",
  "No, gracias": "不用了，謝謝",
  "Ir a la sala": "前往房間",
  "tiempo aguantado": "生存時間",
  "· tiempo aguantado": "· 生存時間",
  "Semanal": "本週",
  "Mensual": "本月",
  "Anual": "本年",
  "Histórico": "歷史紀錄",
  "Sólo amigos": "只顯示好友",
  "Filtrar por Pokémon (histórico)": "依寶可夢篩選（歷史紀錄）",
  "Quitar filtro": "清除篩選",
  "{x} Solo": "{x} 單人",
  "{x} Grupo": "{x} 多人",
  "Grupo": "多人",
  "Todavía no hay marcas aquí. ¡Sé el primero!": "尚無紀錄，來當第一個吧！",
  "No hay ningún Pokémon con ese nombre": "找不到這個名稱的寶可夢",
  "No se pudo cargar el ranking ({x}).": "無法載入排行榜（{x}）。",
  "Elige un apodo (en Amigos) para salir en el ranking.": "請先在好友頁面選擇暱稱，才能登上排行榜。",
  "Tu mejor puesto {x} {x}:": "你的最佳排名 {x} {x}：",
  "Aún no tienes marca {x} {x}.": "你尚無 {x} {x} 的紀錄。",
  "de hoy": "今日",
  "de esta semana": "本週",
  "de este mes": "本月",
  "de este año": "本年",
  "de siempre": "歷史",
  "en solitario": "單人",
  "en grupo": "多人",
  "Nv. {x} · {x} derrotados": "等級 {x} · 擊敗 {x}",
  "¡Nueva mejor marca {x} en el ranking!": "排行榜新紀錄：{x}！",
  "de la semana": "本週",
  "del mes": "本月",
  "del año": "本年",
  "histórico": "歷史",
  "Sonido": "音效",
  "Gráficos": "畫面",
  "Controles": "操作",
  "Cuenta": "帳號",
  "Acerca de": "關於",
  "Música": "音樂",
  "Efectos": "音效",
  "Silenciar todo": "全部靜音",
  "Activar sonido": "取消靜音",
  "Calidad": "畫質",
  "Auto": "自動",
  "Alta": "高",
  "Media": "中",
  "Baja": "低",
  "Cuántos efectos y partículas se dibujan.": "調整特效與粒子數量。",
  "la baja sola si el juego va a tirones (ahora:": "會在遊戲卡頓時自動降低畫質（目前：",
  "Cuántos efectos y partículas se dibujan. {x} la baja sola si el juego va a tirones (ahora: {x}).": "調整特效與粒子數量。{x}會在遊戲卡頓時自動降低畫質（目前：{x}）。",
  "alta": "高",
  "media": "中",
  "baja": "低",
  "Pantalla": "顯示",
  "Números de daño": "傷害數字",
  "Los números que salen al golpear y al recibir daño.": "攻擊或受傷時顯示的數字。",
  "Menos sacudidas y destellos": "減少震動與閃光",
  "La cámara tiembla menos y los fogonazos son suaves.": "降低畫面震動與閃光強度。",
  "Mostrar FPS": "顯示 FPS",
  "Fotogramas por segundo, en la esquina de abajo.": "在畫面下方角落顯示每秒影格數。",
  "Pantalla completa": "全螢幕",
  "Sin barras del navegador.": "隱藏瀏覽器工具列。",
  "Activar": "啟用",
  "Sí": "是",
  "No": "否",
  "Idioma": "語言",
  "El juego se recarga al cambiarlo.": "變更語言後會重新載入遊戲。",
  "En móvil o tablet": "手機與平板",
  "En PC": "電腦",
  "Tamaño del joystick": "搖桿大小",
  "Cuánto hay que arrastrar el dedo.": "調整手指需要拖曳的距離。",
  "Pequeño": "小",
  "Grande": "大",
  "o flechas": "或方向鍵",
  "moverse": "移動",
  "o clic en el icono": "或點擊圖示",
  "elegir ataque": "選擇招式",
  "ataque anterior / siguiente": "上一個／下一個招式",
  "elegir carta al subir de nivel": "升級時選擇卡牌",
  "Pon el dedo en cualquier parte y arrastra para moverte: el joystick aparece donde tocas. Toca un ataque de abajo para cambiarlo y el botón de arriba a la derecha para pausar. Se juega en horizontal.": "在任意位置拖曳手指即可移動，搖桿會出現在觸碰處。點擊下方招式可切換，右上角按鈕可暫停。請橫向遊玩。",
  "Apodo": "暱稱",
  "Es único y no se puede cambiar.": "暱稱不可重複，且無法變更。",
  "Tipo de cuenta": "帳號類型",
  "Partida": "存檔",
  "Cuenta de este navegador": "此瀏覽器的帳號",
  "Nombre y contraseña": "名稱與密碼",
  "Google": "Google",
  "Cerrar sesión": "登出",
  "Borrar cuenta": "刪除帳號",
  "Crear cuenta o entrar": "註冊或登入",
  "Estás jugando como": "目前遊玩身分：",
  "Estás jugando como {x}: tu progreso no se guarda al salir.": "目前以{x}身分遊玩，離開後不會保留進度。",
  ": tu progreso no se guarda al salir.": "：離開後不會保留進度。",
  "invitado": "訪客",
  "Guardado en la nube": "已儲存至雲端",
  "Guardando…": "儲存中…",
  "Pendiente de subir (se sube al salir del juego)": "等待上傳（離開遊戲時上傳）",
  "Sin conexión: se subirá al volver": "離線中，恢復連線後會上傳",
  "Guardado sólo en este navegador": "只儲存在此瀏覽器",
  "Invitado: no se guarda": "訪客：不會存檔",
  "Se borrarán tu cuenta y toda tu partida, para siempre. ¿Seguro?": "帳號與所有進度將永久刪除，確定繼續？",
  "Cambiar opciones (": "重新抽選（",
  "Pausa: {x} elige fusión…": "暫停：{x} 正在選擇融合…",
  "Pausa: {x} eligen fusión…": "暫停：{x} 正在選擇融合…",
  "Cuenta borrada": "帳號已刪除",
  "Borrar para siempre": "永久刪除",
  "Se borrarán tu cuenta y toda tu partida, para siempre. Para confirmarlo, escribe tu contraseña.": "帳號與所有進度將永久刪除。請輸入密碼以確認。",
  "Escribe tu contraseña.": "請輸入密碼。",
  "Inicia sesión para poder borrar tu cuenta.": "請先登入才能刪除帳號。",
  "Versión {x}": "版本 {x}",
  "Juego de fans": "同人遊戲",
  "gratuito y sin ánimo de lucro": "免費且非營利",
  "Juego de fans {x}: sin anuncios ni pagos. Pokémon y sus personajes son propiedad de Nintendo, Creatures y GAME FREAK; este proyecto no está afiliado a ellos.": "同人遊戲，{x}，無廣告或付費內容。寶可夢及其角色由 Nintendo、Creatures 與 GAME FREAK 擁有，本專案與上述公司無關。",
  ": sin anuncios ni pagos. Pokémon y sus personajes son propiedad de Nintendo, Creatures y GAME FREAK; este proyecto no está afiliado a ellos.": "，無廣告或付費內容。寶可夢及其角色由 Nintendo、Creatures 與 GAME FREAK 擁有，本專案與上述公司無關。",
  "Créditos": "製作名單",
  "Sprites:": "精靈圖：",
  "PMD SpriteCollab y sus artistas (CC BY-NC 4.0).": "PMD SpriteCollab 與參與創作者（CC BY-NC 4.0）。",
  "Datos de los Pokémon:": "寶可夢資料：",
  "Música y sonidos:": "音樂與音效：",
  "originales, generados por el propio juego.": "原創，由遊戲本身產生。",
  "Fuente:": "字型：",
  "Guía y preguntas": "指南與常見問題",
  "Pokédex": "寶可夢圖鑑",
  "Contacto": "聯絡",
  "Código (GitHub)": "原始碼（GitHub）",
  "Gira el móvil": "請旋轉手機",
  "PokéSurvivor se juega en horizontal.": "PokéSurvivor 需以橫向模式遊玩。",
  "No se pudo cargar todo el juego (¿se cortó la conexión?).": "無法完整載入遊戲，請檢查連線。",
  "Recargar": "重新載入",
  "Proyecto de fan": "同人專案",
  "es un juego hecho por fans,": "是由粉絲製作的遊戲，",
  ". No tiene anuncios, ni compras, ni ninguna forma de ingreso, y no la tendrá.": "。沒有廣告、內購或任何收益來源，未來也不會有。",
  "No está afiliado, patrocinado ni aprobado por Nintendo, Creatures Inc., GAME FREAK ni The Pokémon Company. Pokémon y todos los nombres y personajes relacionados son marcas y propiedad de sus respectivos dueños.": "本作未獲 Nintendo、Creatures Inc.、GAME FREAK 或 The Pokémon Company 贊助或認可，亦與其無關。寶可夢及相關名稱、角色與商標均屬各自權利人所有。",
  "Contenido de terceros": "第三方內容",
  "Sprites de": "精靈圖來自",
  "(CC BY-NC 4.0, créditos completos en CREDITS.md del repositorio). Datos de la Pokédex de": "（CC BY-NC 4.0，完整名單見原始碼中的 CREDITS.md）。圖鑑資料來自",
  ". Fuente Pixelify Sans (OFL). La música y los efectos de sonido son originales del proyecto.": "。Pixelify Sans 字型（OFL）。音樂與音效為本專案原創。",
  "Contacto y retirada de contenido": "聯絡與內容移除",
  "Si eres titular de derechos y quieres que retiremos algo, escríbenos y lo quitaremos lo antes posible:": "若你是權利人且希望移除內容，請來信，我們會儘速處理：",
  "Código fuente:": "原始碼：",
  "Privacidad": "隱私權",
  "Si creas una cuenta, guardamos tu nombre de jugador y tu partida (colección, monedas, mejoras y estadísticas) en Google Firebase para que puedas seguir en cualquier ordenador. Si entras con Google, Firebase guarda también tu correo de Google para identificarte (nunca se enseña a otros jugadores). No usamos tus datos para nada más, ni los compartimos, ni hay publicidad ni seguimiento.\nComo invitado no se guarda nada fuera de tu navegador.": "建立帳號後，玩家名稱與進度（收藏、金幣、強化與統計）會儲存在 Google Firebase，以便在不同電腦繼續遊玩。使用 Google 登入時，Firebase 也會儲存電子郵件以識別身分，但不會向其他玩家公開。資料不會用於其他用途或分享，沒有廣告或追蹤。訪客資料不會儲存至瀏覽器以外的地方。",
  "Amigos y ranking: tu": "好友與排行榜：你的",
  "es público para otros jugadores. Guardamos tu lista de amigos, si estás en línea y tus mejores tiempos (con tu apodo y tu Pokémon).": "會向其他玩家公開。我們會儲存好友清單、上線狀態與最佳時間（包含暱稱及寶可夢）。",
  "Partidas en grupo: tu navegador se conecta": "多人遊戲：你的瀏覽器會直接連線",
  "con el de tus compañeros (como en una videollamada), así que cada uno puede llegar a ver la dirección IP del otro. Juega en grupo sólo con gente que conozcas. Si la conexión directa no es posible, la partida pasa por los servidores de Firebase.": "至隊友的瀏覽器（類似視訊通話），因此彼此可能看見對方的 IP 位址。請只與認識的人組隊；無法直接連線時，會透過 Firebase 伺服器連線。",
  "Puedes borrar tu cuenta cuando quieras (se borran también tu apodo, tus amigos y tus marcas):": "你可隨時刪除帳號，暱稱、好友與紀錄也會一併刪除：",
  "Borrar mi cuenta y mi partida": "刪除我的帳號與存檔",
  "PokéSurvivor necesita JavaScript para funcionar. Actívalo para jugar.": "PokéSurvivor 需要 JavaScript，請啟用後再遊玩。",
  "Fan game gratuito de supervivencia con 966 Pokémon de las 9 regiones: elige tu compañero, sobrevive a las hordas, evoluciona tus ataques, enfréntate a legendarios y juega en cooperativo con hasta 4 amigos.": "免費生存同人遊戲，收錄 9 個地區的 966 隻寶可夢。選擇夥伴、抵擋敵潮、進化招式、挑戰傳說寶可夢，並支援最多 4 人合作。",
  "Guía del juego": "遊戲指南",
  "Apoyar": "支持",
  "Apoyar el proyecto": "支持本專案",
  "Donar en Ko-fi": "在 Ko-fi 贊助",
  "Más información": "更多資訊",
  "PokéSurvivor es y será": "PokéSurvivor 現在與未來都會",
  "gratis": "免費",
  ", sin anuncios ni compras. Si quieres ayudar a que siga en línea, puedes hacer una": "，沒有廣告或內購。如果想協助維持服務，你可以",
  "donación voluntaria": "自願贊助",
  ": todo el dinero se usa para los": "：所有款項僅用於",
  "servidores y el dominio": "伺服器與網域",
  ", nada más.": "，沒有其他用途。",
  "Donar no da ninguna ventaja en el juego.": "贊助不會獲得任何遊戲優勢。",
  "Lo que cuesta mantenerlo": "維持服務的費用",
  "Servidores (partidas, cuentas, ranking y multijugador)": "伺服器（存檔、帳號、排行榜與多人遊戲）",
  "Según cuánta gente juegue": "依玩家人數而定",
  "Dominio pokesurvivor.com": "pokesurvivor.com 網域",
  "≈12 € al año": "每年約 12 歐元",
  "Cuanta más gente juega, más cuestan los servidores. Lo que sobre se guarda para los gastos de los meses siguientes.": "玩家越多，伺服器費用越高。剩餘款項會保留作為未來月份的費用。",
  "Juego de fans {x}: sin anuncios ni compras. Pokémon y sus personajes son propiedad de Nintendo, Creatures y GAME FREAK; este proyecto no está afiliado a ellos.": "同人遊戲，{x}，無廣告或內購。寶可夢及其角色由 Nintendo、Creatures 與 GAME FREAK 擁有，本專案與上述公司無關。",
  ": sin anuncios ni compras. Pokémon y sus personajes son propiedad de Nintendo, Creatures y GAME FREAK; este proyecto no está afiliado a ellos.": "，無廣告或內購。寶可夢及其角色由 Nintendo、Creatures 與 GAME FREAK 擁有，本專案與上述公司無關。",
  ". No tiene anuncios ni compras. Se puede apoyar con donaciones voluntarias, que se usan sólo para pagar los servidores y el dominio, y que no dan ninguna ventaja en el juego.": "。沒有廣告或內購，可自願贊助；款項僅用於伺服器與網域費用，不會帶來任何遊戲優勢。",
  "Compañero": "夥伴",
  "tickets y": "抽獎券與",
  "directamente": "直接",
  "Tienes": "你擁有",
  "Movimientos que puede aprender": "可學會的招式",
  "Juego de fans {x} — sin anuncios ni pagos.": "同人遊戲，{x}，無廣告或付費內容。",
  "Pokédex: todos los Pokémon jugables": "寶可夢圖鑑：所有可遊玩的寶可夢",
  "¡SE HA ABIERTO UNA GRIETA!": "裂隙開啟了！",
  "Sigue la flecha morada: dentro te espera un legendario": "跟隨紫色箭頭，裡面有傳說寶可夢等著你",
  "GRIETA · {x} m · {x} s": "裂隙 · {x} 公尺 · {x} 秒",
  "GRIETA · {x} s": "裂隙 · {x} 秒",
  "¡{x} se ha enfurecido!": "{x} 暴怒了！",
  "Pulsa para empezar": "點擊開始",
  "Sobrevive a las hordas con tu compañero Pokémon": "與寶可夢夥伴一起抵擋敵潮",
  "Esta partida no cuenta para el ranking: se ha detectado algo raro": "偵測到異常，本局不計入排行榜",
  "Cruzas como un rayo hacia el enemigo y golpeas todo el camino.": "閃電般衝向敵人，攻擊沿途所有目標。",
  "Chorro de llamas en abanico corto que quema.": "短距離扇形火焰，使敵人灼傷。",
  "Dos hojas que van y vuelven cortando a la ida y a la vuelta.": "兩片葉子來回飛行，去回都能斬擊敵人。",
  "Un rayo que salta de un enemigo a otro.": "在敵人之間跳躍的電光。",
  "Vas dejando charcos de veneno que intoxican a quien los pisa.": "沿路留下毒池，使踩到的敵人陷入劇毒。",
  "Deja telarañas en el suelo que atrapan y frenan mucho al que las pisa.": "在地上留下蛛網，困住敵人並大幅減速。",
  "Caen rocas del cielo sobre los enemigos cercanos.": "岩石從天而降，砸向附近的敵人。",
  "Un hueso que va y vuelve golpeando fuerte.": "來回飛行的骨頭，造成強力打擊。",
  "Cuchillas psíquicas que vuelven a ti.": "飛出後會返回的精神利刃。",
  "Siembra púas que estallan al pisarlas.": "撒下踩踏後會爆炸的尖刺。",
  "Púas venenosas que envenenan mucho al estallar.": "爆炸時使敵人陷入劇毒的毒刺。",
  "Bolas de hielo caen sobre los enemigos y los frenan.": "冰雹落在敵人身上並使其減速。",
  "Dos meteoros de acero que aplastan donde caen.": "兩顆鋼鐵流星，重擊落點範圍。",
  "Deja una llama flotante que dispara sola y quema.": "留下會自動射擊的浮空火焰，使敵人灼傷。",
  "Un muñeco que se queda disparando por ti.": "留下替身，持續代替你射擊。",
  "Te lanzas en picado y cortas todo lo que cruzas.": "俯衝並斬擊沿途所有敵人。",
  "Corres envuelto en fuego y dejas un rastro de llamas.": "全身包覆火焰向前衝刺，留下火焰軌跡。",
  "Chorro de burbujas en abanico corto que frena.": "短距離扇形泡泡，使敵人減速。",
  "Maldición que salta entre enemigos. Mucho más daño si están quemados, envenenados o frenados.": "在敵人之間跳躍的詛咒，對灼傷、中毒或減速的敵人造成更多傷害。",
  "+1 bumerán": "迴旋鏢 +1",
  "+30% alcance": "射程 +30%",
  "+1 bumerán y +40% daño": "迴旋鏢 +1、傷害 +40%",
  "+2 saltos": "跳躍次數 +2",
  "+2 saltos y +40% daño": "跳躍次數 +2、傷害 +40%",
  "+1 mina": "地雷 +1",
  "+30% radio de explosión": "爆炸半徑 +30%",
  "+1 mina y -25% recarga": "地雷 +1、冷卻時間 -25%",
  "+1 meteoro": "流星 +1",
  "+2 meteoros y -20% recarga": "流星 +2、冷卻時間 -20%",
  "Dispara un 35% más rápido": "射速提高 35%",
  "+1 a la vez": "同時存在數量 +1",
  "+50% duración y +40% daño": "持續時間 +50%、傷害 +40%",
  "+30% distancia": "距離 +30%",
  "+60% daño y más ancho": "傷害 +60%，寬度增加",
  "+40% duración": "持續時間 +40%",
  "Charcos un 30% más grandes": "毒池範圍增加 30%",
  "+50% daño y +30% radio": "傷害 +50%、半徑 +30%",
  "+3 disparos": "射擊數 +3",
  "+3 disparos y +1 perforación": "射擊數 +3、貫穿 +1",
  "×1,8 daño, +1 bumerán y más alcance": "傷害 ×1.8、迴旋鏢 +1、射程增加",
  "×1,7 daño y +3 saltos": "傷害 ×1.7、跳躍次數 +3",
  "×1,8 daño, +2 minas y explosión más grande": "傷害 ×1.8、地雷 +2、爆炸範圍增加",
  "×1,7 daño, +2 meteoros y más radio": "傷害 ×1.7、流星 +2、半徑增加",
  "×1,8 daño, +1 a la vez y dispara más rápido": "傷害 ×1.8、同時存在數量 +1、射速提高",
  "×1,9 daño, más distancia y menos recarga": "傷害 ×1.9、距離增加、冷卻時間縮短",
  "×1,8 daño, charcos más grandes y duraderos": "傷害 ×1.8、毒池範圍與持續時間增加",
  "×1,7 daño, +4 disparos y +1 perforación": "傷害 ×1.7、射擊數 +4、貫穿 +1",
  "¡Horda de tipo {x}!": "{x}系敵潮來襲！",
  "¡Hora dorada! Doble de experiencia": "黃金時刻！經驗值加倍",
  "¡Un {x} se ha perdido! Búscalo y llévalo a la marca": "一隻 {x} 迷路了！找到牠並帶往標記處",
  "¡{x} te sigue! Llévalo a la marca verde": "{x} 正跟著你！帶牠前往綠色標記",
  "¡{x} se ha asustado y ha huido…!": "{x} 受到驚嚇，逃走了…！",
  "{x} se ha cansado de esperar y se ha ido…": "{x} 等得不耐煩，離開了…",
  "¡Has llevado a {x} a casa! Te lo agradece": "你把 {x} 送回家了！牠很感謝你",
  "¡{x} se une a tu equipo!": "{x} 加入了你的隊伍！",
  "¡{x} te da las gracias! (+150 monedas, ya lo tenías)": "{x} 感謝你！（已擁有，獲得 150 金幣）",
  "¡Un {x} con un ticket ×10! ¡Atrápalo antes de que huya!": "一隻 {x} 帶著十連抽獎券！快在牠逃走前抓住牠！",
  "¡Un {x} cargado de monedas! ¡Atrápalo antes de que huya!": "一隻 {x} 帶著大量金幣！快在牠逃走前抓住牠！",
  "¡{x} se ha escapado!": "{x} 逃走了！",
  "HORA DORADA · {x} s": "黃金時刻 · {x} 秒",
  "HORDA {x} · {x} s": "{x} 敵潮 · {x} 秒",
  "Marca · {x} m": "標記 · {x} 公尺",
  "¿Te está gustando PokéSurvivor? Lo hago yo solo y los servidores cuestan dinero. Si quieres, puedes ayudarme a mantenerlo en línea.": "喜歡 PokéSurvivor 嗎？原作者獨力開發這款遊戲，伺服器需要費用。如果願意，你可以協助維持線上服務。",
  "Apoyar en Ko-fi": "在 Ko-fi 支持",
  "Entrar con Google (si ya tienes cuenta)": "使用 Google 登入（已有帳號）",
  "Este mes se han llenado las plazas de cuentas nuevas: vuelven el 1 de {x}. Si ya tienes cuenta, entra normal. Si no, juega como invitado.": "本月新帳號名額已滿，將於 {x} 月 1 日重新開放。已有帳號可照常登入，其他玩家可先以訪客遊玩。",
  "Este mes ya no quedan plazas para cuentas nuevas (vuelven el 1 de {x}). Mientras, puedes jugar como invitado.": "本月已無新帳號名額，將於 {x} 月 1 日重新開放。這段期間可先以訪客遊玩。",
  "Bulbasaur": "妙蛙種子",
  "Ivysaur": "妙蛙草",
  "Venusaur": "妙蛙花",
  "Charmander": "小火龍",
  "Charmeleon": "火恐龍",
  "Charizard": "噴火龍",
  "Squirtle": "傑尼龜",
  "Wartortle": "卡咪龜",
  "Blastoise": "水箭龜",
  "Caterpie": "綠毛蟲",
  "Metapod": "鐵甲蛹",
  "Butterfree": "巴大蝶",
  "Weedle": "獨角蟲",
  "Kakuna": "鐵殼蛹",
  "Beedrill": "大針蜂",
  "Pidgey": "波波",
  "Pidgeotto": "比比鳥",
  "Pidgeot": "大比鳥",
  "Rattata": "小拉達",
  "Raticate": "拉達",
  "Spearow": "烈雀",
  "Fearow": "大嘴雀",
  "Ekans": "阿柏蛇",
  "Arbok": "阿柏怪",
  "Pikachu": "皮卡丘",
  "Raichu": "雷丘",
  "Sandshrew": "穿山鼠",
  "Sandslash": "穿山王",
  "Nidoran♀": "尼多蘭",
  "Nidorina": "尼多娜",
  "Nidoqueen": "尼多后",
  "Nidoran♂": "尼多朗",
  "Nidorino": "尼多力諾",
  "Nidoking": "尼多王",
  "Clefairy": "皮皮",
  "Clefable": "皮可西",
  "Vulpix": "六尾",
  "Ninetales": "九尾",
  "Jigglypuff": "胖丁",
  "Wigglytuff": "胖可丁",
  "Zubat": "超音蝠",
  "Golbat": "大嘴蝠",
  "Oddish": "走路草",
  "Gloom": "臭臭花",
  "Vileplume": "霸王花",
  "Paras": "派拉斯",
  "Parasect": "派拉斯特",
  "Venonat": "毛球",
  "Venomoth": "摩魯蛾",
  "Diglett": "地鼠",
  "Dugtrio": "三地鼠",
  "Meowth": "喵喵",
  "Persian": "貓老大",
  "Psyduck": "可達鴨",
  "Golduck": "哥達鴨",
  "Mankey": "猴怪",
  "Primeape": "火爆猴",
  "Growlithe": "卡蒂狗",
  "Arcanine": "風速狗",
  "Poliwag": "蚊香蝌蚪",
  "Poliwhirl": "蚊香君",
  "Poliwrath": "蚊香泳士",
  "Abra": "凱西",
  "Kadabra": "勇基拉",
  "Alakazam": "胡地",
  "Machop": "腕力",
  "Machoke": "豪力",
  "Machamp": "怪力",
  "Bellsprout": "喇叭芽",
  "Weepinbell": "口呆花",
  "Victreebel": "大食花",
  "Tentacool": "瑪瑙水母",
  "Tentacruel": "毒刺水母",
  "Geodude": "小拳石",
  "Graveler": "隆隆石",
  "Golem": "隆隆岩",
  "Ponyta": "小火馬",
  "Rapidash": "烈焰馬",
  "Slowpoke": "呆呆獸",
  "Slowbro": "呆殼獸",
  "Magnemite": "小磁怪",
  "Magneton": "三合一磁怪",
  "Farfetch’d": "大蔥鴨",
  "Doduo": "嘟嘟",
  "Dodrio": "嘟嘟利",
  "Seel": "小海獅",
  "Dewgong": "白海獅",
  "Grimer": "臭泥",
  "Muk": "臭臭泥",
  "Shellder": "大舌貝",
  "Cloyster": "刺甲貝",
  "Gastly": "鬼斯",
  "Haunter": "鬼斯通",
  "Gengar": "耿鬼",
  "Onix": "大岩蛇",
  "Drowzee": "催眠貘",
  "Hypno": "引夢貘人",
  "Krabby": "大鉗蟹",
  "Kingler": "巨鉗蟹",
  "Voltorb": "霹靂電球",
  "Electrode": "頑皮雷彈",
  "Exeggcute": "蛋蛋",
  "Exeggutor": "椰蛋樹",
  "Cubone": "卡拉卡拉",
  "Marowak": "嘎啦嘎啦",
  "Hitmonlee": "飛腿郎",
  "Hitmonchan": "快拳郎",
  "Lickitung": "大舌頭",
  "Koffing": "瓦斯彈",
  "Weezing": "雙彈瓦斯",
  "Rhyhorn": "獨角犀牛",
  "Rhydon": "鑽角犀獸",
  "Chansey": "吉利蛋",
  "Tangela": "蔓藤怪",
  "Kangaskhan": "袋獸",
  "Horsea": "墨海馬",
  "Seadra": "海刺龍",
  "Goldeen": "角金魚",
  "Seaking": "金魚王",
  "Staryu": "海星星",
  "Starmie": "寶石海星",
  "Mr. Mime": "魔牆人偶",
  "Scyther": "飛天螳螂",
  "Jynx": "迷唇姐",
  "Electabuzz": "電擊獸",
  "Magmar": "鴨嘴火獸",
  "Pinsir": "凱羅斯",
  "Tauros": "肯泰羅",
  "Magikarp": "鯉魚王",
  "Gyarados": "暴鯉龍",
  "Lapras": "拉普拉斯",
  "Ditto": "百變怪",
  "Eevee": "伊布",
  "Vaporeon": "水伊布",
  "Jolteon": "雷伊布",
  "Flareon": "火伊布",
  "Porygon": "多邊獸",
  "Omanyte": "菊石獸",
  "Omastar": "多刺菊石獸",
  "Kabuto": "化石盔",
  "Kabutops": "鐮刀盔",
  "Aerodactyl": "化石翼龍",
  "Snorlax": "卡比獸",
  "Articuno": "急凍鳥",
  "Zapdos": "閃電鳥",
  "Moltres": "火焰鳥",
  "Dratini": "迷你龍",
  "Dragonair": "哈克龍",
  "Dragonite": "快龍",
  "Mewtwo": "超夢",
  "Mew": "夢幻",
  "Chikorita": "菊草葉",
  "Bayleef": "月桂葉",
  "Meganium": "大竺葵",
  "Cyndaquil": "火球鼠",
  "Quilava": "火岩鼠",
  "Typhlosion": "火爆獸",
  "Totodile": "小鋸鱷",
  "Croconaw": "藍鱷",
  "Feraligatr": "大力鱷",
  "Sentret": "尾立",
  "Furret": "大尾立",
  "Hoothoot": "咕咕",
  "Noctowl": "貓頭夜鷹",
  "Ledyba": "芭瓢蟲",
  "Ledian": "安瓢蟲",
  "Spinarak": "圓絲蛛",
  "Ariados": "阿利多斯",
  "Crobat": "叉字蝠",
  "Chinchou": "燈籠魚",
  "Lanturn": "電燈怪",
  "Pichu": "皮丘",
  "Cleffa": "皮寶寶",
  "Igglybuff": "寶寶丁",
  "Togepi": "波克比",
  "Togetic": "波克基古",
  "Natu": "天然雀",
  "Xatu": "天然鳥",
  "Mareep": "咩利羊",
  "Flaaffy": "茸茸羊",
  "Ampharos": "電龍",
  "Bellossom": "美麗花",
  "Marill": "瑪力露",
  "Azumarill": "瑪力露麗",
  "Sudowoodo": "樹才怪",
  "Politoed": "蚊香蛙皇",
  "Hoppip": "毽子草",
  "Skiploom": "毽子花",
  "Jumpluff": "毽子棉",
  "Aipom": "長尾怪手",
  "Sunkern": "向日種子",
  "Sunflora": "向日花怪",
  "Yanma": "蜻蜻蜓",
  "Wooper": "烏波",
  "Quagsire": "沼王",
  "Espeon": "太陽伊布",
  "Umbreon": "月亮伊布",
  "Murkrow": "黑暗鴉",
  "Slowking": "呆呆王",
  "Misdreavus": "夢妖",
  "Unown": "未知圖騰",
  "Wobbuffet": "果然翁",
  "Girafarig": "麒麟奇",
  "Pineco": "榛果球",
  "Forretress": "佛烈托斯",
  "Dunsparce": "土龍弟弟",
  "Gligar": "天蠍",
  "Steelix": "大鋼蛇",
  "Snubbull": "布魯",
  "Granbull": "布魯皇",
  "Qwilfish": "千針魚",
  "Scizor": "巨鉗螳螂",
  "Shuckle": "壺壺",
  "Heracross": "赫拉克羅斯",
  "Sneasel": "狃拉",
  "Teddiursa": "熊寶寶",
  "Ursaring": "圈圈熊",
  "Slugma": "熔岩蟲",
  "Magcargo": "熔岩蝸牛",
  "Swinub": "小山豬",
  "Piloswine": "長毛豬",
  "Corsola": "太陽珊瑚",
  "Remoraid": "鐵炮魚",
  "Octillery": "章魚桶",
  "Delibird": "信使鳥",
  "Mantine": "巨翅飛魚",
  "Skarmory": "盔甲鳥",
  "Houndour": "戴魯比",
  "Houndoom": "黑魯加",
  "Kingdra": "刺龍王",
  "Phanpy": "小小象",
  "Donphan": "頓甲",
  "Porygon2": "多邊獸Ⅱ",
  "Stantler": "驚角鹿",
  "Smeargle": "圖圖犬",
  "Tyrogue": "無畏小子",
  "Hitmontop": "戰舞郎",
  "Smoochum": "迷唇娃",
  "Elekid": "電擊怪",
  "Magby": "鴨嘴寶寶",
  "Miltank": "大奶罐",
  "Blissey": "幸福蛋",
  "Raikou": "雷公",
  "Entei": "炎帝",
  "Suicune": "水君",
  "Larvitar": "幼基拉斯",
  "Pupitar": "沙基拉斯",
  "Tyranitar": "班基拉斯",
  "Lugia": "洛奇亞",
  "Ho-Oh": "鳳王",
  "Celebi": "時拉比",
  "Treecko": "木守宮",
  "Grovyle": "森林蜥蜴",
  "Sceptile": "蜥蜴王",
  "Torchic": "火稚雞",
  "Combusken": "力壯雞",
  "Blaziken": "火焰雞",
  "Mudkip": "水躍魚",
  "Marshtomp": "沼躍魚",
  "Swampert": "巨沼怪",
  "Poochyena": "土狼犬",
  "Mightyena": "大狼犬",
  "Zigzagoon": "蛇紋熊",
  "Linoone": "直衝熊",
  "Wurmple": "刺尾蟲",
  "Silcoon": "甲殼繭",
  "Beautifly": "狩獵鳳蝶",
  "Cascoon": "盾甲繭",
  "Dustox": "毒粉蛾",
  "Lotad": "蓮葉童子",
  "Lombre": "蓮帽小童",
  "Ludicolo": "樂天河童",
  "Seedot": "橡實果",
  "Nuzleaf": "長鼻葉",
  "Shiftry": "狡猾天狗",
  "Taillow": "傲骨燕",
  "Swellow": "大王燕",
  "Wingull": "長翅鷗",
  "Pelipper": "大嘴鷗",
  "Ralts": "拉魯拉絲",
  "Kirlia": "奇魯莉安",
  "Gardevoir": "沙奈朵",
  "Surskit": "溜溜糖球",
  "Masquerain": "雨翅蛾",
  "Shroomish": "蘑蘑菇",
  "Breloom": "斗笠菇",
  "Slakoth": "懶人獺",
  "Vigoroth": "過動猿",
  "Slaking": "請假王",
  "Nincada": "土居忍士",
  "Ninjask": "鐵面忍者",
  "Shedinja": "脫殼忍者",
  "Whismur": "咕妞妞",
  "Loudred": "吼爆彈",
  "Exploud": "爆音怪",
  "Makuhita": "幕下力士",
  "Hariyama": "鐵掌力士",
  "Azurill": "露力麗",
  "Nosepass": "朝北鼻",
  "Skitty": "向尾喵",
  "Delcatty": "優雅貓",
  "Sableye": "勾魂眼",
  "Mawile": "大嘴娃",
  "Aron": "可可多拉",
  "Lairon": "可多拉",
  "Aggron": "波士可多拉",
  "Meditite": "瑪沙那",
  "Medicham": "恰雷姆",
  "Electrike": "落雷獸",
  "Manectric": "雷電獸",
  "Plusle": "正電拍拍",
  "Minun": "負電拍拍",
  "Volbeat": "電螢蟲",
  "Illumise": "甜甜螢",
  "Roselia": "毒薔薇",
  "Gulpin": "溶食獸",
  "Swalot": "吞食獸",
  "Carvanha": "利牙魚",
  "Sharpedo": "巨牙鯊",
  "Wailmer": "吼吼鯨",
  "Wailord": "吼鯨王",
  "Numel": "呆火駝",
  "Camerupt": "噴火駝",
  "Torkoal": "煤炭龜",
  "Spoink": "跳跳豬",
  "Grumpig": "噗噗豬",
  "Spinda": "晃晃斑",
  "Trapinch": "大顎蟻",
  "Vibrava": "超音波幼蟲",
  "Flygon": "沙漠蜻蜓",
  "Cacnea": "刺球仙人掌",
  "Cacturne": "夢歌仙人掌",
  "Swablu": "青綿鳥",
  "Altaria": "七夕青鳥",
  "Zangoose": "貓鼬斬",
  "Seviper": "飯匙蛇",
  "Lunatone": "月石",
  "Solrock": "太陽岩",
  "Barboach": "泥泥鰍",
  "Whiscash": "鯰魚王",
  "Corphish": "龍蝦小兵",
  "Crawdaunt": "鐵螯龍蝦",
  "Baltoy": "天秤偶",
  "Claydol": "念力土偶",
  "Lileep": "觸手百合",
  "Cradily": "搖籃百合",
  "Anorith": "太古羽蟲",
  "Armaldo": "太古盔甲",
  "Feebas": "醜醜魚",
  "Milotic": "美納斯",
  "Castform": "飄浮泡泡",
  "Kecleon": "變隱龍",
  "Shuppet": "怨影娃娃",
  "Banette": "詛咒娃娃",
  "Duskull": "夜巡靈",
  "Dusclops": "彷徨夜靈",
  "Tropius": "熱帶龍",
  "Chimecho": "風鈴鈴",
  "Absol": "阿勃梭魯",
  "Wynaut": "小果然",
  "Snorunt": "雪童子",
  "Glalie": "冰鬼護",
  "Spheal": "海豹球",
  "Sealeo": "海魔獅",
  "Walrein": "帝牙海獅",
  "Clamperl": "珍珠貝",
  "Huntail": "獵斑魚",
  "Gorebyss": "櫻花魚",
  "Relicanth": "古空棘魚",
  "Luvdisc": "愛心魚",
  "Bagon": "寶貝龍",
  "Shelgon": "甲殼龍",
  "Salamence": "暴飛龍",
  "Beldum": "鐵啞鈴",
  "Metang": "金屬怪",
  "Metagross": "巨金怪",
  "Regirock": "雷吉洛克",
  "Regice": "雷吉艾斯",
  "Registeel": "雷吉斯奇魯",
  "Latias": "拉帝亞斯",
  "Latios": "拉帝歐斯",
  "Kyogre": "蓋歐卡",
  "Groudon": "固拉多",
  "Rayquaza": "烈空坐",
  "Jirachi": "基拉祈",
  "Deoxys": "代歐奇希斯",
  "Turtwig": "草苗龜",
  "Grotle": "樹林龜",
  "Torterra": "土台龜",
  "Chimchar": "小火焰猴",
  "Monferno": "猛火猴",
  "Infernape": "烈焰猴",
  "Piplup": "波加曼",
  "Prinplup": "波皇子",
  "Empoleon": "帝王拿波",
  "Starly": "姆克兒",
  "Staravia": "姆克鳥",
  "Staraptor": "姆克鷹",
  "Bidoof": "大牙狸",
  "Bibarel": "大尾狸",
  "Kricketot": "圓法師",
  "Kricketune": "音箱蟀",
  "Shinx": "小貓怪",
  "Luxio": "勒克貓",
  "Luxray": "倫琴貓",
  "Budew": "含羞苞",
  "Roserade": "羅絲雷朵",
  "Cranidos": "頭蓋龍",
  "Rampardos": "戰槌龍",
  "Shieldon": "盾甲龍",
  "Bastiodon": "護城龍",
  "Burmy": "結草兒",
  "Wormadam": "結草貴婦",
  "Mothim": "紳士蛾",
  "Combee": "三蜜蜂",
  "Vespiquen": "蜂女王",
  "Pachirisu": "帕奇利茲",
  "Buizel": "泳圈鼬",
  "Floatzel": "浮潛鼬",
  "Cherubi": "櫻花寶",
  "Cherrim": "櫻花兒",
  "Shellos": "無殼海兔",
  "Gastrodon": "海兔獸",
  "Ambipom": "雙尾怪手",
  "Drifloon": "飄飄球",
  "Drifblim": "隨風球",
  "Buneary": "捲捲耳",
  "Lopunny": "長耳兔",
  "Mismagius": "夢妖魔",
  "Honchkrow": "烏鴉頭頭",
  "Glameow": "魅力喵",
  "Purugly": "東施喵",
  "Chingling": "鈴鐺響",
  "Stunky": "臭鼬噗",
  "Skuntank": "坦克臭鼬",
  "Bronzor": "銅鏡怪",
  "Bronzong": "青銅鐘",
  "Bonsly": "盆才怪",
  "Mime Jr.": "魔尼尼",
  "Happiny": "小福蛋",
  "Chatot": "聒噪鳥",
  "Spiritomb": "花岩怪",
  "Gible": "圓陸鯊",
  "Gabite": "尖牙陸鯊",
  "Garchomp": "烈咬陸鯊",
  "Munchlax": "小卡比獸",
  "Riolu": "利歐路",
  "Lucario": "路卡利歐",
  "Hippopotas": "沙河馬",
  "Hippowdon": "河馬獸",
  "Skorupi": "鉗尾蠍",
  "Drapion": "龍王蠍",
  "Croagunk": "不良蛙",
  "Toxicroak": "毒骷蛙",
  "Carnivine": "尖牙籠",
  "Finneon": "螢光魚",
  "Lumineon": "霓虹魚",
  "Mantyke": "小球飛魚",
  "Snover": "雪笠怪",
  "Abomasnow": "暴雪王",
  "Weavile": "瑪狃拉",
  "Magnezone": "自爆磁怪",
  "Lickilicky": "大舌舔",
  "Rhyperior": "超甲狂犀",
  "Tangrowth": "巨蔓藤",
  "Electivire": "電擊魔獸",
  "Magmortar": "鴨嘴炎獸",
  "Togekiss": "波克基斯",
  "Yanmega": "遠古巨蜓",
  "Leafeon": "葉伊布",
  "Glaceon": "冰伊布",
  "Gliscor": "天蠍王",
  "Mamoswine": "象牙豬",
  "Porygon-Z": "多邊獸Ｚ",
  "Gallade": "艾路雷朵",
  "Probopass": "大朝北鼻",
  "Dusknoir": "黑夜魔靈",
  "Froslass": "雪妖女",
  "Rotom": "洛托姆",
  "Uxie": "由克希",
  "Mesprit": "艾姆利多",
  "Azelf": "亞克諾姆",
  "Dialga": "帝牙盧卡",
  "Palkia": "帕路奇亞",
  "Heatran": "席多藍恩",
  "Regigigas": "雷吉奇卡斯",
  "Giratina": "騎拉帝納",
  "Cresselia": "克雷色利亞",
  "Phione": "霏歐納",
  "Manaphy": "瑪納霏",
  "Darkrai": "達克萊伊",
  "Shaymin": "謝米",
  "Arceus": "阿爾宙斯",
  "Victini": "比克提尼",
  "Snivy": "藤藤蛇",
  "Servine": "青藤蛇",
  "Serperior": "君主蛇",
  "Tepig": "暖暖豬",
  "Pignite": "炒炒豬",
  "Emboar": "炎武王",
  "Oshawott": "水水獺",
  "Dewott": "雙刃丸",
  "Samurott": "大劍鬼",
  "Patrat": "探探鼠",
  "Watchog": "步哨鼠",
  "Lillipup": "小約克",
  "Herdier": "哈約克",
  "Stoutland": "長毛狗",
  "Purrloin": "扒手貓",
  "Liepard": "酷豹",
  "Pansage": "花椰猴",
  "Simisage": "花椰猿",
  "Pansear": "爆香猴",
  "Panpour": "冷水猴",
  "Munna": "食夢夢",
  "Musharna": "夢夢蝕",
  "Pidove": "豆豆鴿",
  "Unfezant": "高傲雉雞",
  "Roggenrola": "石丸子",
  "Boldore": "地幔岩",
  "Gigalith": "龐岩怪",
  "Woobat": "滾滾蝙蝠",
  "Swoobat": "心蝙蝠",
  "Drilbur": "螺釘地鼠",
  "Excadrill": "龍頭地鼠",
  "Audino": "差不多娃娃",
  "Timburr": "搬運小匠",
  "Gurdurr": "鐵骨土人",
  "Conkeldurr": "修建老匠",
  "Tympole": "圓蝌蚪",
  "Palpitoad": "藍蟾蜍",
  "Seismitoad": "蟾蜍王",
  "Sawk": "打擊鬼",
  "Sewaddle": "蟲寶包",
  "Swadloon": "寶包繭",
  "Leavanny": "保母蟲",
  "Venipede": "百足蜈蚣",
  "Whirlipede": "車輪毬",
  "Scolipede": "蜈蚣王",
  "Cottonee": "木棉球",
  "Whimsicott": "風妖精",
  "Petilil": "百合根娃娃",
  "Lilligant": "裙兒小姐",
  "Basculin": "野蠻鱸魚",
  "Sandile": "黑眼鱷",
  "Krokorok": "混混鱷",
  "Krookodile": "流氓鱷",
  "Darumaka": "火紅不倒翁",
  "Darmanitan": "達摩狒狒",
  "Maractus": "沙鈴仙人掌",
  "Dwebble": "石居蟹",
  "Scraggy": "滑滑小子",
  "Scrafty": "頭巾混混",
  "Sigilyph": "象徵鳥",
  "Yamask": "哭哭面具",
  "Cofagrigus": "死神棺",
  "Archen": "始祖小鳥",
  "Archeops": "始祖大鳥",
  "Trubbish": "破破袋",
  "Garbodor": "灰塵山",
  "Zorua": "索羅亞",
  "Zoroark": "索羅亞克",
  "Minccino": "泡沫栗鼠",
  "Cinccino": "奇諾栗鼠",
  "Gothita": "哥德寶寶",
  "Gothorita": "哥德小童",
  "Gothitelle": "哥德小姐",
  "Solosis": "單卵細胞球",
  "Duosion": "雙卵細胞球",
  "Reuniclus": "人造細胞卵",
  "Ducklett": "鴨寶寶",
  "Swanna": "舞天鵝",
  "Vanillite": "迷你冰",
  "Vanillish": "多多冰",
  "Vanilluxe": "雙倍多多冰",
  "Deerling": "四季鹿",
  "Sawsbuck": "萌芽鹿",
  "Emolga": "電飛鼠",
  "Karrablast": "蓋蓋蟲",
  "Escavalier": "騎士蝸牛",
  "Foongus": "哎呀球菇",
  "Alomomola": "保母曼波",
  "Joltik": "電電蟲",
  "Galvantula": "電蜘蛛",
  "Ferroseed": "種子鐵球",
  "Ferrothorn": "堅果啞鈴",
  "Klink": "齒輪兒",
  "Klang": "齒輪組",
  "Klinklang": "齒輪怪",
  "Tynamo": "麻麻小魚",
  "Eelektrik": "麻麻鰻",
  "Eelektross": "麻麻鰻魚王",
  "Elgyem": "小灰怪",
  "Beheeyem": "大宇怪",
  "Litwick": "燭光靈",
  "Lampent": "燈火幽靈",
  "Chandelure": "水晶燈火靈",
  "Axew": "牙牙",
  "Fraxure": "斧牙龍",
  "Haxorus": "雙斧戰龍",
  "Cubchoo": "噴嚏熊",
  "Beartic": "凍原熊",
  "Cryogonal": "幾何雪花",
  "Accelgor": "敏捷蟲",
  "Mienfoo": "功夫鼬",
  "Mienshao": "師父鼬",
  "Druddigon": "赤面龍",
  "Golett": "泥偶小人",
  "Golurk": "泥偶巨人",
  "Pawniard": "駒刀小兵",
  "Bisharp": "劈斬司令",
  "Rufflet": "毛頭小鷹",
  "Braviary": "勇士雄鷹",
  "Vullaby": "禿鷹丫頭",
  "Mandibuzz": "禿鷹娜",
  "Heatmor": "熔蟻獸",
  "Durant": "鐵蟻",
  "Deino": "單首龍",
  "Zweilous": "雙首暴龍",
  "Hydreigon": "三首惡龍",
  "Larvesta": "燃燒蟲",
  "Volcarona": "火神蛾",
  "Cobalion": "勾帕路翁",
  "Terrakion": "代拉基翁",
  "Virizion": "畢力吉翁",
  "Tornadus": "龍捲雲",
  "Thundurus": "雷電雲",
  "Reshiram": "萊希拉姆",
  "Zekrom": "捷克羅姆",
  "Landorus": "土地雲",
  "Kyurem": "酋雷姆",
  "Keldeo": "凱路迪歐",
  "Meloetta": "美洛耶塔",
  "Genesect": "蓋諾賽克特",
  "Chespin": "哈力栗",
  "Quilladin": "胖胖哈力",
  "Chesnaught": "布里卡隆",
  "Fennekin": "火狐狸",
  "Braixen": "長尾火狐",
  "Delphox": "妖火紅狐",
  "Froakie": "呱呱泡蛙",
  "Frogadier": "呱頭蛙",
  "Greninja": "甲賀忍蛙",
  "Bunnelby": "掘掘兔",
  "Diggersby": "掘地兔",
  "Fletchling": "小箭雀",
  "Fletchinder": "火箭雀",
  "Talonflame": "烈箭鷹",
  "Scatterbug": "粉蝶蟲",
  "Spewpa": "粉蝶蛹",
  "Vivillon": "彩粉蝶",
  "Litleo": "小獅獅",
  "Flabébé": "花蓓蓓",
  "Floette": "花葉蒂",
  "Florges": "花潔夫人",
  "Skiddo": "坐騎小羊",
  "Gogoat": "坐騎山羊",
  "Pancham": "頑皮熊貓",
  "Pangoro": "流氓熊貓",
  "Furfrou": "多麗米亞",
  "Espurr": "妙喵",
  "Meowstic": "超能妙喵",
  "Honedge": "獨劍鞘",
  "Doublade": "雙劍鞘",
  "Aegislash": "堅盾劍怪",
  "Spritzee": "粉香香",
  "Swirlix": "綿綿泡芙",
  "Slurpuff": "胖甜妮",
  "Inkay": "好啦魷",
  "Malamar": "烏賊王",
  "Binacle": "龜腳腳",
  "Barbaracle": "龜足巨鎧",
  "Skrelp": "垃垃藻",
  "Dragalge": "毒藻龍",
  "Clauncher": "鐵臂槍蝦",
  "Clawitzer": "鋼炮臂蝦",
  "Helioptile": "傘電蜥",
  "Heliolisk": "光電傘蜥",
  "Tyrunt": "寶寶暴龍",
  "Tyrantrum": "怪顎龍",
  "Amaura": "冰雪龍",
  "Aurorus": "冰雪巨龍",
  "Sylveon": "仙子伊布",
  "Hawlucha": "摔角鷹人",
  "Dedenne": "咚咚鼠",
  "Carbink": "小碎鑽",
  "Goomy": "黏黏寶",
  "Sliggoo": "黏美兒",
  "Goodra": "黏美龍",
  "Klefki": "鑰圈兒",
  "Phantump": "小木靈",
  "Trevenant": "朽木妖",
  "Pumpkaboo": "南瓜精",
  "Gourgeist": "南瓜怪人",
  "Bergmite": "冰寶",
  "Avalugg": "冰岩怪",
  "Noibat": "嗡蝠",
  "Noivern": "音波龍",
  "Xerneas": "哲爾尼亞斯",
  "Yveltal": "伊裴爾塔爾",
  "Zygarde": "基格爾德",
  "Diancie": "蒂安希",
  "Hoopa": "胡帕",
  "Volcanion": "波爾凱尼恩",
  "Rowlet": "木木梟",
  "Dartrix": "投羽梟",
  "Decidueye": "狙射樹梟",
  "Litten": "火斑喵",
  "Torracat": "炎熱喵",
  "Incineroar": "熾焰咆哮虎",
  "Popplio": "球球海獅",
  "Brionne": "花漾海獅",
  "Primarina": "西獅海壬",
  "Pikipek": "小篤兒",
  "Yungoos": "貓鼬少",
  "Grubbin": "強顎雞母蟲",
  "Charjabug": "蟲電寶",
  "Vikavolt": "鍬農炮蟲",
  "Crabrawler": "好勝蟹",
  "Crabominable": "好勝毛蟹",
  "Oricorio": "花舞鳥",
  "Cutiefly": "萌虻",
  "Ribombee": "蝶結萌虻",
  "Rockruff": "岩狗狗",
  "Lycanroc": "鬃岩狼人",
  "Wishiwashi": "弱丁魚",
  "Mareanie": "好壞星",
  "Toxapex": "超壞星",
  "Mudbray": "泥驢仔",
  "Mudsdale": "重泥挽馬",
  "Dewpider": "滴蛛",
  "Araquanid": "滴蛛霸",
  "Fomantis": "偽螳草",
  "Lurantis": "蘭螳花",
  "Morelull": "睡睡菇",
  "Salandit": "夜盜火蜥",
  "Salazzle": "焰后蜥",
  "Stufful": "童偶熊",
  "Bewear": "穿著熊",
  "Bounsweet": "甜竹竹",
  "Steenee": "甜舞妮",
  "Tsareena": "甜冷美后",
  "Comfey": "花療環環",
  "Passimian": "投擲猴",
  "Wimpod": "膽小蟲",
  "Golisopod": "具甲武者",
  "Sandygast": "沙丘娃",
  "Palossand": "噬沙堡爺",
  "Pyukumuku": "拳海參",
  "Silvally": "銀伴戰獸",
  "Minior": "小隕星",
  "Komala": "樹枕尾熊",
  "Turtonator": "爆焰龜獸",
  "Togedemaru": "托戈德瑪爾",
  "Mimikyu": "謎擬Ｑ",
  "Bruxish": "磨牙彩皮魚",
  "Drampa": "老翁龍",
  "Dhelmise": "破破舵輪",
  "Jangmo-o": "心鱗寶",
  "Hakamo-o": "鱗甲龍",
  "Kommo-o": "杖尾鱗甲龍",
  "Tapu Koko": "卡璞・鳴鳴",
  "Tapu Lele": "卡璞・蝶蝶",
  "Tapu Bulu": "卡璞・哞哞",
  "Tapu Fini": "卡璞・鰭鰭",
  "Cosmog": "科斯莫古",
  "Cosmoem": "科斯莫姆",
  "Solgaleo": "索爾迦雷歐",
  "Lunala": "露奈雅拉",
  "Nihilego": "虛吾伊德",
  "Buzzwole": "爆肌蚊",
  "Pheromosa": "費洛美螂",
  "Xurkitree": "電束木",
  "Celesteela": "鐵火輝夜",
  "Kartana": "紙御劍",
  "Guzzlord": "惡食大王",
  "Necrozma": "奈克洛茲瑪",
  "Magearna": "瑪機雅娜",
  "Marshadow": "瑪夏多",
  "Poipole": "毒貝比",
  "Naganadel": "四顎針龍",
  "Stakataka": "壘磊石",
  "Blacephalon": "砰頭小丑",
  "Zeraora": "捷拉奧拉",
  "Meltan": "美錄坦",
  "Melmetal": "美錄梅塔",
  "Grookey": "敲音猴",
  "Thwackey": "啪咚猴",
  "Rillaboom": "轟擂金剛猩",
  "Scorbunny": "炎兔兒",
  "Raboot": "騰蹴小將",
  "Cinderace": "閃焰王牌",
  "Sobble": "淚眼蜥",
  "Drizzile": "變澀蜥",
  "Inteleon": "千面避役",
  "Skwovet": "貪心栗鼠",
  "Greedent": "藏飽栗鼠",
  "Rookidee": "稚山雀",
  "Corvisquire": "藍鴉",
  "Corviknight": "鋼鎧鴉",
  "Blipbug": "索偵蟲",
  "Dottler": "天罩蟲",
  "Orbeetle": "以歐路普",
  "Nickit": "偷兒狐",
  "Thievul": "狐大盜",
  "Gossifleur": "幼棉棉",
  "Eldegoss": "白蓬蓬",
  "Wooloo": "毛辮羊",
  "Dubwool": "毛毛角羊",
  "Chewtle": "咬咬龜",
  "Drednaw": "暴噬龜",
  "Yamper": "來電汪",
  "Boltund": "逐電犬",
  "Applin": "啃果蟲",
  "Flapple": "蘋裹龍",
  "Appletun": "豐蜜龍",
  "Silicobra": "沙包蛇",
  "Sandaconda": "沙螺蟒",
  "Cramorant": "古月鳥",
  "Arrokuda": "刺梭魚",
  "Barraskewda": "戽斗尖梭",
  "Toxel": "毒電嬰",
  "Toxtricity": "顫弦蠑螈",
  "Sizzlipede": "燒火蚣",
  "Centiskorch": "焚焰蚣",
  "Clobbopus": "拳拳蛸",
  "Grapploct": "八爪武師",
  "Sinistea": "來悲茶",
  "Polteageist": "怖思壺",
  "Hatenna": "迷布莉姆",
  "Hattrem": "提布莉姆",
  "Hatterene": "布莉姆溫",
  "Impidimp": "搗蛋小妖",
  "Morgrem": "詐唬魔",
  "Grimmsnarl": "長毛巨魔",
  "Obstagoon": "堵攔熊",
  "Perrserker": "喵頭目",
  "Cursola": "魔靈珊瑚",
  "Runerigus": "死神板",
  "Milcery": "小仙奶",
  "Alcremie": "霜奶仙",
  "Pincurchin": "啪嚓海膽",
  "Snom": "雪吞蟲",
  "Frosmoth": "雪絨蛾",
  "Stonjourner": "巨石丁",
  "Eiscue": "冰砌鵝",
  "Indeedee": "愛管侍",
  "Morpeko": "莫魯貝可",
  "Dracozolt": "雷鳥龍",
  "Arctozolt": "雷鳥海獸",
  "Dracovish": "鰓魚龍",
  "Arctovish": "鰓魚海獸",
  "Duraludon": "鋁鋼龍",
  "Dreepy": "多龍梅西亞",
  "Drakloak": "多龍奇",
  "Dragapult": "多龍巴魯托",
  "Zacian": "蒼響",
  "Zamazenta": "藏瑪然特",
  "Eternatus": "無極汰那",
  "Kubfu": "熊徒弟",
  "Urshifu": "武道熊師",
  "Regieleki": "雷吉艾勒奇",
  "Regidrago": "雷吉鐸拉戈",
  "Glastrier": "雪暴馬",
  "Spectrier": "靈幽馬",
  "Calyrex": "蕾冠王",
  "Wyrdeer": "詭角鹿",
  "Kleavor": "劈斧螳螂",
  "Ursaluna": "月月熊",
  "Basculegion": "幽尾玄魚",
  "Sneasler": "大狃拉",
  "Overqwil": "萬針魚",
  "Enamorus": "眷戀雲",
  "Sprigatito": "新葉喵",
  "Floragato": "蒂蕾喵",
  "Meowscarada": "魔幻假面喵",
  "Fuecoco": "呆火鱷",
  "Crocalor": "炙燙鱷",
  "Skeledirge": "骨紋巨聲鱷",
  "Quaxly": "潤水鴨",
  "Quaxwell": "湧躍鴨",
  "Quaquaval": "狂歡浪舞鴨",
  "Lechonk": "愛吃豚",
  "Oinkologne": "飄香豚",
  "Tarountula": "團珠蛛",
  "Spidops": "操陷蛛",
  "Nymble": "豆蟋蟀",
  "Lokix": "烈腿蝗",
  "Pawmi": "布撥",
  "Pawmo": "布土撥",
  "Pawmot": "巴布土撥",
  "Tandemaus": "一對鼠",
  "Maushold": "一家鼠",
  "Fidough": "狗仔包",
  "Dachsbun": "麻花犬",
  "Smoliv": "迷你芙",
  "Arboliva": "奧利瓦",
  "Nacli": "鹽石寶",
  "Naclstack": "鹽石壘",
  "Garganacl": "鹽石巨靈",
  "Charcadet": "炭小侍",
  "Armarouge": "紅蓮鎧騎",
  "Ceruledge": "蒼炎刃鬼",
  "Tadbulb": "光蚪仔",
  "Bellibolt": "電肚蛙",
  "Wattrel": "電海燕",
  "Kilowattrel": "大電海燕",
  "Bramblin": "納噬草",
  "Capsakid": "熱辣娃",
  "Scovillain": "狠辣椒",
  "Rellor": "蟲滾泥",
  "Flittle": "飄飄雛",
  "Tinkatink": "小鍛匠",
  "Tinkatuff": "巧鍛匠",
  "Tinkaton": "巨鍛匠",
  "Wiglett": "海地鼠",
  "Wugtrio": "三海地鼠",
  "Finizen": "波普海豚",
  "Palafin": "海豚俠",
  "Varoom": "噗隆隆",
  "Revavroom": "普隆隆姆",
  "Cyclizar": "摩托蜥",
  "Orthworm": "拖拖蚓",
  "Glimmet": "晶光芽",
  "Glimmora": "晶光花",
  "Greavard": "墓仔狗",
  "Houndstone": "墓揚犬",
  "Cetoddle": "走鯨",
  "Cetitan": "浩大鯨",
  "Veluza": "輕身鱈",
  "Dondozo": "吃吼霸",
  "Tatsugiri": "米立龍",
  "Annihilape": "棄世猴",
  "Clodsire": "土王",
  "Farigiraf": "奇麒麟",
  "Dudunsparce": "土龍節節",
  "Kingambit": "仆刀將軍",
  "Colmilargo": "雄偉牙",
  "Colagrito": "吼叫尾",
  "Melenaleteo": "振翼髮",
  "Reptalada": "爬地翅",
  "Pelarena": "沙鐵皮",
  "Ferrosaco": "鐵包袱",
  "Ferropalmas": "鐵臂膀",
  "Ferropolilla": "鐵毒蛾",
  "Ferropúas": "鐵荊棘",
  "Frigibax": "涼脊龍",
  "Arctibax": "凍脊龍",
  "Baxcalibur": "戟脊龍",
  "Gholdengo": "賽富豪",
  "Chi-Yu": "古玉魚",
  "Bramaluna": "轟鳴月",
  "Ferropaladín": "鐵武者",
  "Koraidon": "故勒頓",
  "Ondulagua": "波盪水",
  "Ferroverdor": "鐵斑葉",
  "Dipplin": "裹蜜蟲",
  "Poltchageist": "斯魔茶",
  "Sinistcha": "來悲粗茶",
  "Munkidori": "願增猿",
  "Fezandipiti": "吉雉雞",
  "Ogerpon": "厄鬼椪",
  "Archaludon": "鋁鋼橋龍",
  "Hydrapple": "蜜集大蛇",
  "Terapagos": "太樂巴戈斯",
  "Kanto": "關都",
  "Johto": "城都",
  "Hoenn": "豐緣",
  "Sinnoh": "神奧",
  "Unova": "合眾",
  "Kalos": "卡洛斯",
  "Alola": "阿羅拉",
  "Galar": "伽勒爾",
  "Paldea": "帕底亞",
  "Solo": "單人",
  "Shiny": "閃光",
  "shiny": "閃光",
  "shinies": "閃光寶可夢",
  "HP": "體力",
  "ATQ": "攻擊",
  "VEL": "速度",
  "DEF": "防禦",
  "XP": "經驗",
  "MAX": "已滿",
  "PS": "體力",
  "Buscar…": "搜尋…",
  "Buscar Pokémon…": "搜尋寶可夢…",
  "PokéSurvivor – Juego Pokémon gratis online estilo Survivor.io": "PokéSurvivor — 繁體中文版",
  "Los {x} Pokémon de la generación {x}. ¡Los legendarios te esperan!": "共 {x} 隻第 {x} 世代寶可夢。傳說寶可夢等著你！",
  "valiente": "勇敢",
  "impulsivo": "衝動",
  "prudente": "謹慎",
  "leal": "忠誠",
  "paciente": "有耐心",
  "dulce": "溫柔",
  "tímido": "害羞",
  "travieso": "頑皮",
  "sereno": "冷靜",
  "astuto": "機靈",
  "alegre": "開朗",
  "tenaz": "堅毅",
  "orgulloso": "自信",
  "solitario": "獨立",
  "tranquilo": "悠閒",
  "caótico": "難以捉摸",
  "Tienes su shiny": "已擁有閃光版本",
  "Aún no estás en el top 50 {x} {x}. Tu puesto exacto está en Histórico.": "尚未進入 {x} {x} 的前 50 名。可在歷史紀錄查看確切排名。",
  "con": "使用",
  "Nº": "編號",
  "Vida máx.": "最大體力",
  "Daño": "傷害",
  "Recarga": "冷卻時間",
  "Experiencia": "經驗值",
  "enero": "1",
  "febrero": "2",
  "marzo": "3",
  "abril": "4",
  "mayo": "5",
  "junio": "6",
  "julio": "7",
  "agosto": "8",
  "septiembre": "9",
  "octubre": "10",
  "noviembre": "11",
  "diciembre": "12",
  "Impulsivo": "衝動",
  "Prudente": "謹慎",
  "Leal": "忠誠",
  "Paciente": "有耐心",
  "Dulce": "溫柔",
  "Tímido": "害羞",
  "Travieso": "頑皮",
  "Sereno": "冷靜",
  "Astuto": "機靈",
  "Alegre": "開朗",
  "Tenaz": "堅毅",
  "Orgulloso": "自信",
  "Solitario": "獨立",
  "Tranquilo": "悠閒",
  "Caótico": "難以捉摸",
  "Con": "使用",
  "Enero": "1",
  "Febrero": "2",
  "Marzo": "3",
  "Abril": "4",
  "Mayo": "5",
  "Junio": "6",
  "Julio": "7",
  "Agosto": "8",
  "Septiembre": "9",
  "Octubre": "10",
  "Noviembre": "11",
  "Diciembre": "12",
  "Nv.{x}": "等級 {x}",
  "Nv. {x}": "等級 {x}",
  "Nº {x}": "編號 {x}",
  "{x} h {x} min": "{x} 小時 {x} 分鐘",
  "{x} min": "{x} 分鐘",
  "{x} d {x} h": "{x} 天 {x} 小時",
  "o": "或",
  "ataque ·": "招式 ·",
  "Steel": "鋼",
  "Water": "水",
  "Bug": "蟲",
  "Dragon": "龍",
  "Electric": "電",
  "Ghost": "幽靈",
  "Fire": "火",
  "Fairy": "妖精",
  "Ice": "冰",
  "Fighting": "格鬥",
  "Grass": "草",
  "Psychic": "超能力",
  "Rock": "岩石",
  "Dark": "惡",
  "Ground": "地面",
  "Poison": "毒",
  "Flying": "飛行",
  "Ember": "火花",
  "Flamethrower": "噴射火焰",
  "Fire Spin": "火焰旋渦",
  "Heat Wave": "熱風",
  "Fire Blast": "大字爆炎",
  "Overheat": "過熱",
  "Sacred Fire": "神聖之火",
  "Eruption": "噴火",
  "Water Gun": "水槍",
  "Bubble": "泡沫",
  "Hydro Pump": "水炮",
  "Scald": "熱水",
  "Hydro Cannon": "加農水炮",
  "Aqua Ring": "水流環",
  "Vine Whip": "藤鞭",
  "Razor Leaf": "飛葉快刀",
  "Petal Blizzard": "落英繽紛",
  "Giga Drain": "終極吸取",
  "Grass Knot": "打草結",
  "Power Whip": "強力鞭打",
  "Leaf Storm": "飛葉風暴",
  "Petal Dance": "花瓣舞",
  "Frenzy Plant": "瘋狂植物",
  "Thunder Shock": "電擊",
  "Discharge": "放電",
  "Thunderbolt": "十萬伏特",
  "Thunder": "打雷",
  "Electric Terrain": "電氣場地",
  "Zap Cannon": "電磁炮",
  "Confusion": "念力",
  "Psybeam": "幻象光線",
  "Psyshock": "精神衝擊",
  "Future Sight": "預知未來",
  "Expanding Force": "廣域戰力",
  "Sludge": "污泥攻擊",
  "Poison Sting": "毒針",
  "Toxic": "劇毒",
  "Sludge Bomb": "污泥炸彈",
  "Poison Jab": "毒擊",
  "Poison Gas": "毒瓦斯",
  "Mud Shot": "泥巴射擊",
  "Bulldoze": "重踏",
  "Earth Power": "大地之力",
  "Earthquake": "地震",
  "Gust": "起風",
  "Wing Attack": "翅膀攻擊",
  "Hurricane": "暴風",
  "Brave Bird": "勇鳥猛攻",
  "Bug Bite": "蟲咬",
  "String Shot": "吐絲",
  "Bug Buzz": "蟲鳴",
  "X-Scissor": "十字剪",
  "Sticky Web": "黏黏網",
  "Swarm": "蟲之預感",
  "Rock Throw": "落石",
  "Rock Slide": "岩崩",
  "Stone Edge": "尖石攻擊",
  "Stealth Rock": "隱形岩",
  "Ice Beam": "冰凍光束",
  "Powder Snow": "細雪",
  "Blizzard": "暴風雪",
  "Icy Wind": "冰凍之風",
  "Karate Chop": "空手劈",
  "Aura Sphere": "波導彈",
  "Close Combat": "近身戰",
  "Focus Blast": "真氣彈",
  "Lick": "舌舔",
  "Shadow Ball": "暗影球",
  "Night Shade": "黑夜魔影",
  "Shadow Punch": "暗影拳",
  "Phantom Force": "潛靈奇襲",
  "Nightmare": "惡夢",
  "Dragon Rage": "龍之怒",
  "Draco Meteor": "流星群",
  "Dragon Dance": "龍之舞",
  "Fairy Wind": "妖精之風",
  "Dazzling Gleam": "魔法閃耀",
  "Moonblast": "月亮之力",
  "Misty Terrain": "薄霧場地",
  "Metal Claw": "金屬爪",
  "Flash Cannon": "加農光炮",
  "Iron Head": "鐵頭",
  "Steel Beam": "鐵蹄光線",
  "Bite": "咬住",
  "Dark Pulse": "惡之波動",
  "Crunch": "咬碎",
  "Snarl": "大聲咆哮",
  "Tackle": "撞擊",
  "Quick Attack": "電光一閃",
  "Body Slam": "泰山壓頂",
  "Hyper Voice": "巨聲",
  "Take Down": "猛撞",
  "Extreme Speed": "神速",
  "Giga Impact": "終極衝擊",
  "Uproar": "吵鬧",
  "Swords Dance": "劍舞",
  "Agility": "高速移動",
  "Harden": "變硬",
  "A fan of three piercing leaves.": "扇形射出三片可貫穿敵人的葉片。",
  "A quick poisonous sting.": "快速刺擊，使敵人中毒。",
  "A wide wing sweep that pushes foes back.": "大範圍揮動翅膀，擊退敵人。",
  "A fireball at the nearest enemy.": "向最近的敵人發射火球。",
  "A magical breeze in every direction.": "向四面八方吹出魔法微風。",
  "A fan of bubbles that slows whatever they touch.": "扇形發射泡泡，使碰到的敵人減速。",
  "A permanent electric field around you.": "在周圍持續產生電場。",
  "A slow but devastating water blast.": "緩慢但威力驚人的水炮。",
  "A jet of fire that pierces everything in a straight line.": "直線噴火，貫穿沿途所有敵人。",
  "A piercing jet. Reliable at any range.": "可貫穿敵人的水柱，遠近皆宜。",
  "A quick bite that knocks foes back.": "快速咬擊，擊退敵人。",
  "A lightning-fast bolt that pierces several enemies.": "極快的電流，可貫穿多個敵人。",
  "A flash of light all around you.": "在周圍釋放閃光。",
  "Drains life from everything nearby and heals you with every hit.": "吸取附近敵人的生命，每次命中都能回復體力。",
  "Roots that snare and pound everything near you.": "用根部困住並重擊附近的敵人。",
  "Charges in an arc at everything in front of you.": "向前方弧形範圍衝撞。",
  "An energy sphere that never misses.": "必定命中的能量球。",
  "A shadowy orb that pierces several foes.": "可貫穿多個敵人的暗影球。",
  "A radial mental burst that seeks enemies.": "向周圍釋放追蹤敵人的精神衝擊。",
  "Explodes in flames in every direction.": "向四面八方爆發火焰。",
  "A sharp, powerful blow straight ahead.": "向正前方使出強力打擊。",
  "Sticky threads in every direction that slow foes a lot.": "向四周射出黏絲，大幅降低敵人速度。",
  "A ghostly lick that briefly paralyzes.": "幽靈般的舌舔，使敵人短暫麻痺。",
  "Long-range whips in a wide arc.": "遠距離、大範圍的弧形鞭擊。",
  "Draconic flames in a straight line.": "直線噴出龍之火焰。",
  "Flames that spin around you. Constant defense.": "火焰繞著自身旋轉，持續防禦。",
  "A rain of rocks all around you.": "在周圍降下岩石雨。",
  "Toxic sludge that poisons on impact.": "命中時使敵人中毒的毒污泥。",
  "A quick bite in a short arc.": "小範圍快速咬擊。",
  "Deals no damage: builds ATTACK faster than Swords Dance.": "不造成傷害：累積攻擊力的速度比劍舞更快。",
  "Deals no damage: builds ATTACK while active.": "不造成傷害：啟用時持續累積攻擊力。",
  "Deals no damage: builds DEFENSE while active.": "不造成傷害：啟用時持續累積防禦力。",
  "Deals no damage: builds health REGENERATION.": "不造成傷害：持續累積體力回復效果。",
  "Deals no damage: builds SPEED while active.": "不造成傷害：啟用時持續累積速度。",
  "A poisonous cloud around you that intoxicates.": "在周圍產生使敵人中毒的毒霧。",
  "A wave of dark energy in every direction.": "向四面八方釋放惡之能量波。",
  "A wave that homes in on its target.": "自動追蹤目標的波動。",
  "A sound wave that spreads in every direction.": "向四面八方擴散的聲波。",
  "A heavy boulder that pushes the enemy back.": "沉重的巨石，能擊退敵人。",
  "A full-weight tackle: slow, short and brutal.": "全力撞擊：緩慢、近距離，但威力強大。",
  "A fast, steady flurry. Low damage, high rate.": "快速連續射擊，傷害低但射速高。",
  "A piercing beam of metallic light.": "可貫穿敵人的金屬光束。",
  "An icy beam that almost freezes foes solid.": "幾乎能將敵人完全凍住的冰冷光束。",
  "A wide, heavy-hitting psychic beam.": "寬廣且強力的精神光束。",
  "Whirlwinds that escort you.": "旋風環繞身旁，為你護航。",
  "Shakes the ground: damages and slows everything nearby.": "震動地面，傷害附近敵人並使其減速。",
  "Splashes mud around and slows foes.": "向周圍潑灑泥漿，使敵人減速。",
  "A cyclone of leaves spins widely around you.": "葉片旋風在周圍大範圍旋轉。",
  "An instant bolt that pierces in a line.": "瞬間射出直線貫穿的電光。",
  "A shadow surrounds you and consumes what is near.": "暗影環繞自身，吞噬附近敵人。",
  "A blizzard around you that slows foes.": "周圍刮起暴風雪，使敵人減速。",
  "A constant vibration that pounds everything nearby.": "持續振動，重擊附近敵人。",
  "A steel swipe in an arc.": "弧形的鋼爪斬擊。",
  "+1 projectile": "投射物 +1",
  "+1 projectile and +1 pierce": "投射物 +1、貫穿 +1",
  "+45% damage": "傷害 +45%",
  "-25% cooldown": "冷卻時間 -25%",
  "+40% damage": "傷害 +40%",
  "+25% range": "射程 +25%",
  "Hits in 360° and +50% damage": "360° 全方位攻擊、傷害 +50%",
  "+30% range and width": "射程與寬度 +30%",
  "+50% damage": "傷害 +50%",
  "+1 orb": "光球 +1",
  "+55% damage": "傷害 +55%",
  "+25% radius and spins faster": "半徑 +25%，旋轉速度加快",
  "+1 orb and +55% damage": "光球 +1、傷害 +55%",
  "+4 projectiles": "投射物 +4",
  "+4 projectiles and +1 pierce": "投射物 +4、貫穿 +1",
  "+30% radius": "半徑 +30%",
  "+30% radius and +50% damage": "半徑 +30%、傷害 +50%",
  "+40% power": "威力 +40%",
  "+1 max stack": "疊加上限 +1",
  "+50% duration": "持續時間 +50%",
  "+1 stack and +40% power": "疊加 +1、威力 +40%",
  "Hits 40% more often": "攻擊頻率提高 40%",
  "×1.8 damage, +2 projectiles, +2 pierce and bigger": "傷害 ×1.8、投射物 +2、貫穿 +2，體積增大",
  "×1.9 damage, more range and hits in 360°": "傷害 ×1.9、射程增加、360° 全方位攻擊",
  "×1.8 damage, a 50% wider and longer beam": "傷害 ×1.8，光束寬度與長度增加 50%",
  "+2 orbs, ×1.7 damage and more radius": "光球 +2、傷害 ×1.7、半徑增加",
  "+6 projectiles, ×1.6 damage and +1 pierce": "投射物 +6、傷害 ×1.6、貫穿 +1",
  "×1.8 damage and 35% more radius": "傷害 ×1.8、半徑增加 35%",
  "Power": "威力",
  "Sprint": "衝刺",
  "Reflexes": "反應",
  "Armor": "護甲",
  "Synthesis": "光合作用",
  "Magnet": "磁鐵",
  "Learning": "學習",
  "EVOLUTION": "進化",
  "Evolves": "進化為",
  "Upgrade": "強化",
  "New · {x}": "新招式 · {x}",
  "Lv.": "等級",
  "+20 max HP (and heals it).": "最大體力 +20，並回復等量體力。",
  "+10% damage with every move.": "所有招式傷害 +10%。",
  "+7% movement speed.": "移動速度 +7%。",
  "-8% cooldown on every move.": "所有招式冷卻時間 -8%。",
  "+6% damage reduction.": "受到的傷害降低 6%。",
  "+0.9 HP regenerated per second.": "每秒回復 0.9 體力。",
  "+30% experience pickup radius.": "經驗值拾取半徑 +30%。",
  "+12% experience gained.": "獲得的經驗值 +12%。",
  "Sitrus Berry": "文柚果",
  "Restores 45% of your HP right now.": "立即回復 45% 體力。",
  "Level": "等級",
  "Level {x}!": "升到 {x} 級！",
  "Choose a reward ·": "選擇獎勵 ·",
  "Choose your card": "選擇卡牌",
  "Still choosing: {x}": "尚未選擇：{x}",
  "Waiting for {x}…": "正在等待 {x}…",
  "you": "你",
  "Leftovers": "吃剩的東西",
  "Choice Band": "講究頭帶",
  "Quick Claw": "先制之爪",
  "Focus Sash": "氣勢披帶",
  "Shell Bell": "貝殼之鈴",
  "Amulet Coin": "護符金幣",
  "Lucky Egg": "幸運蛋",
  "Life Orb": "生命寶珠",
  "Choice Scarf": "講究圍巾",
  "Rocky Helmet": "凸凸頭盔",
  "Assault Vest": "突擊背心",
  "You recover 1.5% of your HP per second.": "每秒回復 1.5% 體力。",
  "+40% damage, but you can't switch moves.": "傷害 +40%，但無法切換招式。",
  "-20% cooldown on all your moves.": "所有招式冷卻時間 -20%。",
  "A hit that would knock you out leaves you at 1 HP (every 60 s).": "受到致命一擊時保留 1 點體力（每 60 秒一次）。",
  "You heal from the damage you deal.": "依造成的傷害回復體力。",
  "+50% PokéCoins at the end of the run.": "本局結束時獲得的寶可幣 +50%。",
  "+30% experience.": "經驗值 +30%。",
  "+30% damage, but each attack costs a little HP.": "傷害 +30%，但每次攻擊會消耗少量體力。",
  "+35% speed.": "速度 +35%。",
  "Foes that hit you in melee take damage.": "以近身攻擊命中你的敵人會受到傷害。",
  "+20% damage reduction.": "受到的傷害降低 20%。",
  "An item!": "發現道具！",
  "You can only hold one ·": "只能攜帶一件 ·",
  "Keep": "保留",
  "Switch to": "換成",
  "You're holding {x}!": "你攜帶了 {x}！",
  "You already hold {x}": "你已經攜帶 {x}",
  "Focus Sash!": "氣勢披帶！",
  "Vitality": "生命力",
  "Strength": "力量",
  "Stride": "步伐",
  "Fortune": "幸運",
  "Wisdom": "智慧",
  "Repertoire": "招式庫",
  "+8 HP": "體力 +8",
  "+4% damage": "傷害 +4%",
  "+3% speed": "速度 +3%",
  "-3% cooldown": "冷卻時間 -3%",
  "+2% defense": "防禦 +2%",
  "+0.2 HP/s": "每秒回復 0.2 體力",
  "+12% pickup": "拾取範圍 +12%",
  "+8% PokéCoins": "寶可幣 +8%",
  "+5% experience": "經驗值 +5%",
  "Start with 2 moves": "開局擁有 2 個招式",
  "Max.": "已滿",
  "Each Pokémon has its own upgrades: they only count when you play with it.": "每隻寶可夢的強化獨立計算，只有使用該寶可夢時才會生效。",
  "(partner)": "（夥伴）",
  "{x} power! {x} for {x} s": "{x}之力！{x}，持續 {x} 秒",
  "Fury": "狂怒",
  "Haste": "迅捷",
  "damage ×2": "傷害 ×2",
  "+45% speed": "速度 +45%",
  "-40% cooldown": "冷卻時間 -40%",
  "you pull everything from afar": "從遠處吸引所有物品",
  "Sticky!": "黏住了！",
  "The spring has dried up (it refills on its own)": "泉水已乾涸（會自行補充）",
  "Rain": "下雨",
  "Harsh sunlight": "烈日",
  "Sandstorm": "沙暴",
  "Snowfall": "降雪",
  "Fog": "霧",
  "Water is boosted and Fire is weakened": "水系增強，火系減弱",
  "Fire is boosted and Water is weakened": "火系增強，水系減弱",
  "Rock, Ground and Steel are boosted; the rest suffer": "岩石、地面與鋼系增強，其他系受到傷害",
  "Ice is boosted; the rest suffer and slow down": "冰系增強，其他系受到傷害並減速",
  "Ghost, Fairy and Psychic are boosted": "幽靈、妖精與超能力系增強",
  "Eternal Meadow": "永恆草原",
  "Igneous Volcano": "熾焰火山",
  "Sea Grotto": "海濱洞窟",
  "Emerald Jungle": "翡翠叢林",
  "Volt Plant": "電力工廠",
  "Eternal Glacier": "永恆冰川",
  "Ancient Dojo": "遠古道場",
  "Toxic Swamp": "劇毒沼澤",
  "Red Desert": "赤紅沙漠",
  "Sky Peak": "蒼穹之巔",
  "Mind Temple": "心靈神殿",
  "Hive Forest": "蜂巢森林",
  "Ancient Quarry": "古老採石場",
  "Gloomy Graveyard": "幽暗墓園",
  "Dragon Sanctuary": "龍之聖域",
  "Dark Alley": "幽暗小巷",
  "Steel Fortress": "鋼鐵堡壘",
  "Enchanted Forest": "魔法森林",
  "Shady Forest": "陰影森林",
  "Crystal Cave": "水晶洞窟",
  "Ash Volcano": "灰燼火山",
  "Rift · {x}": "裂隙 · {x}",
  "Rift ·": "裂隙 ·",
  "RIFT ·": "裂隙 ·",
  "A wild {x} appeared!": "野生的 {x} 出現了！",
  "A wild shiny {x} appeared!": "野生的閃光 {x} 出現了！",
  "A shiny {x} is nearby!": "附近有閃光 {x}！",
  "Pokémon swarm!": "寶可夢大潮來襲！",
  "You got a shiny {x}!": "獲得了閃光 {x}！",
  "Another shiny {x}! (+300 coins)": "又一隻閃光 {x}！（+300 金幣）",
  "{x} was waiting in the rift!": "{x} 正在裂隙中等著你！",
  "A shiny {x} was waiting in the rift!": "閃光 {x} 正在裂隙中等著你！",
  "You defeated {x}! Grab your reward…": "你擊敗了 {x}！去領取獎勵吧…",
  "Cryptocurrencies": "加密貨幣",
  "PokéSurvivor has no official cryptocurrency, token or NFT, and its author has not created any. Any token using the game's name was created by third parties: we take no responsibility for any purchase, sale or investment you make with them, and nothing here is investment advice.": "PokéSurvivor 沒有任何官方加密貨幣、代幣或 NFT，作者也未發行過。使用遊戲名稱的代幣皆由第三方建立；我們不對任何相關買賣或投資負責，此處內容也不構成投資建議。",
  "Bond!": "羈絆！",
  "Bond": "羈絆",
  "Back": "返回",
  "Bonded moves fire at the same time and take a single slot": "連結的招式會同時施放，且只佔一個欄位",
  "Choose which move joins {x}": "選擇要與 {x} 連結的招式",
  "Which move do you bond {x} with?": "要將 {x} 與哪個招式連結？",
  "Choose the first move to bond": "選擇第一個要連結的招式",
  "It will fire at the same time as {x}. A slot is freed.": "會與 {x} 同時施放，並空出一個欄位。",
  "It will fire at the same time as {x}.": "會與 {x} 同時施放。",
  "Bond! {x} moves at once": "羈絆！同時施放 {x} 個招式",
  "Bond saved: learn another move to use it": "已保留羈絆：學會另一個招式後即可使用",
  "A mysterious rift has opened!": "神祕的裂隙開啟了！",
  "You entered the rift…": "你進入了裂隙…",
  "The rift threw you out…": "裂隙將你們彈了出來…",
  "{x} left the game": "{x} 離開了遊戲",
  "Ticket ×10!": "十連抽獎券！",
  "· ×{x} Fortune": "· 幸運 ×{x}",
  "You're down: a teammate can revive you": "你倒下了：隊友可以救起你",
  "Everyone is down…": "所有人都倒下了…",
  "{x} needs help! · {x} m": "{x} 需要救援！· {x} 公尺",
  "DOWN": "倒地",
  "Stay by their side": "待在隊友身旁",
  "Rift · {x} m · {x} s": "裂隙 · {x} 公尺 · {x} 秒",
  "DEFEATED ·": "擊敗 ·",
  "COINS": "金幣",
  "{x} · {x} DEFEATED · {x} COINS": "{x} · 擊敗 {x} · 金幣 {x}",
  "Drag your finger to move · tap a move to switch": "拖曳手指移動 · 點擊招式切換",
  "WASD move · 1-4 / Q / E or click a move to switch · Esc pause": "WASD 移動 · 1–4／Q／E 或點擊切換招式 · Esc 暫停",
  "The host has ended the game": "房主已結束遊戲",
  "Lost connection to the host.": "與房主的連線中斷。",
  "Pause": "暫停",
  "Continue": "繼續",
  "Quit run": "結束本局",
  "move ·": "移動 ·",
  "cycle ·": "切換 ·",
  "pause": "暫停",
  "Group game: the game keeps running while you're here.": "多人遊戲：開啟此畫面時，遊戲仍會繼續進行。",
  "You fell…": "你倒下了…",
  "Run over": "本局結束",
  "Back to menu": "返回選單",
  "Leave the game": "離開遊戲",
  "Time": "時間",
  "Defeated": "擊敗數",
  "Bosses": "首領",
  "PokéCoins earned": "獲得寶可幣",
  "Moves": "招式",
  "New time record!": "生存時間新紀錄！",
  "· new!": "· 新紀錄！",
  "{x} shinies caught": "捕獲 {x} 隻閃光寶可夢",
  "Gacha tickets": "扭蛋抽獎券",
  "Max level": "最高等級",
  "Mystery Dungeon": "不可思議的迷宮",
  "Log in": "登入",
  "Sign up": "註冊",
  "Name": "名稱",
  "Password": "密碼",
  "Sign in with Google": "使用 Google 登入",
  "Play as guest": "以訪客身分遊玩",
  "3-16 letters, numbers or _": "3～16 個英文字母、數字或底線",
  "Survive the hordes with your partner Pokémon · free, on PC and mobile": "與寶可夢夥伴抵擋敵潮 · 電腦與手機皆可免費遊玩",
  "A Pokémon survival game, free in your browser and on mobile.": "免費的寶可夢生存遊戲，可在瀏覽器與手機遊玩。",
  "Loading…": "載入中…",
  "Guide": "攻略",
  "Legal notice & privacy": "法律聲明與隱私權",
  "Your game is saved in the cloud: log in from any computer. Guest progress is not saved.": "遊戲進度儲存在雲端，可從任何電腦登入。訪客進度不會保留。",
  "Opened from a file: your game is only saved in this browser. To save in the cloud, play the online version.": "目前以檔案開啟，進度只會儲存在此瀏覽器。雲端存檔需使用線上版本。",
  "Couldn't connect to the cloud: your game is only saved in this browser.": "無法連線至雲端，進度只會儲存在此瀏覽器。",
  "Cloud not configured: your game is only saved in this browser.": "未設定雲端服務，進度只會儲存在此瀏覽器。",
  "This browser won't let us save data: play as a guest.": "瀏覽器不允許儲存資料，請以訪客身分遊玩。",
  "Wrong username or password.": "帳號名稱或密碼錯誤。",
  "That name is already taken.": "此名稱已被使用。",
  "The password must be at least 6 characters long.": "密碼至少需要 6 個字元。",
  "The password must be at least {x} characters long.": "密碼至少需要 {x} 個字元。",
  "The name must be 3-16 letters, numbers or _.": "名稱需為 3～16 個英文字母、數字或底線。",
  "Too many attempts in a row. Please wait a moment.": "嘗試次數過多，請稍候再試。",
  "No internet connection.": "沒有網路連線。",
  "The browser blocked the Google window. Please allow pop-ups.": "瀏覽器封鎖了 Google 登入視窗，請允許彈出式視窗。",
  "This domain is not authorized in Firebase (Authentication > Settings > Authorized domains).": "此網域尚未獲得 Firebase 授權（Authentication > Settings > Authorized domains）。",
  "Google sign-in needs the online version of the game.": "Google 登入需使用遊戲的線上版本。",
  "That sign-in method is not enabled in Firebase.": "Firebase 尚未啟用此登入方式。",
  "The database denied access (check the Firestore rules).": "資料庫拒絕存取，請檢查 Firestore 規則。",
  "No connection to the database.": "無法連線至資料庫。",
  "The browser won't let us save data (incognito mode?).": "瀏覽器不允許儲存資料，可能是無痕模式。",
  "For security, please log in again and repeat the action.": "為確保安全，請重新登入後再操作。",
  "There is no account to delete.": "沒有可刪除的帳號。",
  "Guest": "訪客",
  "Trainer": "訓練家",
  "Your personality is…": "你的性格是…",
  "Question {x} of {x}": "第 {x} 題，共 {x} 題",
  "Pick a Pokémon": "選擇寶可夢",
  "{x} joins you!": "{x} 加入了！",
  "Choose your partner": "選擇你的夥伴",
  "The starters from every region, plus two more friends.": "各地區的最初夥伴，以及另外兩位朋友。",
  "Choose": "選擇",
  "Choose another": "重新選擇",
  "Let's go together!": "一起出發吧！",
  "Your partner:": "你的夥伴：",
  "There's a fight in the middle of town! What do you do?": "有人在城鎮中央打架！你會怎麼做？",
  "I jump in to help without thinking.": "不加思索地上前幫忙。",
  "I look for someone who can stop it.": "尋找能阻止衝突的人。",
  "I watch everything from afar.": "在遠處觀察。",
  "I laugh and cheer both of them on.": "笑著替雙方加油。",
  "You find a wallet on the ground.": "你在地上撿到一個錢包。",
  "I take it to the police right away.": "馬上交給警察。",
  "I look for its owner even if it takes hours.": "就算花上幾個小時，也要找到失主。",
  "First I check what's inside…": "先看看裡面有什麼…",
  "I don't even touch it, just in case.": "為了保險起見，我不會碰它。",
  "You have an important exam tomorrow.": "明天有一場重要考試。",
  "I study until late at night.": "熬夜讀書。",
  "I review just enough: I trust myself.": "稍微複習就好，我相信自己。",
  "I get really stressed.": "我會非常緊張。",
  "Exam? I'll see tomorrow.": "考試？明天再說吧。",
  "Someone mocks you in front of everyone.": "有人當眾嘲笑你。",
  "I answer back on the spot.": "立刻回嘴。",
  "I hit back with a better joke.": "用更好笑的笑話反擊。",
  "I ignore them completely.": "完全不理會對方。",
  "It hurts, even if I don't say it.": "雖然不說出口，但我很受傷。",
  "What matters most to you?": "你最重視什麼？",
  "Being the best.": "成為最優秀的人。",
  "Friendship.": "友情。",
  "Freedom.": "自由。",
  "Calm.": "平靜。",
  "The path splits: one dark and short, the other long and sunny.": "前方有岔路：一條陰暗但較短，另一條較長且陽光充足。",
  "The dark one, more excitement!": "選陰暗的路，更刺激！",
  "The long one, no rush.": "走長路，不急。",
  "I sit down to think it over.": "坐下來好好想想。",
  "Neither: I make a new shortcut.": "都不選，自己開闢捷徑。",
  "What do your friends say about you?": "朋友怎麼形容你？",
  "That they can always count on me.": "總是值得信賴。",
  "That I'm the funniest one in the group.": "團體裡最有趣的人。",
  "That I'm a bit mysterious.": "有點神祕。",
  "That I never give up.": "永不放棄。",
  "Your ideal day off is…": "你理想中的假日是…",
  "Training to get better.": "鍛鍊自己，變得更強。",
  "Hanging out with all my friends.": "和所有朋友一起玩。",
  "An adventure with no plan at all.": "毫無計畫地去冒險。",
  "Reading, thinking, being calm.": "閱讀、思考，享受寧靜。",
  "You don't think twice when someone needs help.": "有人需要幫忙時，你總是毫不猶豫。",
  "Your friends know they can always count on you.": "朋友都知道，你永遠值得信賴。",
  "You measure every step before taking it.": "每一步行動前，你都會仔細思考。",
  "You spread energy wherever you go.": "你走到哪裡，就把活力帶到哪裡。",
  "You keep calm when things get complicated.": "遇到複雜的狀況，你依然保持冷靜。",
  "You act first and think later. Sometimes it works!": "你先行動再思考，有時效果還不錯！",
  "You push yourself to be the best, and you almost always are.": "你努力追求最好，而且幾乎總能做到。",
  "You always have a joke ready.": "你隨時都能講出笑話。",
  "You do your own thing and don't care.": "你做自己想做的事，不在意別人眼光。",
  "It's hard for you to take the first step, but you feel deeply.": "你不容易踏出第一步，但感情很深。",
  "Nothing fazes you. Nothing.": "沒有任何事能動搖你，真的。",
  "You know how to wait for the right moment.": "你善於等待最佳時機。",
  "Not even you know what you'll do next.": "連你自己都不知道下一步會做什麼。",
  "Giving up isn't in your plans.": "你的計畫裡沒有放棄。",
  "You see solutions where others see problems.": "別人看見難題，你看見解法。",
  "Your kindness calms everyone around you.": "你的溫柔讓身邊的人安心。",
  "Play": "開始遊戲",
  "Enter the dungeon": "進入迷宮",
  "Your collection": "你的收藏",
  "Upgrades": "強化",
  "Make every run stronger": "讓每一局都更強",
  "9 regions · Pokémon and shinies": "9 個地區 · 寶可夢與閃光寶可夢",
  "Missions": "任務",
  "Missions, achievements and profile": "任務、成就與個人檔案",
  "Friends": "好友",
  "Play in a group, up to 4": "最多 4 人一起遊玩",
  "Leaderboard": "排行榜",
  "Who survives longest": "誰能生存最久",
  "Settings": "設定",
  "Sound, graphics, controls and account": "音效、畫質、操作與帳號",
  "{x} reward to claim": "有 {x} 項獎勵可領取",
  "{x} rewards to claim": "有 {x} 項獎勵可領取",
  "reward to claim": "項獎勵可領取",
  "rewards to claim": "項獎勵可領取",
  "Back to your room ({x})": "返回你的房間（{x}）",
  "{x} online": "{x} 人在線上",
  "online": "在線上",
  "{x} request": "{x} 個邀請",
  "{x} requests": "{x} 個邀請",
  "· Best time": "· 最佳時間",
  "Best level": "最高等級",
  "· Defeated": "· 擊敗數",
  "Guest mode: not saved": "訪客模式：不會存檔",
  "Log out": "登出",
  "You're a guest: all your progress will be lost. Log out?": "你目前是訪客，登出將失去所有進度。確定登出？",
  "Non-profit fan project · Sprites: SpriteCollab (CC BY-NC 4.0) · Pokémon © Nintendo/Creatures/GAME FREAK ·": "非營利同人作品 · 精靈圖：SpriteCollab（CC BY-NC 4.0）· 寶可夢 © Nintendo／Creatures／GAME FREAK ·",
  "Legal notice": "法律聲明",
  "All": "全部",
  "Owned": "已擁有",
  "Missing": "未擁有",
  "Legendary": "傳說",
  "Epic": "史詩",
  "Rare": "稀有",
  "Uncommon": "少見",
  "Common": "普通",
  "None with this filter.": "沒有符合條件的寶可夢。",
  "Attack": "攻擊",
  "Speed": "速度",
  "Starts with": "初始招式",
  "It's your partner": "這是你的夥伴",
  "Choose as partner{x}": "選為夥伴{x}",
  "You don't have it yet.": "你尚未擁有這隻寶可夢。",
  "Get it from the banner of": "可從此地區的卡池獲得：",
  "or by defeating it when it shows up shiny.": "或在野外遇見其閃光版本並擊敗牠。",
  "{x} is now your partner": "{x} 成為你的夥伴了",
  "Shiny {x} is now your partner": "閃光 {x} 成為你的夥伴了",
  "{x} · {x}: level {x}": "{x} · {x}：等級 {x}",
  "Mystery": "神祕",
  "The {x} Pokémon of generation {x}. The legendaries await!": "共 {x} 隻第 {x} 世代寶可夢，傳說寶可夢等著你！",
  "You have {x} of {x}": "已擁有 {x}／{x}",
  "You have {x}": "你擁有 {x}",
  "Odds": "機率",
  "Pulls without a legendary in {x}: {x} / {x}": "{x} 卡池未抽中傳說的次數：{x}／{x}",
  "· After {x} pulls without a Legendary on a banner, the next one is.": "· 同一卡池連續 {x} 抽未獲得傳說寶可夢，下次必定獲得。",
  "· The ×10 pull guarantees at least one Epic.": "· 十連抽保證至少獲得一隻史詩寶可夢。",
  "Pull ×1 ·": "單抽 ·",
  "Pull ×10 ·": "十連抽 ·",
  "×10 tickets": "十連抽獎券",
  "tickets and {x}": "抽獎券與 {x}",
  "Not enough tickets: earn them by playing": "抽獎券不足，請透過遊玩獲得",
  "NEW!": "首次獲得！",
  "NEW SHINY!": "新閃光！",
  "Duplicate ·": "重複 ·",
  "Click to speed up": "點擊加速",
  "PULL": "抽獎",
  "PULL ×10": "十連抽",
  "GOOD LUCK!": "祝你好運！",
  "SHINY?!": "閃光？！",
  "LEGENDARY?!": "傳說？！",
  "EPIC?!": "史詩？！",
  "Achievements": "成就",
  "Profile": "個人檔案",
  "Daily": "冒險筆記",
  "Weekly": "本週",
  "Refreshes in {x}": "將於 {x} 後更新",
  "Claim": "領取",
  "Claimed": "已領取",
  "In progress": "進行中",
  "Swap": "更換",
  "Swap this mission for another (once a day)": "更換此任務（每日限一次）",
  "Reward claimed!": "已領取獎勵！",
  "Mission complete: {x}": "任務完成：{x}",
  "Claim your reward in Missions": "前往任務頁面領取獎勵",
  "Achievement: {x}!": "成就達成：{x}！",
  "New title: {x}": "新稱號：{x}",
  "Unlocked!": "已解鎖！",
  "{x} of {x} achievements · titles: {x}": "成就 {x}／{x} · 稱號：{x}",
  "Legendaries defeated {x} / {x}": "已擊敗傳說寶可夢 {x}／{x}",
  "· defeated!": "· 已擊敗！",
  "This is how other players see you (from the leaderboard and friends list).": "其他玩家會在排行榜與好友清單中看到這份個人檔案。",
  "Your 3 favorite Pokémon": "你最喜愛的 3 隻寶可夢",
  "Choose favorite {x}": "選擇第 {x} 隻最愛",
  "Title": "稱號",
  "Title: {x}": "稱號：{x}",
  "(no title)": "（無稱號）",
  "Unlock achievements to earn titles.": "解鎖成就以獲得稱號。",
  "View my public profile": "檢視我的公開個人檔案",
  "Your profile is published when you play with an online account.": "使用線上帳號遊玩時，會公開你的個人檔案。",
  "This player has no profile yet.": "這位玩家尚未建立個人檔案。",
  "No favorites yet.": "尚未設定最愛。",
  "No medals yet.": "尚未獲得獎章。",
  "Medals": "獎章",
  "Best time": "最佳時間",
  "In a group": "多人",
  "Legendaries": "傳說寶可夢",
  "Close": "關閉",
  "Defeat {x} Pokémon": "擊敗 {x} 隻寶可夢",
  "Defeat {x} {x}-type Pokémon": "擊敗 {x} 隻 {x}系寶可夢",
  "Defeat {x} bosses": "擊敗 {x} 隻首領",
  "Defeat a boss": "擊敗一隻首領",
  "Survive {x} minutes in a run": "在一局中生存 {x} 分鐘",
  "Survive {x} minutes with a {x}-type Pokémon": "生存 {x} 分鐘，使用 {x}系寶可夢",
  "Reach level {x} in a run": "在一局中達到 {x} 級",
  "Collect {x} coins in your runs": "遊玩時收集 {x} 枚金幣",
  "Open a locked chest": "開啟一個上鎖寶箱",
  "Open {x} locked chests": "開啟 {x} 個上鎖寶箱",
  "Win a rift battle": "贏得一場裂隙戰鬥",
  "Win {x} rift battles": "贏得 {x} 場裂隙戰鬥",
  "Evolve a move": "進化一個招式",
  "Evolve {x} moves": "進化 {x} 個招式",
  "Find a held item": "找到一件攜帶道具",
  "Complete {x} daily missions": "完成 {x} 個每日任務",
  "Collection": "收藏",
  "Survival": "生存",
  "Combat": "戰鬥",
  "Rifts": "裂隙",
  "Missions & more": "任務與其他",
  "First partner": "第一位夥伴",
  "Small team": "小小隊伍",
  "Collector": "收藏家",
  "Encyclopedia": "百科全書",
  "Pokémon Professor": "寶可夢博士",
  "Pokémon Master": "寶可夢大師",
  "Antiquarian": "古物收藏家",
  "Own 1 Pokémon.": "擁有 1 隻寶可夢。",
  "Own 10 Pokémon.": "擁有 10 隻寶可夢。",
  "Own 50 Pokémon.": "擁有 50 隻寶可夢。",
  "Own 100 Pokémon.": "擁有 100 隻寶可夢。",
  "Own 250 Pokémon.": "擁有 250 隻寶可夢。",
  "Own 500 Pokémon.": "擁有 500 隻寶可夢。",
  "Own all {x} Pokémon in the game.": "擁有遊戲中全部 {x} 隻寶可夢。",
  "Own every Pokémon in the game.": "擁有遊戲中的所有寶可夢。",
  "Something shines": "閃耀的光芒",
  "An eye for shine": "慧眼識閃光",
  "Shiny hunter": "閃光獵人",
  "Get 1 shiny.": "獲得 1 隻閃光寶可夢。",
  "Get 5 shinies.": "獲得 5 隻閃光寶可夢。",
  "Get 20 shinies.": "獲得 20 隻閃光寶可夢。",
  "Warming up": "熱身中",
  "Survivor": "生存者",
  "Tough": "堅韌",
  "Hard to beat": "難以擊倒",
  "Unstoppable": "勢不可擋",
  "Survive 5 minutes.": "生存 5 分鐘。",
  "Survive 10 minutes.": "生存 10 分鐘。",
  "Survive 15 minutes.": "生存 15 分鐘。",
  "Survive 20 minutes.": "生存 20 分鐘。",
  "Growing up": "茁壯成長",
  "Veteran": "老練訓練家",
  "Reach level 20 in a run.": "在一局中達到 20 級。",
  "Reach level 40 in a run.": "在一局中達到 40 級。",
  "Reach level 15 in a run.": "在一局中達到 15 級。",
  "Reach level 30 in a run.": "在一局中達到 30 級。",
  "First battles": "初次交鋒",
  "Brave": "勇敢",
  "Legend": "傳奇",
  "Living legend": "活傳奇",
  "Defeat 1,000 Pokémon.": "擊敗 1,000 隻寶可夢。",
  "Defeat 10,000 Pokémon.": "擊敗 10,000 隻寶可夢。",
  "Defeat 100,000 Pokémon.": "擊敗 100,000 隻寶可夢。",
  "Defeat a boss.": "擊敗一隻首領。",
  "Defeat 25 bosses.": "擊敗 25 隻首領。",
  "Defeat 100 bosses.": "擊敗 100 隻首領。",
  "Boss hunter": "首領獵人",
  "Giant slayer": "巨人殺手",
  "Terror of bosses": "首領剋星",
  "The other side": "另一端",
  "Rift jumper": "裂隙跳躍者",
  "Rift traveler": "裂隙旅人",
  "Explorer": "探索者",
  "Win your first rift battle.": "贏得第一場裂隙戰鬥。",
  "Win 10 rift battles.": "贏得 10 場裂隙戰鬥。",
  "Win in all 18 arenas (one per type).": "在全部 18 座系別競技場獲勝。",
  "Legend hunter": "傳說獵人",
  "Myth tamer": "神話馴服者",
  "Defeat 10 different legendaries.": "擊敗 10 種不同的傳說寶可夢。",
  "Defeat 30 different legendaries.": "擊敗 30 種不同的傳說寶可夢。",
  "Defeat all {x} legendaries.": "擊敗全部 {x} 隻傳說寶可夢。",
  "Defeat every legendary.": "擊敗所有傳說寶可夢。",
  "Defeat {x}": "擊敗 {x}",
  "Defeat {x} in a rift.": "在裂隙中擊敗 {x}。",
  "Evolution": "進化",
  "Evolutionist": "進化專家",
  "Move master": "招式大師",
  "Evolve a move.": "進化一個招式。",
  "Evolve 25 moves.": "進化 25 個招式。",
  "Evolve all {x} different moves.": "進化全部 {x} 種不同招式。",
  "Evolve all 47 different moves.": "進化全部 47 種不同招式。",
  "Item collector": "道具收藏家",
  "Full bag": "背包滿滿",
  "Find 5 different items.": "找到 5 種不同道具。",
  "Find all 11 items.": "找到全部 11 種道具。",
  "Reliable": "可靠",
  "Steady": "持之以恆",
  "Tireless": "不知疲倦",
  "Complete 10 missions.": "完成 10 個任務。",
  "Complete 50 missions.": "完成 50 個任務。",
  "Complete 200 missions.": "完成 200 個任務。",
  "In good company": "有伴真好",
  "A hundred friends": "好友滿天下",
  "Play a group game.": "遊玩一場多人遊戲。",
  "Play 10 group games.": "遊玩 10 場多人遊戲。",
  "Loyal partner": "忠實夥伴",
  "Play 50 runs.": "遊玩 50 局。",
  "Lucky": "幸運兒",
  "Slot machine": "扭蛋常客",
  "Make 100 gacha pulls.": "進行 100 次扭蛋抽獎。",
  "Brilliant": "光彩奪目",
  "Choose your nickname": "選擇你的暱稱",
  "Save nickname": "儲存暱稱",
  "Not now": "稍後再說",
  "It's the name your friends will see and the one on the leaderboard. Your real name and Google email are never shown to anyone.": "好友與排行榜會顯示這個名稱。你的真實姓名與 Google 電子郵件不會向其他人公開。",
  "Your nickname:": "你的暱稱：",
  "· give it to your friends so they can add you.": "· 將暱稱告訴朋友，讓他們加你為好友。",
  "Your nickname is {x}": "你的暱稱是 {x}",
  "Your friend's nickname": "好友的暱稱",
  "Add friend": "新增好友",
  "You haven't added any friends yet. Type a friend's nickname above.": "你尚未新增好友，請在上方輸入好友的暱稱。",
  "Wants to be your friend": "想加你為好友",
  "Request sent": "已送出邀請",
  "Offline": "離線",
  "Playing": "遊玩中",
  "Online": "在線上",
  "Seen {x} min ago": "{x} 分鐘前上線",
  "Seen {x} h ago": "{x} 小時前上線",
  "Seen {x} days ago": "{x} 天前上線",
  "{x} min ago": "{x} 分鐘前",
  "{x} h ago": "{x} 小時前",
  "{x} days ago": "{x} 天前",
  "Seen": "上次上線",
  "Accept": "接受",
  "Decline": "拒絕",
  "Remove": "移除",
  "Invite": "邀請",
  "In the room": "在房間中",
  "In your room": "在你的房間中",
  "Remove {x} from your friends?": "確定要將 {x} 從好友中移除？",
  "Cancel": "取消",
  "Create an account to play with friends and appear on the leaderboard.": "建立帳號即可與好友遊玩並登上排行榜。",
  "This needs the online version of the game (with the cloud).": "此功能需要有雲端服務的線上版本。",
  "Choose your nickname first.": "請先選擇暱稱。",
  "Type your friend's exact nickname.": "請輸入好友的完整暱稱。",
  "There's no player with that nickname.": "找不到使用此暱稱的玩家。",
  "That's you.": "這是你自己。",
  "You're already friends.": "你們已經是好友了。",
  "You already sent them a request.": "你已經送出邀請了。",
  "Request sent to {x}": "已向 {x} 送出好友邀請",
  "You're now friends with {x}": "你和 {x} 成為好友了",
  "There's no request.": "沒有邀請。",
  "The nickname must be 3-16 letters, numbers or _.": "暱稱需為 3～16 個英文字母、數字或底線。",
  "That nickname is already taken.": "此暱稱已被使用。",
  "Couldn't save the nickname ({x}).": "無法儲存暱稱（{x}）。",
  "Couldn't send it ({x}).": "無法送出（{x}）。",
  "Couldn't accept it ({x}).": "無法接受（{x}）。",
  "Couldn't remove it ({x}).": "無法移除（{x}）。",
  "Couldn't send the invite ({x}).": "無法送出邀請（{x}）。",
  "Room": "房間",
  "Menu": "選單",
  "Leave the room": "離開房間",
  "Invite friends": "邀請好友",
  "Start game": "開始遊戲",
  "Start game ({x})": "開始遊戲（{x}）",
  "Host": "房主",
  "Free": "空位",
  "You": "你",
  "Connected": "已連線",
  "Connected (via server)": "已連線（透過伺服器）",
  "Connecting…": "連線中…",
  "Connecting to your friends…": "正在連線至好友…",
  "No friends online right now.": "目前沒有好友在線上。",
  "You're the host. Invite your friends (up to {x}) and start when you're ready.": "你是房主，最多可邀請 {x} 位好友，準備好就開始吧。",
  "You're in {x}'s room. The host will start the game.": "你在 {x} 的房間中，請等待房主開始遊戲。",
  "When the host starts, you'll all join at the same time.": "房主開始後，所有人會同時進入遊戲。",
  "The game starts for everyone at once.": "所有人會同時開始遊戲。",
  "You need at least one friend in the room.": "房間中至少需要一位好友。",
  "The room has been closed": "房間已關閉",
  "Invite sent to {x}": "已向 {x} 送出邀請",
  "You can only invite your friends.": "只能邀請好友。",
  "The room is full.": "房間已滿。",
  "Only the room host can invite.": "只有房主可以邀請。",
  "The invite has expired.": "邀請已過期。",
  "That room no longer exists.": "此房間已不存在。",
  "That room's game has already started.": "此房間的遊戲已經開始。",
  "Couldn't join the room.": "無法加入房間。",
  "The room is full (max {x}).": "房間已滿（最多 {x} 人）。",
  "{x} invites you to play in their room": "{x} 邀請你加入房間一起遊玩",
  "invites you to play in their room": "邀請你加入房間一起遊玩",
  "Join": "加入",
  "No, thanks": "不用了，謝謝",
  "Go to the room": "前往房間",
  "survival time": "生存時間",
  "· survival time": "· 生存時間",
  "Monthly": "本月",
  "Yearly": "本年",
  "All-time": "歷史紀錄",
  "Friends only": "只顯示好友",
  "Filter by Pokémon (all-time)": "依寶可夢篩選（歷史紀錄）",
  "Clear filter": "清除篩選",
  "{x} Group": "{x} 多人",
  "Group": "多人",
  "No records here yet. Be the first!": "尚無紀錄，來當第一個吧！",
  "There's no Pokémon with that name": "找不到這個名稱的寶可夢",
  "Couldn't load the leaderboard ({x}).": "無法載入排行榜（{x}）。",
  "Choose a nickname (in Friends) to appear on the leaderboard.": "請先在好友頁面選擇暱稱，才能登上排行榜。",
  "Your best rank {x} {x}:": "你的最佳排名 {x} {x}：",
  "You don't have a record {x} {x} yet.": "你尚無 {x} {x} 的紀錄。",
  "today": "今日",
  "this week": "本週",
  "this month": "本月",
  "this year": "本年",
  "of all time": "歷史",
  "solo": "單人",
  "in a group": "多人",
  "Lv. {x} · {x} defeated": "等級 {x} · 擊敗 {x}",
  "New best record {x} on the leaderboard!": "排行榜新紀錄：{x}！",
  "of the week": "本週",
  "of the month": "本月",
  "of the year": "本年",
  "all-time": "歷史",
  "Sound": "音效",
  "Graphics": "畫面",
  "Controls": "操作",
  "Account": "帳號",
  "About": "關於",
  "Music": "音樂",
  "Effects": "音效",
  "Mute all": "全部靜音",
  "Unmute": "取消靜音",
  "Quality": "畫質",
  "High": "高",
  "Medium": "中",
  "Low": "低",
  "How many effects and particles are drawn.": "調整特效與粒子數量。",
  "lowers it automatically if the game stutters (now:": "會在遊戲卡頓時自動降低畫質（目前：",
  "How many effects and particles are drawn. {x} lowers it automatically if the game stutters (now: {x}).": "調整特效與粒子數量。{x}會在遊戲卡頓時自動降低畫質（目前：{x}）。",
  "high": "高",
  "medium": "中",
  "low": "低",
  "Display": "顯示",
  "Damage numbers": "傷害數字",
  "The numbers that pop up when you hit or get hit.": "攻擊或受傷時顯示的數字。",
  "Less shaking and flashing": "減少震動與閃光",
  "The camera shakes less and flashes are softer.": "降低畫面震動與閃光強度。",
  "Show FPS": "顯示 FPS",
  "Frames per second, in the bottom corner.": "在畫面下方角落顯示每秒影格數。",
  "Fullscreen": "全螢幕",
  "Without browser bars.": "隱藏瀏覽器工具列。",
  "Turn on": "啟用",
  "Yes": "是",
  "Language": "語言",
  "The game reloads when you change it.": "變更語言後會重新載入遊戲。",
  "On mobile or tablet": "手機與平板",
  "On PC": "電腦",
  "Joystick size": "搖桿大小",
  "How far you need to drag your finger.": "調整手指需要拖曳的距離。",
  "Small": "小",
  "Large": "大",
  "or arrow keys": "或方向鍵",
  "move": "移動",
  "or click its icon": "或點擊圖示",
  "choose move": "選擇招式",
  "previous / next move": "上一個／下一個招式",
  "choose a card when leveling up": "升級時選擇卡牌",
  "Put your finger anywhere and drag to move: the joystick appears where you touch. Tap a move at the bottom to switch to it and the top-right button to pause. Play in landscape.": "在任意位置拖曳手指即可移動，搖桿會出現在觸碰處。點擊下方招式可切換，右上角按鈕可暫停。請橫向遊玩。",
  "Nickname": "暱稱",
  "It's unique and can't be changed.": "暱稱不可重複，且無法變更。",
  "Account type": "帳號類型",
  "Save": "存檔",
  "This browser's account": "此瀏覽器的帳號",
  "Name and password": "名稱與密碼",
  "Delete account": "刪除帳號",
  "Sign up or log in": "註冊或登入",
  "You're playing as": "目前遊玩身分：",
  "You're playing as a {x}: your progress isn't saved when you leave.": "目前以{x}身分遊玩，離開後不會保留進度。",
  ": your progress isn't saved when you leave.": "：離開後不會保留進度。",
  "guest": "訪客",
  "Saved in the cloud": "已儲存至雲端",
  "Saving…": "儲存中…",
  "Waiting to upload (uploads when you leave the game)": "等待上傳（離開遊戲時上傳）",
  "Offline: it will upload when you're back": "離線中，恢復連線後會上傳",
  "Saved only in this browser": "只儲存在此瀏覽器",
  "Guest: not saved": "訪客：不會存檔",
  "Your account and all your progress will be deleted forever. Are you sure?": "帳號與所有進度將永久刪除，確定繼續？",
  "Reroll (": "重新抽選（",
  "Account deleted": "帳號已刪除",
  "Delete forever": "永久刪除",
  "Your account and all your progress will be deleted forever. To confirm, type your password.": "帳號與所有進度將永久刪除。請輸入密碼以確認。",
  "Type your password.": "請輸入密碼。",
  "Log in to be able to delete your account.": "請先登入才能刪除帳號。",
  "Version {x}": "版本 {x}",
  "Fan game": "同人遊戲",
  "free and non-profit": "免費且非營利",
  "Fan game {x}: no ads or payments. Pokémon and its characters are owned by Nintendo, Creatures and GAME FREAK; this project is not affiliated with them.": "同人遊戲，{x}，無廣告或付費內容。寶可夢及其角色由 Nintendo、Creatures 與 GAME FREAK 擁有，本專案與上述公司無關。",
  ": no ads or payments. Pokémon and its characters are owned by Nintendo, Creatures and GAME FREAK; this project is not affiliated with them.": "，無廣告或付費內容。寶可夢及其角色由 Nintendo、Creatures 與 GAME FREAK 擁有，本專案與上述公司無關。",
  "Credits": "製作與素材來源",
  "PMD SpriteCollab and its artists (CC BY-NC 4.0).": "PMD SpriteCollab 與參與創作者（CC BY-NC 4.0）。",
  "Pokémon data:": "寶可夢資料：",
  "Music and sounds:": "音樂與音效：",
  "original, generated by the game itself.": "原創，由遊戲本身產生。",
  "Font:": "字型：",
  "Guide & FAQ": "指南與常見問題",
  "Contact": "聯絡",
  "Code (GitHub)": "原始碼（GitHub）",
  "Rotate your phone": "請旋轉手機",
  "PokéSurvivor is played in landscape.": "PokéSurvivor 需以橫向模式遊玩。",
  "The game couldn't fully load (did the connection drop?).": "無法完整載入遊戲，請檢查連線。",
  "Reload": "重新載入",
  "Fan project": "同人專案",
  "is a game made by fans,": "是由粉絲製作的遊戲，",
  ". It has no ads, no purchases and no source of income of any kind, and it never will.": "。沒有廣告、內購或任何收益來源，未來也不會有。",
  "It is not affiliated with, sponsored or endorsed by Nintendo, Creatures Inc., GAME FREAK or The Pokémon Company. Pokémon and all related names and characters are trademarks and property of their respective owners.": "本作未獲 Nintendo、Creatures Inc.、GAME FREAK 或 The Pokémon Company 贊助或認可，亦與其無關。寶可夢及相關名稱、角色與商標均屬各自權利人所有。",
  "Third-party content": "第三方內容",
  "Sprites from": "精靈圖來自",
  "(CC BY-NC 4.0, full credits in the repository's CREDITS.md). Pokédex data from": "（CC BY-NC 4.0，完整名單見原始碼中的 CREDITS.md）。圖鑑資料來自",
  ". Pixelify Sans font (OFL). The music and sound effects are original to the project.": "。Pixelify Sans 字型（OFL）。音樂與音效為本專案原創。",
  "Contact and content removal": "聯絡與內容移除",
  "If you are a rights holder and want something removed, write to us and we'll take it down as soon as possible:": "若你是權利人且希望移除內容，請來信，我們會儘速處理：",
  "Source code:": "原始碼：",
  "Privacy": "隱私權",
  "If you create an account, we store your player name and your game (collection, coins, upgrades and stats) in Google Firebase so you can continue on any computer. If you sign in with Google, Firebase also stores your Google email to identify you (it is never shown to other players). We don't use your data for anything else, we don't share it, and there are no ads or tracking.\nAs a guest, nothing is stored outside your browser.": "建立帳號後，玩家名稱與進度（收藏、金幣、強化與統計）會儲存在 Google Firebase，以便在不同電腦繼續遊玩。使用 Google 登入時，Firebase 也會儲存電子郵件以識別身分，但不會向其他玩家公開。資料不會用於其他用途或分享，沒有廣告或追蹤。訪客資料不會儲存至瀏覽器以外的地方。",
  "Friends and leaderboard: your": "好友與排行榜：你的",
  "is public to other players. We store your friends list, whether you're online and your best times (with your nickname and your Pokémon).": "會向其他玩家公開。我們會儲存好友清單、上線狀態與最佳時間（包含暱稱及寶可夢）。",
  "Group games: your browser connects": "多人遊戲：你的瀏覽器會直接連線",
  "to your teammates' browsers (like a video call), so each of you may be able to see the others' IP address. Only play in a group with people you know. If a direct connection isn't possible, the game goes through Firebase's servers.": "至隊友的瀏覽器（類似視訊通話），因此彼此可能看見對方的 IP 位址。請只與認識的人組隊；無法直接連線時，會透過 Firebase 伺服器連線。",
  "You can delete your account whenever you want (your nickname, friends and records are deleted too):": "你可隨時刪除帳號，暱稱、好友與紀錄也會一併刪除：",
  "Delete my account and my game": "刪除我的帳號與存檔",
  "PokéSurvivor needs JavaScript to work. Please enable it to play.": "PokéSurvivor 需要 JavaScript，請啟用後再遊玩。",
  "A free survival fan game with 966 Pokémon from all 9 regions: choose your partner, survive the hordes, evolve your moves, take on legendaries and play co-op with up to 4 friends.": "免費生存同人遊戲，收錄 9 個地區的 966 隻寶可夢。選擇夥伴、抵擋敵潮、進化招式、挑戰傳說寶可夢，並支援最多 4 人合作。",
  "Game guide": "遊戲指南",
  "Support": "支持",
  "Support the project": "支持本專案",
  "Donate on Ko-fi": "在 Ko-fi 贊助",
  "More info": "更多資訊",
  "PokéSurvivor is and will stay": "PokéSurvivor 現在與未來都會",
  "free": "免費",
  ", with no ads or purchases. If you'd like to help keep it online, you can make a": "，沒有廣告或內購。如果想協助維持服務，你可以",
  "voluntary donation": "自願贊助",
  ": all the money goes to the": "：所有款項僅用於",
  "servers and the domain": "伺服器與網域",
  ", nothing else.": "，沒有其他用途。",
  "Donating gives no advantage in the game.": "贊助不會獲得任何遊戲優勢。",
  "What it costs to keep it running": "維持服務的費用",
  "Servers (saves, accounts, leaderboards and multiplayer)": "伺服器（存檔、帳號、排行榜與多人遊戲）",
  "Depends on how many people play": "依玩家人數而定",
  "Domain pokesurvivor.com": "pokesurvivor.com 網域",
  "≈€12 per year": "每年約 12 歐元",
  "The more people play, the more the servers cost. Anything left over is saved for the following months' costs.": "玩家越多，伺服器費用越高。剩餘款項會保留作為未來月份的費用。",
  "Fan game {x}: no ads or purchases. Pokémon and its characters are owned by Nintendo, Creatures and GAME FREAK; this project is not affiliated with them.": "同人遊戲，{x}，無廣告或內購。寶可夢及其角色由 Nintendo、Creatures 與 GAME FREAK 擁有，本專案與上述公司無關。",
  ": no ads or purchases. Pokémon and its characters are owned by Nintendo, Creatures and GAME FREAK; this project is not affiliated with them.": "，無廣告或內購。寶可夢及其角色由 Nintendo、Creatures 與 GAME FREAK 擁有，本專案與上述公司無關。",
  ". It has no ads or purchases. You can support it with voluntary donations, which are used only to pay for the servers and the domain and give no advantage in the game.": "。沒有廣告或內購，可自願贊助；款項僅用於伺服器與網域費用，不會帶來任何遊戲優勢。",
  "Partner": "夥伴",
  "tickets and": "抽獎券與",
  "directly": "直接",
  "You have": "你擁有",
  "Moves it can learn": "可學會的招式",
  "Fan game {x} — no ads or payments.": "同人遊戲，{x}，無廣告或付費內容。",
  "Type: Null": "屬性：空",
  "Pokédex: every playable Pokémon": "寶可夢圖鑑：所有可遊玩的寶可夢",
  "A RIFT HAS OPENED!": "裂隙開啟了！",
  "Follow the purple arrow: a legendary awaits inside": "跟隨紫色箭頭，裡面有傳說寶可夢等著你",
  "RIFT · {x} m · {x} s": "裂隙 · {x} 公尺 · {x} 秒",
  "RIFT · {x} s": "裂隙 · {x} 秒",
  "{x} is enraged!": "{x} 暴怒了！",
  "Press to start": "點擊開始",
  "Survive the hordes with your Pokémon partner": "與寶可夢夥伴一起抵擋敵潮",
  "Bonemerang": "骨頭回力鏢",
  "Psycho Cut": "精神利刃",
  "Spikes": "撒菱",
  "Toxic Spikes": "毒菱",
  "Hail": "冰雹",
  "Meteor Mash": "彗星拳",
  "Will-O-Wisp": "鬼火",
  "Substitute": "替身",
  "Aerial Ace": "燕返",
  "Flame Wheel": "火焰輪",
  "Bubble Beam": "泡沫光線",
  "Hex": "禍不單行",
  "Bone Rush": "骨棒亂打",
  "Psychic Fangs": "精神之牙",
  "Fissure": "地裂",
  "Gunk Shot": "垃圾射擊",
  "Avalanche": "雪崩",
  "Magnet Bomb": "磁鐵炸彈",
  "Inferno": "煉獄",
  "Double Team": "影子分身",
  "Acrobatics": "雜技",
  "Flare Blitz": "閃焰衝鋒",
  "Aqua Tail": "水流尾",
  "You dash at the enemy like lightning and hit everything on the way.": "閃電般衝向敵人，攻擊沿途所有目標。",
  "A short fan of flames that burns.": "短距離扇形火焰，使敵人灼傷。",
  "Two leaves that fly out and back, cutting both ways.": "兩片葉子來回飛行，去回都能斬擊敵人。",
  "A bolt that jumps from one enemy to the next.": "在敵人之間跳躍的電光。",
  "You leave pools of poison that badly poison whoever steps on them.": "沿路留下毒池，使踩到的敵人陷入劇毒。",
  "Leaves webs on the ground that trap and greatly slow whoever steps on them.": "在地上留下蛛網，困住敵人並大幅減速。",
  "Rocks fall from the sky onto nearby enemies.": "岩石從天而降，砸向附近的敵人。",
  "A bone that flies out and back, hitting hard.": "來回飛行的骨頭，造成強力打擊。",
  "Psychic blades that come back to you.": "飛出後會返回的精神利刃。",
  "Scatters spikes that burst when stepped on.": "撒下踩踏後會爆炸的尖刺。",
  "Poison spikes that badly poison when they burst.": "爆炸時使敵人陷入劇毒的毒刺。",
  "Hailstones fall on enemies and slow them.": "冰雹落在敵人身上並使其減速。",
  "Two steel meteors that crush where they land.": "兩顆鋼鐵流星，重擊落點範圍。",
  "Leaves a floating flame that fires on its own and burns.": "留下會自動射擊的浮空火焰，使敵人灼傷。",
  "A decoy that stays behind shooting for you.": "留下替身，持續代替你射擊。",
  "You dive and slash everything you pass through.": "俯衝並斬擊沿途所有敵人。",
  "You run wrapped in fire, leaving a trail of flames.": "全身包覆火焰向前衝刺，留下火焰軌跡。",
  "A short fan of bubbles that slows.": "短距離扇形泡泡，使敵人減速。",
  "A curse that jumps between enemies. Much more damage if they are burned, poisoned or slowed.": "在敵人之間跳躍的詛咒，對灼傷、中毒或減速的敵人造成更多傷害。",
  "+1 boomerang": "迴旋鏢 +1",
  "+30% range": "射程 +30%",
  "+1 boomerang and +40% damage": "迴旋鏢 +1、傷害 +40%",
  "+2 jumps": "跳躍次數 +2",
  "+2 jumps and +40% damage": "跳躍次數 +2、傷害 +40%",
  "+1 mine": "地雷 +1",
  "+30% blast radius": "爆炸半徑 +30%",
  "+1 mine and -25% cooldown": "地雷 +1、冷卻時間 -25%",
  "+1 meteor": "流星 +1",
  "+2 meteors and -20% cooldown": "流星 +2、冷卻時間 -20%",
  "Fires 35% faster": "射速提高 35%",
  "+1 at a time": "同時存在數量 +1",
  "+50% duration and +40% damage": "持續時間 +50%、傷害 +40%",
  "+30% distance": "距離 +30%",
  "+60% damage and wider": "傷害 +60%，寬度增加",
  "+40% duration": "持續時間 +40%",
  "Pools 30% bigger": "毒池範圍增加 30%",
  "+50% damage and +30% radius": "傷害 +50%、半徑 +30%",
  "+3 shots": "射擊數 +3",
  "+3 shots and +1 pierce": "射擊數 +3、貫穿 +1",
  "×1.8 damage, +1 boomerang and more range": "傷害 ×1.8、迴旋鏢 +1、射程增加",
  "×1.7 damage and +3 jumps": "傷害 ×1.7、跳躍次數 +3",
  "×1.8 damage, +2 mines and a bigger blast": "傷害 ×1.8、地雷 +2、爆炸範圍增加",
  "×1.7 damage, +2 meteors and more radius": "傷害 ×1.7、流星 +2、半徑增加",
  "×1.8 damage, +1 at a time and fires faster": "傷害 ×1.8、同時存在數量 +1、射速提高",
  "×1.9 damage, more distance and less cooldown": "傷害 ×1.9、距離增加、冷卻時間縮短",
  "×1.8 damage, bigger and longer-lasting pools": "傷害 ×1.8、毒池範圍與持續時間增加",
  "×1.7 damage, +4 shots and +1 pierce": "傷害 ×1.7、射擊數 +4、貫穿 +1",
  "A {x}-type horde!": "{x}系敵潮來襲！",
  "Golden hour! Double experience": "黃金時刻！經驗值加倍",
  "A {x} is lost! Find it and take it to the marker": "一隻 {x} 迷路了！找到牠並帶往標記處",
  "{x} is following you! Take it to the green marker": "{x} 正跟著你！帶牠前往綠色標記",
  "{x} got scared and ran away…!": "{x} 受到驚嚇，逃走了…！",
  "{x} got tired of waiting and left…": "{x} 等得不耐煩，離開了…",
  "You brought {x} home! It thanks you": "你把 {x} 送回家了！牠很感謝你",
  "{x} joins your team!": "{x} 加入了你的隊伍！",
  "{x} thanks you! (+150 coins, you already had it)": "{x} 感謝你！（已擁有，獲得 150 金幣）",
  "A {x} with a ×10 ticket! Catch it before it runs away!": "一隻 {x} 帶著十連抽獎券！快在牠逃走前抓住牠！",
  "A {x} loaded with coins! Catch it before it runs away!": "一隻 {x} 帶著大量金幣！快在牠逃走前抓住牠！",
  "{x} got away!": "{x} 逃走了！",
  "GOLDEN HOUR · {x} s": "黃金時刻 · {x} 秒",
  "{x} HORDE · {x} s": "{x} 敵潮 · {x} 秒",
  "Marker · {x} m": "標記 · {x} 公尺",
  "Enjoying PokéSurvivor? I make it on my own and the servers cost money. If you'd like, you can help keep it online.": "喜歡 PokéSurvivor 嗎？原作者獨力開發這款遊戲，伺服器需要費用。如果願意，你可以協助維持線上服務。",
  "Support on Ko-fi": "在 Ko-fi 支持",
  "Sign in with Google (if you already have an account)": "使用 Google 登入（已有帳號）",
  "New accounts are full for this month: they reopen on {x} 1. If you already have an account, sign in as usual. If not, play as a guest.": "本月新帳號名額已滿，將於 {x} 月 1 日重新開放。已有帳號可照常登入，其他玩家可先以訪客遊玩。",
  "There are no new account slots left this month (they reopen on {x} 1). Meanwhile, you can play as a guest.": "本月已無新帳號名額，將於 {x} 月 1 日重新開放。這段期間可先以訪客遊玩。",
  "ATK": "攻擊",
  "SPD": "速度",
  "Lv.{x}": "等級 {x}",
  "Lv. {x}": "等級 {x}",
  "PokéSurvivor – Free Pokémon survival game online": "PokéSurvivor — 繁體中文補丁",
  "Search by name": "依名稱搜尋",
  "Buscar por nombre": "依名稱搜尋",
  "Wild Pokémon are getting stronger and stronger!": "野生寶可夢正變得越來越強！",
  "· Duplicates give PokéCoins. Shinies never repeat.": "· 重複的寶可夢會轉換成寶可幣；閃光寶可夢不會重複。",
  "· Tickets are earned by playing: some Pokémon drop them when defeated, and bosses and rift legendaries sometimes give ×10 tickets.": "· 遊玩即可獲得抽獎券：部分寶可夢被擊敗時會掉落，頭目和裂縫中的傳說寶可夢有時會掉落十連抽獎券。",
  "Paused: {x} is choosing…": "已暫停：{x} 正在選擇…",
  "Paused: {x} are choosing…": "已暫停：{x} 正在選擇…",
  "The game crashed: your run has been saved up to this point": "遊戲發生錯誤：已儲存本局截至目前的進度",
  "Paused: waiting for {x} (host)…": "已暫停：正在等待房主 {x}…",
  "What's new": "更新公告",
  "A new version of the game is out: updating in {x} s…": "遊戲有新版本：將於 {x} 秒後更新…",
  "Could not connect (retrying…)": "無法連線（正在重試…）",
  "Can't connect to one of your friends: their network (or yours) doesn't allow group play. Try another Wi-Fi or mobile data; it retries automatically.": "無法連上部分好友：對方或你的網路不允許多人連線。請改用其他 Wi-Fi 或行動網路；系統會自動重試。",
  "New accounts cannot be created right now. If you already have an account, sign in as usual; otherwise, you can play as a guest.": "目前暫停建立新帳號。已有帳號可照常登入；尚無帳號則可先以訪客身分遊玩。",
  "Move shortcuts": "招式欄位設定",
  "Choose which move always goes in each slot (keys 1-4 or the icons at the bottom), for muscle memory. If you do not have that many moves yet, it goes to the closest slot.": "設定各招式固定使用的欄位（按鍵 1～4 或下方圖示），方便熟悉操作。若目前招式數量不足，會先放入最接近的可用欄位。",
  "Critical Hit": "擊中要害",
  "+3% critical chance (x1.5 damage)": "擊中要害機率 +3%（造成 1.5 倍傷害）",
  "Card reroll": "卡片重抽",
  "+1 level-up card reroll per run": "每局升級卡片重抽次數 +1",
  "Ban": "招式封鎖",
  "Ban 1 move: it never shows up in your cards": "封鎖 1 個招式，使其不再出現在升級卡片中",
  "Choose ({x})": "選擇（{x}）",
  "Tap the moves you do not want in your cards ({x}). The starting move cannot be banned.": "點選不想出現在升級卡片中的招式（{x}）。起始招式無法封鎖。",
  "You already have {x} banned: remove one first": "已封鎖 {x} 個招式，請先解除其中一個",
  "On iPhone, Safari does not let websites go fullscreen. Tap Share and then \"Add to Home Screen\": opening the game from that icon plays it fullscreen.": "在 iPhone 上，Safari 不允許此網頁直接進入全螢幕。可點選「分享」→「加入主畫面」，再從該圖示以全螢幕開啟遊戲。",
  "Every run counts": "每一局都算數",
  "No more anti-cheat checks: every run counts for the leaderboard and your records, and nothing you earn is taken away.": "移除反作弊檢查：每一局都會計入排行榜與個人紀錄，獲得的獎勵也不再因此被撤回。",
  "Overtime and less random rifts": "延長戰局與裂縫出現機制調整",
  "Overtime: from minute 60 on, wild Pokémon keep getting stronger (more HP and more damage), faster and faster. Before, with maxed upgrades, some runs never ended; now the best ones will last about an hour and a half.": "延長戰局：從第 60 分鐘起，野生寶可夢的體力與傷害會不斷提高，成長速度也會越來越快。先前強化全滿後，有些戰局幾乎不會結束；調整後，表現最好的戰局預計約可持續一個半小時。",
  "The game now updates itself when a new version is out: within 5 seconds if you are in the menu, or after your run if you are playing (without losing anything).": "推出新版本時，遊戲會自動更新：停留在選單時會在 5 秒內更新；正在遊玩時則等本局結束後更新，不會遺失進度與獎勵。",
  "A \"What's new\" button (this window) with every change to the game.": "新增「更新公告」按鈕（就是這個視窗），可查看遊戲的各項更新。",
  "Easier to read numbers: 2, 5 and 8 no longer look alike.": "改善數字字型，讓 2、5、8 更容易分辨。",
  "Pick the normal or shiny version of your partner right from the main menu, under it.": "可直接在主選單的夥伴下方，切換一般或閃光外觀。",
  "New upgrades for each Pokémon: Critical Hit (+3% critical chance per level, crits deal x1.5 damage), Card reroll (+1 level-up card reroll per run) and Ban (block moves so they never show up in your cards; pick them in Upgrades).": "各寶可夢新增強化項目：「擊中要害」（每級提高 3% 擊中要害機率，造成 1.5 倍傷害）、「卡片重抽」（每局升級卡片重抽次數 +1）及「招式封鎖」（在強化頁選擇招式，使其不再出現在升級卡片中）。",
  "Move shortcuts (in Upgrades, for each Pokémon): choose which move always goes in each slot, for example Confusion always on 1, for muscle memory.": "招式欄位設定：可在各寶可夢的強化頁設定招式固定使用的欄位，例如將「念力」固定在第 1 格，方便熟悉操作。",
  "Rock Slide deals less damage (21 instead of 26): it defeated almost twice as many as the average move.": "「岩崩」傷害從 26 下調為 21；原本的擊敗數量接近一般招式的兩倍。",
  "Level-up card rerolls are no longer earned by defeating bosses: you get 1 free per run and can buy more in Upgrades.": "擊敗頭目不再增加升級卡片的重抽次數。每局有 1 次免費重抽，可在強化頁購買額外次數。",
  "Rift legendaries no longer always drop x10 tickets: they drop one half of the time (they used to always drop 2, which was too many).": "裂縫中的傳說寶可夢不再必定掉落十連抽獎券，改為 50% 機率掉落 1 張；先前必定掉落 2 張，數量過多。",
  "Co-op: if your networks cannot connect to each other, the room says so and keeps retrying, instead of playing laggy through a slow server.": "多人合作：若彼此的網路無法直接連線，房間會顯示提示並持續重試，不再改用速度較慢的伺服器而造成遊戲卡頓。",
  "We moved to new servers so the game can stay free: you may need to sign in again (with the same account and password, or with Google). Your save and your Pokémon are unchanged.": "為了讓遊戲持續免費營運，已搬遷至新的伺服器。你可能需要以原帳號密碼或 Google 重新登入；存檔與寶可夢不受影響。",
  "Gacha: shinies no longer come out as duplicates. If you roll one you already have, you get another of the same rarity that you are missing.": "扭蛋：閃光寶可夢不再重複。若抽到已擁有的閃光寶可夢，會改成同稀有度、尚未擁有的閃光寶可夢。",
  "Less random rifts: every time one does not show up, the next one is more likely (at most 2.5 minutes without a rift).": "調整裂縫出現機制：每次未出現裂縫，下次出現的機率就會提高，最長不會超過 2.5 分鐘沒有裂縫。",
  "Legendaries you have not beaten yet show up 4 times as often in rifts.": "尚未擊敗的傳說寶可夢，在裂縫中的出現機率提高為 4 倍。",
  "Healers heal more the harder you hit, but with diminishing returns and a cap (2.5x at most).": "你的攻擊越強，治療型敵人的回復量也越高，但增幅會逐漸減少，最高為原本的 2.5 倍。",
  "Stronger melee attacks: while one is active you take 25% less damage, and they reach 25% further and deal 20% more damage.": "強化近戰招式：啟用近戰招式時，受到的傷害減少 25%；近戰攻擊距離增加 25%，傷害提高 20%。",
  "Co-op: choosing which held item to keep now pauses the run for everyone (it used to keep going and you got hit while choosing).": "多人合作：選擇要保留的攜帶道具時，所有玩家都會暫停；先前遊戲仍會繼續，選擇途中可能遭到攻擊。",
  "Co-op: while someone is choosing a fusion, the run pauses for everyone.": "多人合作：有人正在選擇融合招式時，所有玩家都會暫停。",
  "Co-op: if the host switches tabs or their game stalls, the run pauses for everyone until they are back.": "多人合作：房主切換分頁或遊戲停頓時，所有玩家都會暫停，直到房主恢復遊戲。",
  "Runs shorter than 1 minute no longer count for the leaderboard.": "未滿 1 分鐘的戰局不再計入排行榜。",
  "Removed broken records from the leaderboard caused by the minute 84 bug (the clock kept running while the game was frozen) and a few impossible ones. If you had one, your next run counts again.": "移除排行榜中由第 84 分鐘錯誤造成的異常紀錄（遊戲停住但計時仍持續），以及部分不可能達成的紀錄。若你的紀錄受到影響，下一局即可重新計入。",
  "iPhone (Safari and Chrome): sometimes you could not switch moves by tapping the icons, especially with your other finger on the joystick. Buttons also sit above the home bar now.": "修正 iPhone 的 Safari 與 Chrome 有時無法點選圖示切換招式的問題，尤其是另一根手指正操作搖桿時。按鈕位置也已調整至底部主畫面橫條上方。",
  "In runs longer than 84 minutes the screen went black, the game froze or you kept levelling up forever. Now you can play for as long as you survive.": "修正戰局超過 84 分鐘後黑畫面、遊戲停住或無限升級的問題。現在只要能存活，就能繼續遊玩。",
  "If the game ever crashes, the run ends by itself and is saved (time, defeated, records and leaderboard) instead of being lost.": "若遊戲發生錯誤，會自動結束本局並儲存存活時間、擊敗數、個人紀錄及排行榜成績，避免整局進度遺失。",
  "Very long runs were sometimes flagged as cheating and did not count for the leaderboard.": "修正長時間戰局有時被誤判為作弊，導致成績未計入排行榜的問題。",
  "Co-op: if the host switched tabs, enemies stood still and everyone else got a free advantage.": "修正多人合作時房主切換分頁後，敵人停住、其他玩家卻仍可繼續行動的問題。",
  "iPhone: holding your finger on the joystick brought up \"Copy / Select all\".": "修正 iPhone 長按搖桿時出現「拷貝／全選」選單的問題。",
  "iPhone: fullscreen sometimes did not show up. Now the button explains how to get it (Share and \"Add to Home Screen\").": "修正 iPhone 有時不顯示全螢幕按鈕的問題。現在按鈕會提示如何使用全螢幕（「分享」→「加入主畫面」）。",
  "Bonds": "羈絆",
  "Bonds: defeating a legendary lets you fuse moves that fire at the same time from a single slot (up to 4).": "羈絆：擊敗傳說寶可夢後，可以融合招式，讓同一欄位同時施放最多 4 個招式。",
  "A button to reroll the level-up cards.": "新增升級卡片重抽按鈕。",
  "More rifts.": "增加裂縫出現頻率。",
  "Weaker psychic moves and healers.": "下調超能力系招式與治療型敵人的強度。",
  "Level-up card upgrades (speed, cooldown, experience, magnet, armor and power) can only be taken a limited number of times.": "升級卡片中的速度、冷卻、經驗、磁力、防禦與威力強化，新增選取次數上限。",
  "On mobile, the Pokémon details show alongside; logging in is faster and the x10 gacha can be closed.": "手機版寶可夢詳細資料改為顯示在旁邊；登入速度更快，十連扭蛋畫面也可以關閉。",
  "Black screen in runs longer than an hour because image memory filled up.": "修正遊玩超過一小時後，因圖片記憶體耗盡而黑畫面的問題。",
  "Tickets were lost if the tab closed before the run ended: now they are saved as soon as you pick them up.": "修正戰局結束前關閉分頁會遺失抽獎券的問題；現在拾取時就會立即儲存。",
  "An upgrade bought right after saving was charged but not applied.": "修正剛存檔後購買強化，扣款卻未套用強化的問題。",
  "The game froze forever if something went wrong mid-run.": "修正戰局途中發生錯誤後，遊戲永久停住的問題。",
  "More challenge": "更具挑戰性",
  "Bosses and legendaries with 4 telegraphed attacks that get enraged at half health.": "頭目與傳說寶可夢擁有 4 種附帶預警的攻擊，體力降至一半時會進入狂暴狀態。",
  "12 new moves and 8 new ways to attack: boomerang, chain, mines, meteors, turret, dash, trail and spray.": "新增 12 個招式與 8 種攻擊形式：迴旋、連鎖、地雷、隕石、砲塔、衝刺、軌跡及扇形攻擊。",
  "Mid-run events (single-type hordes, golden hour, lost Pokémon) and Meowth and Gholdengo running away loaded with coins.": "新增戰局事件（單一系群襲、黃金時段、迷路的寶可夢），以及攜帶大量金幣逃跑的喵喵與賽富豪。",
  "Statues for big Pokémon.": "為大型寶可夢新增雕像。",
  "Harder: fewer but tougher enemies.": "提高難度：敵人數量減少，但實力更強。",
  "Levelling up is slower, tickets are rarer and bosses drop a x10 ticket one time in three.": "升級速度降低，抽獎券更稀有；頭目有三分之一機率掉落 1 張十連抽獎券。",
  "Faster loading.": "加快載入速度。",
  "Straggling enemies vanished in front of you: now only off-screen.": "修正落後的敵人在眼前消失的問題；現在只會在畫面外移除。",
  "Menus and screens overlapped the top bar.": "修正選單與介面覆蓋頂部工具列的問題。",
  "Mobile and English": "手機版與英文版",
  "Play on phones and tablets with a touch joystick, and install it as an app.": "支援手機與平板觸控搖桿操作，並可加入主畫面，像 App 一樣開啟。",
  "The game in English and Spanish.": "遊戲提供英文與西班牙文。",
  "Settings screen with automatic graphics quality.": "新增設定頁面與自動畫質調整。",
  "Fewer but stronger enemies on screen.": "畫面中的敵人數量減少，但實力更強。",
  "Giga Drain becomes Grass Knot (no more healing).": "「終極吸取」改為「打草結」，不再回復體力。",
  "Missions, rifts and co-op": "任務、裂縫與多人合作",
  "Daily and weekly missions, achievements with medals and titles, and a public profile.": "新增每日與每週任務、附帶獎章與稱號的成就，以及公開個人檔案。",
  "Held items, move evolutions and enemies that heal, shield, summon or explode.": "新增攜帶道具、招式進化，以及會治療、提供護盾、召喚或爆炸的敵人。",
  "Rifts leading to 18 legendary arenas, one per type, and weather that changes the fight.": "新增通往 18 座傳說競技場的裂縫（各系一座），以及會影響戰鬥的天氣。",
  "Co-op with your friends list and leaderboards.": "新增好友名單、多人合作與排行榜。",
  "Upgrades for each Pokémon, a slot-machine ticket gacha and a type chart.": "新增各寶可夢的強化系統、使用抽獎券的拉霸式扭蛋，以及系相剋表。",
  "Camera further away and enemies that avoid obstacles.": "拉遠鏡頭，敵人也會繞過障礙物。",
  "Camera further out and enemies that walk around obstacles.": "拉遠鏡頭，敵人也會繞過障礙物。",
  "First version": "首個版本",
  "First public version of PokéSurvivor.": "PokéSurvivor 首次公開發佈。",
  "New": "新增",
  "Nuevo": "新增",
  "Changes": "調整",
  "Cambios": "調整",
  "Fixes": "修正",
  "Arreglos": "修正",
  "Ruins of Judgment": "審判遺跡",
  "THE JUDGMENT": "審判",
  "OF ARCEUS": "阿爾宙斯",
  "Time has run out…": "時間已到…",
  "ARCEUS HAS DESCENDED!": "阿爾宙斯降臨了！",
  "It is invincible: run and survive as long as you can": "牠無法被擊敗：快逃，盡可能撐下去！",
  "Tap the screen to skip": "點擊螢幕跳過",
  "Press Space to skip": "按空白鍵跳過",
  "Run from Arceus! It is invincible": "快逃離阿爾宙斯！牠無法被擊敗",
  "{x} answers the Judgment!": "{x} 應審判之召現身！",
  "JUDGMENT · {x} · BOSSES {x}": "審判 · {x} · 頭目 {x}",
  "Against Arceus": "對抗阿爾宙斯",
  "{x} · {x} legendaries": "{x} · {x} 隻傳說寶可夢",
  "{x} · {x} legendary": "{x} · {x} 隻傳說寶可夢",
  "The Judgment": "審判",
  "Reach the Judgment of Arceus (minute 30).": "抵達阿爾宙斯的審判（第 30 分鐘）。",
  "Before the Creator": "直面創世者",
  "Survive 1 minute against Arceus.": "面對阿爾宙斯，存活 1 分鐘。",
  "Divine challenge": "神之試煉",
  "Defeat 3 legendaries against Arceus in a single run.": "在同一局面對阿爾宙斯時，擊敗 3 隻傳說寶可夢。",
  "Judged": "受審者",
  "Chosen of Arceus": "阿爾宙斯的天選者",
  "Report suspicious record": "檢舉可疑紀錄",
  "You already reported it": "你已檢舉過這筆紀錄",
  "You already reported this record": "你已檢舉過這筆紀錄",
  "Report {x}'s record as cheating?": "要檢舉 {x} 的紀錄涉嫌作弊嗎？",
  "Thanks: we will review it": "感謝檢舉，我們會進行審查",
  "ARCEUS · {x} m": "阿爾宙斯 · {x} 公尺",
  "The Judgment of Arceus": "阿爾宙斯的審判",
  "The Judgment of Arceus: at minute 30, Arceus descends from the sky and takes you to the Ruins of Judgment. It is invincible, chases you faster and faster and casts pillars of light, beams and shockwaves; if it touches you, you lose almost half your HP. Every 5 seconds a legendary joins, each with twice the HP and damage of the previous one. How long can you last?": "阿爾宙斯的審判：到達第 30 分鐘時，阿爾宙斯會從天而降，將你帶往審判遺跡。牠無法被擊敗，追趕速度會越來越快，還會施放光柱、光束與衝擊波；一旦碰到牠，就會損失將近一半體力。每隔 5 秒會有一隻傳說寶可夢加入，體力與傷害都是前一隻的兩倍。你能撐多久？",
  "Three new achievements: The Judgment (reach minute 30), Before the Creator (survive 1 minute against Arceus) and Divine challenge (defeat 3 legendaries against Arceus in a single run).": "新增三項成就：「審判」（抵達第 30 分鐘）、「直面創世者」（面對阿爾宙斯存活 1 分鐘）及「神之試煉」（在同一局面對阿爾宙斯時擊敗 3 隻傳說寶可夢）。",
  "New music for the fight against Arceus.": "新增對抗阿爾宙斯時的戰鬥音樂。",
  "A button to report suspicious records on the leaderboard (the little flag on each row).": "排行榜新增可疑紀錄檢舉按鈕（每列的小旗子）。",
  "The all-time leaderboard starts from scratch: now that runs end against Arceus, older records could no longer be reached. The daily, weekly and monthly boards are unchanged.": "歷史排行榜重新開始：現在戰局會在對抗阿爾宙斯的階段結束，舊紀錄已無法再達成，因此重置歷史榜。每日、每週與每月排行榜保持不變。",
  "Overtime from minute 60 is removed (runs no longer get that far).": "移除第 60 分鐘起的延長戰局機制，因為現在已無法存活到那個階段。",
  "Rifts no longer open from minute 28 on, so the Judgment does not catch you inside one.": "從第 28 分鐘起不再開啟裂縫，避免審判開始時玩家仍在裂縫中。",
  "Leaderboard protected against cheating: the server checks that every record was really played. You never lose anything you earn by playing.": "排行榜新增反作弊保護：伺服器會確認每筆成績都來自實際遊玩，但不會因此扣除你遊玩獲得的獎勵。",
  "Records over 35 minutes have been removed from the leaderboard: with the Judgment of Arceus they are no longer possible.": "已移除排行榜中超過 35 分鐘的紀錄；在阿爾宙斯的審判機制下，這些成績已不可能達成。",
  "Moderación": "排行榜管理",
  "Reportes": "檢舉紀錄",
  "Cuentas marcadas": "已標記帳號",
  "¿Quitar del ranking TODAS las marcas de más de 35 minutos (todas las tablas)? No se puede deshacer.": "確定要從所有排行榜移除全部超過 35 分鐘的紀錄嗎？此操作無法復原。",
  "Revisando {x} / {x}…": "檢查中：{x}／{x}…",
  "Quitadas {x} marcas de más de 35 min ({x} tablas)": "已移除 {x} 筆超過 35 分鐘的紀錄（共 {x} 個排行榜）",
  "No se pudo: {x}": "操作失敗：{x}",
  "Quitar marcas de más de 35 min": "移除超過 35 分鐘的紀錄",
  "No se pudo cargar ({x}).": "無法載入（{x}）。",
  "No hay reportes.": "目前沒有檢舉紀錄。",
  "veces reportada": "被檢舉次數",
  "ya no está en el top 50": "已不在前 50 名",
  "Más de 33 min: casi imposible con la Sentencia de Arceus": "超過 33 分鐘：在阿爾宙斯的審判中幾乎不可能達成",
  "Borrar marca": "刪除紀錄",
  "Marca borrada": "已刪除紀錄",
  "Banear": "禁止上榜",
  "¿Banear a {x}? No podrán volver a salir en el ranking y se borra su marca.": "確定要禁止 {x} 上榜嗎？他們將無法再登上排行榜，現有紀錄也會被刪除。",
  "Baneado": "已禁止上榜",
  "Descartar": "駁回",
  "Reporte descartado": "已駁回檢舉",
  "No hay cuentas marcadas.": "目前沒有已標記帳號。",
  "Desmarcar": "解除標記",
  "Desmarcada": "已解除標記",
  "Forgot your password?": "忘記密碼？",
  "Afraid of losing your account?": "擔心帳號找不回來？",
  "Link my Gmail": "連結我的 Gmail",
  "Don't ask again": "不要再詢問",
  "Gmail linked! If you forget your password, sign in with Google.": "已連結 Gmail！若忘記密碼，可以使用 Google 登入。",
  "That Gmail already has its own game account. Use another Gmail.": "這個 Gmail 已有另一個遊戲帳號，請改用其他 Gmail。",
  "Sign in first.": "請先登入。",
  "Recover your account with Gmail": "透過 Gmail 找回帳號",
  "If you play with a name and password, you can link your Gmail: if you ever forget your password, sign in with Google and it is the same account. We offer it when you sign in.": "使用名稱和密碼登入的玩家，可以連結 Gmail；之後若忘記密碼，使用 Google 登入就能回到同一個帳號。登入時會出現連結提示。",
  "Gacha pulls, new Pokémon and rewards are saved to the cloud right away. If you opened the game on another device or browser and something was missing, open it again where you got it: it comes back on its own.": "扭蛋結果、新獲得的寶可夢和獎勵，現在都會立即儲存至雲端。若在其他裝置或瀏覽器開啟遊戲時發現內容缺少，請回到原本獲得它們的裝置或瀏覽器重新開啟遊戲，就會自動恢復。",
  "Si vinculaste tu Gmail, pulsa": "若已連結 Gmail，請使用該 Gmail 按下",
  "con ese Gmail: es tu misma cuenta. Si no lo vinculaste, no se puede recuperar: crea una cuenta nueva (y esta vez vincula tu Gmail desde el aviso que sale al entrar).": "，即可回到原本的帳號。若未連結，便無法找回帳號；請建立新帳號，並在登入後出現的提示中連結 Gmail。",
  "Vincula tu Gmail: si un día olvidas la contraseña, pulsas": "連結 Gmail 後，若忘記密碼，只要按下",
  "y es tu misma cuenta, con todo lo tuyo.": "，即可登入原帳號，保留所有資料。",
  "¿Quitar del ranking TODAS las marcas de más de 1 hora (todas las tablas)? No se puede deshacer.": "確定要從所有排行榜移除全部超過 1 小時的紀錄嗎？此操作無法復原。",
  "Quitadas {x} marcas de más de 1 hora ({x} tablas)": "已移除 {x} 筆超過 1 小時的紀錄（共 {x} 個排行榜）",
  "Quitar marcas de más de 1 hora": "移除超過 1 小時的紀錄",
  "Baneados": "已禁止上榜的帳號",
  "No hay cuentas baneadas.": "目前沒有被禁止上榜的帳號。",
  "Desbanear": "恢復上榜資格",
  "Desbaneada": "已恢復上榜資格",
  "The weekly and monthly leaderboards start from scratch, like the all-time one: now only runs with the Judgment of Arceus count, and all boards match each other.": "每週與每月排行榜和總排行榜一樣重新開始計算，現在只計入採用阿爾宙斯審判機制的遊戲紀錄，讓各排行榜的計算標準一致。",
  "Co-op: the game no longer freezes with each player waiting for the other to choose. An item and the level-up cards no longer cover each other, and if the connection drops a message it fixes itself.": "合作模式：修正玩家互相等待對方選擇，導致遊戲停住的問題。道具與升級卡片不再互相遮擋；連線若漏傳訊息，也能自動恢復。",
  "Co-op: after coming back from a rift, players who are not the host can see every enemy again (some used to be invisible, with only their attacks showing).": "合作模式：從裂縫返回後，非房主玩家也能正常看見所有敵人；先前部分敵人會隱形，只看得到牠們的攻擊。",
  "Friends: if your phone or computer has the wrong time (or time zone), your friends no longer always show as offline and their invitations reach you.": "好友功能：即使手機或電腦的時間、時區設定不正確，好友也不會一直顯示為離線，並能正常收到好友邀請。",
  "con ese Gmail: es tu misma Account. Si no lo vinculaste, no se puede recuperar: crea una Account nueva (y esta vez vincula tu Gmail desde el aviso que sale al Log in).": "，即可回到原本的帳號。若未連結，便無法找回帳號；請建立新帳號，並在登入後出現的提示中連結 Gmail。",
  "Vincula tu Gmail: si un día olvidas la Password, pulsas": "連結 Gmail 後，若忘記密碼，只要按下",
  "y es tu misma Account, con todo lo tuyo.": "，即可登入原帳號，保留所有資料。",
  "¿Remove del Leaderboard TODAS las marcas de más de 1 hora (todas las tablas)? No se puede deshacer.": "確定要從所有排行榜移除全部超過 1 小時的紀錄嗎？此操作無法復原。",
  "Remove marcas de más de 1 hora": "移除超過 1 小時的紀錄",
  "PokéSurvivor: Pokemon Survivor Game Guide & Pokédex": "PokéSurvivor：生存遊戲攻略與寶可夢圖鑑",
  "PokéSurvivor: Play the Pokemon Survivor Game Online": "PokéSurvivor：線上遊玩寶可夢生存遊戲",
  "Play PokéSurvivor — the Pokemon Survivor Game": "遊玩 PokéSurvivor：寶可夢生存遊戲",
  "Skip to content": "跳至主要內容",
  "Home": "首頁",
  "Type": "系",
  "Types": "系別",
  "Tipo": "系",
  "Tipos": "系別",
  "Tier list": "強度排行",
  "Play free": "免費遊玩",
  "Free fan game · runs in your browser": "免費同人遊戲 · 使用瀏覽器遊玩",
  "survival guide, Pokédex and type chart": "生存攻略、寶可夢圖鑑與系別相剋表",
  "Play PokéSurvivor free": "免費遊玩 PokéSurvivor",
  "Start with the beginner guide": "先看新手攻略",
  "playable Pokémon": "隻可用寶可夢",
  "regions, Kanto to Paldea": "個地區，從關都到帕底亞",
  "moves · 59 evolve": "個招式 · 其中 59 個可進化",
  "rift arenas": "座裂縫競技場",
  "Read the guide": "閱讀攻略",
  "regions": "個地區",
  "starters": "隻初始夥伴",
  "Browse the Pokédex": "瀏覽寶可夢圖鑑",
  "evolvable": "個可進化招式",
  "See all moves": "查看全部招式",
  "arenas": "座競技場",
  "Legendaries & arenas": "傳說寶可夢與競技場",
  "Open the type chart": "查看系別相剋表",
  "Generation": "世代",
  "Everything on this site": "網站導覽",
  "Open the Pokédex": "開啟寶可夢圖鑑",
  "See the arenas": "查看競技場",
  "Browse moves": "瀏覽招式",
  "Ready to try a run?": "準備好開始一局了嗎？",
  "PokéSurvivor Guide": "PokéSurvivor 攻略",
  "Fan project notice": "同人作品聲明",
  "Open menu": "開啟選單",
  "Close menu": "關閉選單",
  "· Los repetidos dan Pokémonedas. Los shiny no se repiten.": "· 重複的寶可夢會轉換成寶可幣；閃光寶可夢不會重複。",
  "· Los tickets se consiguen jugando: algunos Pokémon los sueltan al caer, y los jefes y los legendarios de las grietas, a veces, tickets ×10.": "· 遊玩即可獲得抽獎券：部分寶可夢被擊敗時會掉落，頭目和裂縫中的傳說寶可夢有時會掉落十連抽獎券。",
  "Pausa: {x} está eligiendo…": "已暫停：{x} 正在選擇…",
  "Pausa: {x} están eligiendo…": "已暫停：{x} 正在選擇…",
  "El juego ha fallado: tu partida se ha guardado hasta aquí": "遊戲發生錯誤：已儲存本局截至目前的進度",
  "Pausa: esperando a {x} (anfitrión)…": "已暫停：正在等待房主 {x}…",
  "Novedades": "更新公告",
  "Hay una versión nueva del juego: actualizando en {x} s…": "遊戲有新版本：將於 {x} 秒後更新…",
  "No se pudo conectar (reintentando…)": "無法連線（正在重試…）",
  "No se puede conectar con algún amigo: su red (o la tuya) no deja jugar en grupo. Probad con otra wifi o datos móviles; se reintenta solo.": "無法連上部分好友：對方或你的網路不允許多人連線。請改用其他 Wi-Fi 或行動網路；系統會自動重試。",
  "Ahora mismo no se pueden crear cuentas nuevas. Si ya tienes cuenta, entra normal; si no, puedes jugar como invitado.": "目前暫停建立新帳號。已有帳號可照常登入；尚無帳號則可先以訪客身分遊玩。",
  "Atajos de movimientos": "招式欄位設定",
  "Elige qué movimiento va siempre en cada hueco (teclas 1-4 o los iconos de abajo), para la memoria muscular. Si aún no tienes tantos movimientos, va al hueco más cercano.": "設定各招式固定使用的欄位（按鍵 1～4 或下方圖示），方便熟悉操作。若目前招式數量不足，會先放入最接近的可用欄位。",
  "Golpe Crítico": "擊中要害",
  "+3% de críticos (x1,5 de daño)": "擊中要害機率 +3%（造成 1.5 倍傷害）",
  "Cambio de cartas": "卡片重抽",
  "+1 cambio de cartas de nivel por run": "每局升級卡片重抽次數 +1",
  "Veto": "招式封鎖",
  "Bloquea 1 movimiento: no te sale en las cartas": "封鎖 1 個招式，使其不再出現在升級卡片中",
  "Elegir ({x})": "選擇（{x}）",
  "Toca los movimientos que no quieres que te salgan en las cartas ({x}). El movimiento de inicio no se puede vetar.": "點選不想出現在升級卡片中的招式（{x}）。起始招式無法封鎖。",
  "Ya tienes {x} vetados: quita uno primero": "已封鎖 {x} 個招式，請先解除其中一個",
  "En iPhone, Safari no deja poner las webs a pantalla completa. Pulsa Compartir y luego \"Añadir a pantalla de inicio\": abriendo el juego desde ese icono se juega a pantalla completa.": "在 iPhone 上，Safari 不允許此網頁直接進入全螢幕。可點選「分享」→「加入主畫面」，再從該圖示以全螢幕開啟遊戲。",
  "Ruinas del Juicio": "審判遺跡",
  "LA SENTENCIA": "審判",
  "DE ARCEUS": "阿爾宙斯",
  "El tiempo se ha agotado…": "時間已到…",
  "¡ARCEUS HA DESCENDIDO!": "阿爾宙斯降臨了！",
  "Es invencible: huye y aguanta todo lo que puedas": "牠無法被擊敗：快逃，盡可能撐下去！",
  "Toca la pantalla para saltar": "點擊螢幕跳過",
  "Pulsa Espacio para saltar": "按空白鍵跳過",
  "¡Huye de Arceus! Es invencible": "快逃離阿爾宙斯！牠無法被擊敗",
  "¡{x} acude a la Sentencia!": "{x} 應審判之召現身！",
  "SENTENCIA · {x} · JEFES {x}": "審判 · {x} · 頭目 {x}",
  "Ante Arceus": "對抗阿爾宙斯",
  "{x} · {x} legendarios": "{x} · {x} 隻傳說寶可夢",
  "{x} · {x} legendario": "{x} · {x} 隻傳說寶可夢",
  "La Sentencia": "審判",
  "Llega a la Sentencia de Arceus (minuto 30).": "抵達阿爾宙斯的審判（第 30 分鐘）。",
  "Ante el Creador": "直面創世者",
  "Aguanta 1 minuto ante Arceus.": "面對阿爾宙斯，存活 1 分鐘。",
  "Desafío divino": "神之試煉",
  "Derrota a 3 legendarios ante Arceus en una partida.": "在同一局面對阿爾宙斯時，擊敗 3 隻傳說寶可夢。",
  "Juzgado": "受審者",
  "Elegido de Arceus": "阿爾宙斯的天選者",
  "¿Olvidaste tu contraseña?": "忘記密碼？",
  "¿Te da miedo perder tu cuenta?": "擔心帳號找不回來？",
  "Vincular mi Gmail": "連結我的 Gmail",
  "No volver a preguntar": "不要再詢問",
  "¡Gmail vinculado! Si olvidas la contraseña, entra con Google.": "已連結 Gmail！若忘記密碼，可以使用 Google 登入。",
  "Ese Gmail ya tiene su propia cuenta del juego. Usa otro Gmail.": "這個 Gmail 已有另一個遊戲帳號，請改用其他 Gmail。",
  "Inicia sesión primero.": "請先登入。",
  "Reportar marca sospechosa": "檢舉可疑紀錄",
  "Ya la has reportado": "你已檢舉過這筆紀錄",
  "Ya has reportado esta marca": "你已檢舉過這筆紀錄",
  "¿Reportar la marca de {x} como trampa?": "要檢舉 {x} 的紀錄涉嫌作弊嗎？",
  "Gracias: la revisaremos": "感謝檢舉，我們會進行審查",
  "Recupera tu cuenta con Gmail": "透過 Gmail 找回帳號",
  "Si juegas con nombre y contraseña, puedes vincular tu Gmail: si un día olvidas la contraseña, entras con Google y es tu misma cuenta. Te lo ofrecemos al entrar.": "使用名稱和密碼登入的玩家，可以連結 Gmail；之後若忘記密碼，使用 Google 登入就能回到同一個帳號。登入時會出現連結提示。",
  "Las tablas de la semana y del mes del ranking empiezan de cero, como el histórico: ahora sólo cuentan partidas con la Sentencia de Arceus y todas las tablas cuadran entre sí.": "每週與每月排行榜和總排行榜一樣重新開始計算，現在只計入採用阿爾宙斯審判機制的遊戲紀錄，讓各排行榜的計算標準一致。",
  "Cooperativo: la partida ya no se queda parada con cada uno esperando a que el otro elija. Un objeto y las cartas de nivel ya no se tapan, y si la conexión pierde un aviso se arregla solo.": "合作模式：修正玩家互相等待對方選擇，導致遊戲停住的問題。道具與升級卡片不再互相遮擋；連線若漏傳訊息，也能自動恢復。",
  "Cooperativo: al volver de una grieta, quien no era el anfitrión ya ve a todos los enemigos (antes algunos eran invisibles y sólo se veían sus ataques).": "合作模式：從裂縫返回後，非房主玩家也能正常看見所有敵人；先前部分敵人會隱形，只看得到牠們的攻擊。",
  "Amigos: si tu móvil u ordenador tiene la hora (o la zona horaria) mal puesta, tus amigos ya no salen siempre desconectados y sus invitaciones te llegan.": "好友功能：即使手機或電腦的時間、時區設定不正確，好友也不會一直顯示為離線，並能正常收到好友邀請。",
  "14 October 2026": "2026 年 10 月 14 日",
  "14 de octubre de 2026": "2026 年 10 月 14 日",
  "La Sentencia de Arceus": "阿爾宙斯的審判",
  "La Sentencia de Arceus: al llegar al minuto 30, Arceus baja del cielo y te lleva a las Ruinas del Juicio. Es invencible, te persigue cada vez más deprisa y lanza pilares de luz, rayos y ondas; si te toca, te quita casi media vida. Cada 5 segundos acude un legendario con el doble de vida y de daño que el anterior. ¿Cuánto aguantarás?": "阿爾宙斯的審判：到達第 30 分鐘時，阿爾宙斯會從天而降，將你帶往審判遺跡。牠無法被擊敗，追趕速度會越來越快，還會施放光柱、光束與衝擊波；一旦碰到牠，就會損失將近一半體力。每隔 5 秒會有一隻傳說寶可夢加入，體力與傷害都是前一隻的兩倍。你能撐多久？",
  "Tres logros nuevos: La Sentencia (llega al minuto 30), Ante el Creador (aguanta 1 minuto ante Arceus) y Desafío divino (derrota a 3 legendarios ante Arceus en una partida).": "新增三項成就：「審判」（抵達第 30 分鐘）、「直面創世者」（面對阿爾宙斯存活 1 分鐘）及「神之試煉」（在同一局面對阿爾宙斯時擊敗 3 隻傳說寶可夢）。",
  "Música nueva para la pelea contra Arceus.": "新增對抗阿爾宙斯時的戰鬥音樂。",
  "Botón para reportar marcas sospechosas en el ranking (la banderita de cada fila).": "排行榜新增可疑紀錄檢舉按鈕（每列的小旗子）。",
  "El ranking histórico empieza de cero: ahora que las partidas acaban ante Arceus, las marcas de antes ya no se podrían alcanzar. Las tablas de hoy, de la semana y del mes siguen igual.": "歷史排行榜重新開始：現在戰局會在對抗阿爾宙斯的階段結束，舊紀錄已無法再達成，因此重置歷史榜。每日、每週與每月排行榜保持不變。",
  "Se quita el tiempo extra del minuto 60 (ya no se llega hasta ahí).": "移除第 60 分鐘起的延長戰局機制，因為現在已無法存活到那個階段。",
  "Desde el minuto 28 ya no se abren grietas, para que la Sentencia no te pille dentro de una.": "從第 28 分鐘起不再開啟裂縫，避免審判開始時玩家仍在裂縫中。",
  "Ranking protegido contra trampas: el servidor comprueba que cada marca se ha jugado de verdad. Nunca se pierde nada de lo que ganas jugando.": "排行榜新增反作弊保護：伺服器會確認每筆成績都來自實際遊玩，但不會因此扣除你遊玩獲得的獎勵。",
  "Se han quitado del ranking las marcas de más de 35 minutos: con la Sentencia de Arceus ya no son posibles.": "已移除排行榜中超過 35 分鐘的紀錄；在阿爾宙斯的審判機制下，這些成績已不可能達成。",
  "Las tiradas del gacha, los Pokémon nuevos y los premios se guardan en la nube al momento. Si abriste el juego en otro aparato o navegador y te faltaba algo, vuelve a abrirlo donde lo conseguiste: se recupera solo.": "扭蛋結果、新獲得的寶可夢和獎勵，現在都會立即儲存至雲端。若在其他裝置或瀏覽器開啟遊戲時發現內容缺少，請回到原本獲得它們的裝置或瀏覽器重新開啟遊戲，就會自動恢復。",
  "13 October 2026": "2026 年 10 月 13 日",
  "13 de octubre de 2026": "2026 年 10 月 13 日",
  "Tiempo extra y grietas con menos azar": "延長戰局與裂縫出現機制調整",
  "Tiempo extra: desde el minuto 60 los Pokémon salvajes se vuelven cada vez más fuertes (más vida y más daño), y cada vez más deprisa. Antes, con las mejoras al máximo, algunas partidas no acababan nunca; ahora las mejores rondarán la hora y media.": "延長戰局：從第 60 分鐘起，野生寶可夢的體力與傷害會不斷提高，成長速度也會越來越快。先前強化全滿後，有些戰局幾乎不會結束；調整後，表現最好的戰局預計約可持續一個半小時。",
  "El juego se actualiza solo cuando sale una versión nueva: si estás en el menú, a los 5 segundos; si estás jugando, al acabar la partida (sin perder nada).": "推出新版本時，遊戲會自動更新：停留在選單時會在 5 秒內更新；正在遊玩時則等本局結束後更新，不會遺失進度與獎勵。",
  "Botón de Novedades (esta ventana) con todos los cambios del juego.": "新增「更新公告」按鈕（就是這個視窗），可查看遊戲的各項更新。",
  "Números más fáciles de leer: el 2, el 5 y el 8 ya no se confunden.": "改善數字字型，讓 2、5、8 更容易分辨。",
  "Elige la versión normal o shiny de tu compañero desde el menú principal, debajo de él.": "可直接在主選單的夥伴下方，切換一般或閃光外觀。",
  "Mejoras nuevas para cada Pokémon: Golpe Crítico (+3 % de críticos por nivel, que hacen x1,5 de daño), Cambio de cartas (+1 cambio de las cartas de nivel por run) y Veto (bloquea movimientos para que no te salgan en las cartas; se eligen en Mejoras).": "各寶可夢新增強化項目：「擊中要害」（每級提高 3% 擊中要害機率，造成 1.5 倍傷害）、「卡片重抽」（每局升級卡片重抽次數 +1）及「招式封鎖」（在強化頁選擇招式，使其不再出現在升級卡片中）。",
  "Atajos de movimientos (en Mejoras, para cada Pokémon): elige qué movimiento va siempre en cada hueco, por ejemplo Confusión siempre en el 1, para la memoria muscular.": "招式欄位設定：可在各寶可夢的強化頁設定招式固定使用的欄位，例如將「念力」固定在第 1 格，方便熟悉操作。",
  "Avalancha hace menos daño (21 en vez de 26): derrotaba casi el doble que la media de los movimientos.": "「岩崩」傷害從 26 下調為 21；原本的擊敗數量接近一般招式的兩倍。",
  "Los cambios de cartas de nivel ya no se ganan venciendo jefes: tienes 1 gratis por run y el resto se compra en Mejoras.": "擊敗頭目不再增加升級卡片的重抽次數。每局有 1 次免費重抽，可在強化頁購買額外次數。",
  "Los legendarios de grieta ya no dan siempre tickets x10: dan uno la mitad de las veces (antes daban 2 siempre y salían demasiados).": "裂縫中的傳說寶可夢不再必定掉落十連抽獎券，改為 50% 機率掉落 1 張；先前必定掉落 2 張，數量過多。",
  "Cooperativo: si vuestras redes no consiguen conectar entre sí, la sala lo avisa y lo reintenta sola, en vez de jugar a tirones por un servidor lento.": "多人合作：若彼此的網路無法直接連線，房間會顯示提示並持續重試，不再改用速度較慢的伺服器而造成遊戲卡頓。",
  "Hemos cambiado de servidores para que el juego siga siendo gratis: puede que tengas que volver a iniciar sesión (con la misma cuenta y contraseña, o con Google). Tu partida y tus Pokémon siguen igual.": "為了讓遊戲持續免費營運，已搬遷至新的伺服器。你可能需要以原帳號密碼或 Google 重新登入；存檔與寶可夢不受影響。",
  "Gacha: los shiny ya no salen repetidos. Si te toca uno que ya tienes, sale otro de la misma rareza que te falte.": "扭蛋：閃光寶可夢不再重複。若抽到已擁有的閃光寶可夢，會改成同稀有度、尚未擁有的閃光寶可夢。",
  "Grietas con menos azar: cada vez que no sale una, la siguiente es más probable (como mucho 2,5 minutos sin grieta).": "調整裂縫出現機制：每次未出現裂縫，下次出現的機率就會提高，最長不會超過 2.5 分鐘沒有裂縫。",
  "Los legendarios que aún no has vencido salen 4 veces más en las grietas.": "尚未擊敗的傳說寶可夢，在裂縫中的出現機率提高為 4 倍。",
  "Los curanderos curan más cuanto más fuerte pegas, pero cada vez menos y con un tope (como mucho el 2,5x).": "你的攻擊越強，治療型敵人的回復量也越高，但增幅會逐漸減少，最高為原本的 2.5 倍。",
  "Ataques cuerpo a cuerpo más fuertes: mientras llevas uno activo recibes un 25 % menos de daño, llegan un 25 % más lejos y hacen un 20 % más de daño.": "強化近戰招式：啟用近戰招式時，受到的傷害減少 25%；近戰攻擊距離增加 25%，傷害提高 20%。",
  "Cooperativo: al elegir con qué objeto quedarte, la partida se para para todos (antes seguía y te pegaban mientras elegías).": "多人合作：選擇要保留的攜帶道具時，所有玩家都會暫停；先前遊戲仍會繼續，選擇途中可能遭到攻擊。",
  "Cooperativo: mientras alguien elige una fusión, la partida se para para todos.": "多人合作：有人正在選擇融合招式時，所有玩家都會暫停。",
  "Cooperativo: si el anfitrión cambia de pestaña o se le para el juego, la partida se pausa para todos hasta que vuelva.": "多人合作：房主切換分頁或遊戲停頓時，所有玩家都會暫停，直到房主恢復遊戲。",
  "Las runs de menos de 1 minuto ya no cuentan para el ranking.": "未滿 1 分鐘的戰局不再計入排行榜。",
  "Quitadas del ranking las marcas rotas por el fallo del minuto 84 (el reloj seguía corriendo con el juego parado) y alguna imposible. Si tenías una, tu próxima partida vuelve a contar.": "移除排行榜中由第 84 分鐘錯誤造成的異常紀錄（遊戲停住但計時仍持續），以及部分不可能達成的紀錄。若你的紀錄受到影響，下一局即可重新計入。",
  "iPhone (Safari y Chrome): a veces no se podía cambiar de movimiento tocando los iconos, sobre todo con el otro dedo en el joystick. Además los botones quedan por encima de la barra de inicio.": "修正 iPhone 的 Safari 與 Chrome 有時無法點選圖示切換招式的問題，尤其是另一根手指正操作搖桿時。按鈕位置也已調整至底部主畫面橫條上方。",
  "En las partidas de más de 84 minutos la pantalla se quedaba en negro, el juego se paraba o empezabas a subir de nivel sin fin. Ya puedes jugar todo lo que aguantes.": "修正戰局超過 84 分鐘後黑畫面、遊戲停住或無限升級的問題。現在只要能存活，就能繼續遊玩。",
  "Si el juego fallara, la partida se cierra sola y se guarda (tiempo, derrotados, récords y ranking) en vez de perderse.": "若遊戲發生錯誤，會自動結束本局並儲存存活時間、擊敗數、個人紀錄及排行榜成績，避免整局進度遺失。",
  "Las partidas muy largas a veces se tomaban por trampas y no contaban para el ranking.": "修正長時間戰局有時被誤判為作弊，導致成績未計入排行榜的問題。",
  "Cooperativo: si el anfitrión cambiaba de pestaña, los enemigos se quedaban quietos y los demás jugaban con ventaja.": "修正多人合作時房主切換分頁後，敵人停住、其他玩家卻仍可繼續行動的問題。",
  "iPhone: mantener el dedo en el joystick sacaba \"Copiar / Seleccionar todo\".": "修正 iPhone 長按搖桿時出現「拷貝／全選」選單的問題。",
  "iPhone: a veces no salía la pantalla completa. Ahora el botón explica cómo tenerla (Compartir y \"Añadir a pantalla de inicio\").": "修正 iPhone 有時不顯示全螢幕按鈕的問題。現在按鈕會提示如何使用全螢幕（「分享」→「加入主畫面」）。",
  "12 October 2026": "2026 年 10 月 12 日",
  "12 de octubre de 2026": "2026 年 10 月 12 日",
  "Vínculos": "羈絆",
  "Vínculos: al vencer a un legendario fusionas movimientos que se lanzan a la vez desde un solo hueco (hasta 4).": "羈絆：擊敗傳說寶可夢後，可以融合招式，讓同一欄位同時施放最多 4 個招式。",
  "Botón para cambiar las cartas de subir de nivel.": "新增升級卡片重抽按鈕。",
  "Más grietas.": "增加裂縫出現頻率。",
  "Movimientos psíquicos y curanderos más flojos.": "下調超能力系招式與治療型敵人的強度。",
  "Las mejoras de las cartas de nivel (velocidad, recarga, experiencia, imán, coraza y potencia) tienen un tope de veces.": "升級卡片中的速度、冷卻、經驗、磁力、防禦與威力強化，新增選取次數上限。",
  "En el móvil, la ficha del Pokémon sale al lado; entrar es más rápido y el gacha x10 se puede cerrar.": "手機版寶可夢詳細資料改為顯示在旁邊；登入速度更快，十連扭蛋畫面也可以關閉。",
  "Pantalla negra en partidas de más de una hora por llenarse la memoria de imágenes.": "修正遊玩超過一小時後，因圖片記憶體耗盡而黑畫面的問題。",
  "Los tickets se perdían si se cerraba la pestaña antes de acabar la partida: ahora se guardan al cogerlos.": "修正戰局結束前關閉分頁會遺失抽獎券的問題；現在拾取時就會立即儲存。",
  "Una mejora comprada justo después de guardar se cobraba y no se apuntaba.": "修正剛存檔後購買強化，扣款卻未套用強化的問題。",
  "El juego se quedaba congelado para siempre si algo fallaba a mitad de partida.": "修正戰局途中發生錯誤後，遊戲永久停住的問題。",
  "11 October 2026": "2026 年 10 月 11 日",
  "11 de octubre de 2026": "2026 年 10 月 11 日",
  "Más reto": "更具挑戰性",
  "Jefes y legendarios con 4 ataques avisados que se enfurecen a media vida.": "頭目與傳說寶可夢擁有 4 種附帶預警的攻擊，體力降至一半時會進入狂暴狀態。",
  "12 movimientos nuevos y 8 formas de atacar nuevas: bumerán, cadena, minas, meteoros, torreta, embestida, rastro y abanico.": "新增 12 個招式與 8 種攻擊形式：迴旋、連鎖、地雷、隕石、砲塔、衝刺、軌跡及扇形攻擊。",
  "Eventos a mitad de partida (hordas de un tipo, hora dorada, Pokémon perdidos) y Meowth y Gholdengo que huyen cargados de monedas.": "新增戰局事件（單一系群襲、黃金時段、迷路的寶可夢），以及攜帶大量金幣逃跑的喵喵與賽富豪。",
  "Estatuas para los Pokémon grandes.": "為大型寶可夢新增雕像。",
  "Más difícil: menos enemigos pero más duros.": "提高難度：敵人數量減少，但實力更強。",
  "Subir de nivel es más lento, los tickets son más raros y los jefes dan ticket x10 una de cada tres veces.": "升級速度降低，抽獎券更稀有；頭目有三分之一機率掉落 1 張十連抽獎券。",
  "Carga más rápida.": "加快載入速度。",
  "Los enemigos rezagados desaparecían delante de ti: ahora sólo fuera de la vista.": "修正落後的敵人在眼前消失的問題；現在只會在畫面外移除。",
  "Los menús y pantallas se montaban encima de la barra de arriba.": "修正選單與介面覆蓋頂部工具列的問題。",
  "10 October 2026": "2026 年 10 月 10 日",
  "10 de octubre de 2026": "2026 年 10 月 10 日",
  "Móvil e inglés": "手機版與英文版",
  "Se puede jugar en móvil y tablet con joystick táctil, e instalar como app.": "支援手機與平板觸控搖桿操作，並可加入主畫面，像 App 一樣開啟。",
  "El juego, en español y en inglés.": "遊戲提供英文與西班牙文。",
  "Pantalla de ajustes con calidad gráfica automática.": "新增設定頁面與自動畫質調整。",
  "Menos enemigos en pantalla pero más fuertes.": "畫面中的敵人數量減少，但實力更強。",
  "Gigadrenado pasa a ser Hierba Lazo (ya no cura).": "「終極吸取」改為「打草結」，不再回復體力。",
  "9 October 2026": "2026 年 10 月 9 日",
  "9 de octubre de 2026": "2026 年 10 月 9 日",
  "Misiones, grietas y cooperativo": "任務、裂縫與多人合作",
  "Misiones diarias y semanales, logros con medallas y títulos, y perfil público.": "新增每日與每週任務、附帶獎章與稱號的成就，以及公開個人檔案。",
  "Objetos equipables, evoluciones de movimientos y enemigos que curan, protegen, invocan o explotan.": "新增攜帶道具、招式進化，以及會治療、提供護盾、召喚或爆炸的敵人。",
  "Grietas que llevan a 18 arenas legendarias, una por tipo, y clima que cambia la batalla.": "新增通往 18 座傳說競技場的裂縫（各系一座），以及會影響戰鬥的天氣。",
  "Cooperativo con tu lista de amigos y ranking.": "新增好友名單、多人合作與排行榜。",
  "Mejoras para cada Pokémon, gacha tragaperras con tickets y tabla de tipos.": "新增各寶可夢的強化系統、使用抽獎券的拉霸式扭蛋，以及系相剋表。",
  "Cámara más lejos y enemigos que rodean los obstáculos.": "拉遠鏡頭，敵人也會繞過障礙物。",
  "8 October 2026": "2026 年 10 月 8 日",
  "8 de octubre de 2026": "2026 年 10 月 8 日",
  "Primera versión": "首個版本",
  "Primera versión pública de PokéSurvivor.": "PokéSurvivor 首次公開發佈。",
  "7 October 2026": "2026 年 10 月 7 日",
  "7 de octubre de 2026": "2026 年 10 月 7 日"
};
  const exact = new Map(), lower = new Map(), fragments = new Map(), patterns = [];
  const cache = new Map(), translatedNodes = new WeakMap();
  const originalTexts = new Map(), originalAttributes = new Map(), originalRoots = new Map();
  let originalTitle = null;
  const literalCaptures = new Set([
    '¿Reportar la marca de {x} como trampa?', "Report {x}'s record as cheating?",
    '¿Banear a {x}? No podrán volver a salir en el ranking y se borra su marca.'
  ]);
  const escapeRE = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  for (const [source, target] of Object.entries(DICT)) {
    if (!target || source === target) continue;
    if (source.includes('{x}')) {
      patterns.push({ re: new RegExp('^' + source.split('{x}').map(escapeRE).join('(.+?)') + '$', 'iu'), target, literal: literalCaptures.has(source) });
    } else {
      exact.set(source, target);
      lower.set(source.toLowerCase(), target);
      if (source.length >= 4 || /\s/.test(source)) fragments.set(source.toLowerCase(), target);
    }
  }
  const fragmentRE = new RegExp('(?<![\\p{L}\\p{N}])(' + [...fragments.keys()].sort((a,b) => b.length-a.length).map(escapeRE).join('|') + ')(?![\\p{L}\\p{N}])', 'giu');
  function translate(s, depth = 0) {
    if (typeof s !== 'string' || !/[A-Za-zÀ-ž]/u.test(s) || depth > 8) return s;
    if (cache.has(s)) return cache.get(s);
    const [, lead, middle, tail] = /^(\s*)([\s\S]*?)(\s*)$/.exec(s);
    const body = middle.replace(/\s+/g, ' ');
    let result = exact.get(body) ?? lower.get(body.toLowerCase());
    if (result === undefined) {
      for (const p of patterns) {
        const match = p.re.exec(body);
        if (!match) continue;
        let i = 1;
        result = p.target.replace(/\{x\}/g, () => p.literal ? match[i++] : translate(match[i++], depth + 1));
        break;
      }
    }
    if (result === undefined) result = body.replace(fragmentRE, word => fragments.get(word.toLowerCase()) || word);
    const output = result === body ? s : lead + result + tail;
    if (cache.size > 5000) cache.clear();
    cache.set(s, output);
    return output;
  }
  // Psychic is both a type (超能力) and a move (精神強念).
  // Resolve by presentation context without editing the game's move database.
  function moveText(s) {
    return typeof s === 'string' ? s.replace(/(?<![\p{L}\p{N}])(?:Psíquico|Psychic)(?![\p{L}\p{N}])/giu, '精神強念') : s;
  }
  function isMoveElement(el) {
    return !el.closest('.type-chip, .type, .tag-chip') && !!el.closest('.card .nm, #scr-bond .ds, #bond-sub, .move-icons, #starter-info, #dex-detail p, #over-stats b, .bind-slots option, .ban-moves button');
  }
  const typeNames = new Set(['一般','火','水','電','草','冰','格鬥','毒','地面','飛行','超能力','蟲','岩石','幽靈','龍','惡','鋼','妖精']);
  function displayText(s, el) {
    const result = translate(isMoveElement(el) ? moveText(s) : s);
    const typeLabel = el.closest('.type-chip, .type, .tag-chip');
    return typeLabel && typeNames.has(result.trim()) ? result.replace(result.trim(), result.trim() + '系') : result;
  }
  const ATTRS = ['placeholder', 'title', 'alt', 'aria-label'];
  const skipped = el => {
    if (el?.closest('[contenteditable], script, style, code, textarea, input, [data-pszh-control]')) return true;
    const protectedElement = el?.closest('[translate="no"]');
    // Upstream protects its bilingual release notes from its own translator.
    // Only allow this known static announcement container; player names remain protected.
    return !!protectedElement && !protectedElement.matches('#news-body > .news-day[translate="no"]');
  };
  function textNode(node) {
    if (!node.parentElement || skipped(node.parentElement)) return;
    const before = node.nodeValue;
    if (translatedNodes.get(node) === before) return;
    const after = displayText(before, node.parentElement);
    translatedNodes.set(node, after);
    if (after !== before) {
      originalTexts.set(node,{before,after});
      node.nodeValue = after;
    }
  }
  function element(el) {
    if (skipped(el)) return;
    for (const attr of ATTRS) {
      const before = el.getAttribute(attr);
      if (!before) continue;
      const after = displayText(before, el);
      if (before !== after) {
        if (!originalAttributes.has(el)) originalAttributes.set(el,new Map());
        originalAttributes.get(el).set(attr,{before,after});
        el.setAttribute(attr, after);
      }
    }
  }
  function walk(root) {
    if (!root) return;
    if (root.nodeType === Node.TEXT_NODE) return textNode(root);
    if (root.nodeType !== Node.ELEMENT_NODE || skipped(root)) return;
    element(root);
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      if (node.nodeType === Node.TEXT_NODE) textNode(node); else element(node);
    }
  }

    const style = document.createElement('style');
    style.id = 'poke-bot-zh-style';
    style.textContent = 'html[data-poke-bot-zh] { --font: "Microsoft JhengHei", "PingFang TC", "Noto Sans TC", system-ui, sans-serif; } html[data-poke-bot-zh] .btn {letter-spacing:0} html[data-poke-bot-zh] .sub {line-height:1.55}';
    function maintain() {
      if (!active || !document.documentElement) return;
      const html = document.documentElement;
      if (!originalRoots.has(html)) originalRoots.set(html,{lang:html.getAttribute('lang'),marker:html.getAttribute('data-poke-bot-zh')});
      // Do not retain discarded menus indefinitely in a long run.
      for (const map of [originalTexts,originalAttributes,originalRoots]) {
        for (const node of map.keys()) if (!node.isConnected) map.delete(node);
      }
      if (!style.isConnected && document.head) document.head.appendChild(style);
      if (document.documentElement.lang !== 'zh-Hant') document.documentElement.lang = 'zh-Hant';
      if (document.documentElement.getAttribute('data-poke-bot-zh') !== VERSION) document.documentElement.setAttribute('data-poke-bot-zh',VERSION);
      const title = translate(document.title);
      if (title !== document.title) { originalTitle = {before:document.title,after:title}; document.title = title; }
      const box = document.getElementById('login-mode');
      if (box && !document.getElementById('poke-bot-zh-note')) {
        const note = document.createElement('p'); note.id = 'poke-bot-zh-note'; note.dataset.pszhControl = '';
        note.textContent = 'Bot 內建繁體中文已啟用'; note.style.cssText = 'font:12px/1.5 system-ui;color:#b9cbf0;text-align:center';
        box.after(note);
      }
    }
    const observer = new MutationObserver(records=>{
      if (!active) return;
      for (const m of records) {
        if (m.type === 'characterData') textNode(m.target);
        else if (m.type === 'attributes') element(m.target);
        else for (const node of m.addedNodes) if (node.isConnected) walk(node);
      }
      maintain();
    });
    // Observe the Document, which survives body/documentElement replacement.
    observer.observe(document,{childList:true,subtree:true,characterData:true,attributes:true,attributeFilter:ATTRS});
    walk(document.body); maintain();
    const proto = window.CanvasRenderingContext2D?.prototype;
    // If the standalone patch ran first, it already owns these wrappers.
    if (!externalPatch && proto) for (const method of ['fillText','strokeText','measureText']) {
      const original = proto[method];
      if (typeof original !== 'function') continue;
      const wrapped = function(text,...args) {
        const font = this.font;
        if (typeof font === 'string') this.font = font.replace(/Pixelify/g,'"Microsoft JhengHei", "PingFang TC", "Noto Sans TC", sans-serif');
        try { return original.call(this,translate(typeof text === 'string' && /^(?:Psíquico|Psychic)(?: \+\d+)?$/iu.test(text.trim()) ? moveText(text) : text),...args); }
        finally { if (typeof font === 'string') this.font = font; }
      };
      proto[method] = wrapped;
      restorers.push(()=>{if(proto[method]===wrapped)proto[method]=original;});
    }
    if (!externalPatch) for (const method of ['alert','confirm']) {
      const original = window[method];
      if (typeof original !== 'function') continue;
      const wrapped = function(text){return original.call(window,translate(text));};
      window[method] = wrapped;
      restorers.push(()=>{if(window[method]===wrapped)window[method]=original;});
    }
    function refresh(g) {
      if (!active) return;
      maintain();
      const judgment = g?.Judgment;
      if (!judgment?.drawOverlay || judgmentHook) return;
      boundGame = g; originalJudgment = judgment.drawOverlay;
      judgmentHook = function(...args) {
        const i18n = g.I18n;
        if (!i18n?.t) return originalJudgment.apply(this,args);
        const original = i18n.t;
        const titles = {'LA SENTENCIA':'阿爾宙斯的','DE ARCEUS':'審判'};
        i18n.t = function(s,...rest){return titles[s] ?? original.call(this,s,...rest);};
        try {return originalJudgment.apply(this,args);} finally {i18n.t=original;}
      };
      judgment.drawOverlay = judgmentHook;
    }
    return {refresh, externalPatch, destroy() {
      if (!active) return;
      active=false; observer.disconnect(); style.remove(); document.getElementById('poke-bot-zh-note')?.remove();
      for (const [node,{before,after}] of originalTexts) if (node.isConnected && node.nodeValue === after) node.nodeValue = before;
      for (const [el,attrs] of originalAttributes) if (el.isConnected) {
        for (const [attr,{before,after}] of attrs) if (el.getAttribute(attr) === after) el.setAttribute(attr,before);
      }
      if (originalTitle && document.title === originalTitle.after) document.title = originalTitle.before;
      for (const [html,original] of originalRoots) if (html.isConnected) {
        if (html.lang === 'zh-Hant') { if (original.lang == null) html.removeAttribute('lang'); else html.setAttribute('lang',original.lang); }
        if (html.getAttribute('data-poke-bot-zh') === VERSION) {
          if (original.marker == null) html.removeAttribute('data-poke-bot-zh'); else html.setAttribute('data-poke-bot-zh',original.marker);
        }
      }
      originalTexts.clear(); originalAttributes.clear(); originalRoots.clear();
      for (const restore of restorers) restore();
      if (boundGame?.Judgment.drawOverlay === judgmentHook) boundGame.Judgment.drawOverlay = originalJudgment;
      if (window[sharedMarker] === owner) delete window[sharedMarker];
    }};
  }

  localization = settings.chinese ? installChinese() : null;
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
        manualPoints:settings.manualPoints, chinese:!!localization, externalChinesePatch:!!localization?.externalPatch, background:settings.background, backgroundFrames:backgroundRunner?.frames || 0, injectionState, damage:{...damagePlan,fastClear:fastClear(),buildStep:game?.Game.player ? buildStep(game.Game.player) : null}, documentState:document.readyState || 'unknown', missing:missingInterface(candidate), captureIssue, error};
    },
    reload: reloadBot,
    handoff() {
      const state = { game: game || capturedGame, offers, offered, bondChoice, rerollState, settings: { ...settings } };
      api.destroy();
      return state;
    },
    destroy() {
      if (panelDrag) finishPanelDrag({pointerId:panelDrag.id});
      removeEventListener('resize',onPanelResize); removeEventListener('orientationchange',onPanelResize);
      window.visualViewport?.removeEventListener('resize',onPanelResize);
      window.visualViewport?.removeEventListener('scroll',onPanelResize);
      stopped = true; clearInterval(timer); releaseCapture(); capturedGame = null; captureCandidates.length = 0; vector = [0, 0]; root.remove();
      detachHooks(); localization?.destroy(); backgroundRunner?.destroy();
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
