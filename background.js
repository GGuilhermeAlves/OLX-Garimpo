// OLX Garimpo — service worker
// Vigia buscas da OLX (ordenadas por "mais recentes" e por "menor preço"),
// guarda o preço de cada anúncio e avisa quando aparece um novo ou quando o preço baixa.

const ALARM = 'olx-garimpo-scan';
const MAX_EVENTS = 300;
const MAX_PAGES_CHEAPEST = 5;   // páginas de "menor preço" lidas por busca (50 anúncios cada)
const SEEN_TTL_DAYS = 60;

const DEFAULT_SETTINGS = {
  intervalMin: 5,
  ntfyTopic: '',
  notifyDesktop: true,
  requireInteraction: true,
};

const DEFAULT_WATCH = {
  name: 'MacBook Air M4',
  url: 'https://www.olx.com.br/informatica/notebooks?q=macbook%20air%20m4&opst=2',
  min: 3000,
  max: 5600,
  include: 'm4',
  exclude: 'compro, troco por, defeito, quebrado, peças, placa, m1, m2, m3',
  enabled: true,
};

// ---------------------------------------------------------------- storage helpers
const get = (keys) => chrome.storage.local.get(keys);
const set = (obj) => chrome.storage.local.set(obj);

async function getSettings() {
  const { settings } = await get('settings');
  return { ...DEFAULT_SETTINGS, ...(settings || {}) };
}

function uid() {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

// ---------------------------------------------------------------- setup / schedule
chrome.runtime.onInstalled.addListener(async () => {
  const { watches } = await get('watches');
  if (!watches) {
    await set({
      watches: [{ ...DEFAULT_WATCH, id: uid(), createdAt: Date.now(), baselineDone: false }],
      seen: {},
      events: [],
      settings: DEFAULT_SETTINGS,
    });
  }
  await schedule();
  scanAll('install');
});

chrome.runtime.onStartup.addListener(async () => {
  await schedule();
  scanAll('startup');
});

async function schedule() {
  const s = await getSettings();
  const period = Math.max(1, Number(s.intervalMin) || 5);
  await chrome.alarms.clear(ALARM);
  chrome.alarms.create(ALARM, { delayInMinutes: period, periodInMinutes: period });
}

chrome.alarms.onAlarm.addListener((a) => {
  if (a.name === ALARM) scanAll('alarm');
});

// ---------------------------------------------------------------- messages from popup
chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  (async () => {
    switch (msg && msg.type) {
      case 'scanNow':
        reply(await scanAll('manual', msg.watchId));
        break;
      case 'reschedule':
        await schedule();
        reply({ ok: true });
        break;
      case 'markAllRead': {
        const { events = [] } = await get('events');
        events.forEach((e) => (e.read = true));
        await set({ events });
        await updateBadge();
        reply({ ok: true });
        break;
      }
      case 'testNotify':
        await notify([{
          id: 'test-' + Date.now(), type: 'novo', watchName: 'Teste',
          subject: 'Notificação de teste do OLX Garimpo', price: 5199,
          url: 'https://www.olx.com.br', location: 'Funcionou! 🎉',
        }], true);
        reply({ ok: true });
        break;
      case 'resetWatch': {
        const { seen = {}, watches = [] } = await get(['seen', 'watches']);
        delete seen[msg.watchId];
        const w = watches.find((x) => x.id === msg.watchId);
        if (w) w.baselineDone = false;
        await set({ seen, watches });
        reply({ ok: true });
        break;
      }
      default:
        reply({ ok: false });
    }
  })();
  return true; // async reply
});

// ---------------------------------------------------------------- notifications
chrome.notifications.onClicked.addListener(async (notifId) => {
  const { notifMap = {} } = await chrome.storage.session.get('notifMap');
  const url = notifMap[notifId];
  if (url) chrome.tabs.create({ url });
  chrome.notifications.clear(notifId);
});

const brl = (n) => (n == null ? '—' : 'R$ ' + Number(n).toLocaleString('pt-BR'));

function describe(ev) {
  if (ev.type === 'baixou') {
    return {
      title: `📉 Baixou: ${brl(ev.prevPrice)} → ${brl(ev.price)}`,
      tags: ['chart_with_downwards_trend'],
    };
  }
  const extra = ev.oldPrice && ev.oldPrice > ev.price ? ` (era ${brl(ev.oldPrice)})` : '';
  return {
    title: `🆕 ${brl(ev.price)}${extra}`,
    tags: ['new'],
  };
}

async function notify(evs, force = false) {
  if (!evs.length) return;
  const s = await getSettings();
  const { notifMap = {} } = await chrome.storage.session.get('notifMap');

  // até 5 notificações individuais; o resto vira um resumo
  const individual = evs.slice(0, 5);
  const rest = evs.length - individual.length;

  for (const ev of individual) {
    const d = describe(ev);
    const message = `${ev.subject}\n${ev.location || ''} · ${ev.watchName}`;
    if (s.notifyDesktop || force) {
      const nid = 'olxg-' + ev.id;
      notifMap[nid] = ev.url;
      chrome.notifications.create(nid, {
        type: 'basic',
        iconUrl: 'icons/icon128.png',
        title: d.title,
        message,
        priority: 2,
        requireInteraction: !!s.requireInteraction,
      });
    }
    if (s.ntfyTopic) {
      fetch('https://ntfy.sh/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          topic: s.ntfyTopic.trim(),
          title: d.title,
          message,
          click: ev.url,
          tags: d.tags,
          priority: 4,
        }),
      }).catch(() => {});
    }
  }
  if (rest > 0 && s.notifyDesktop) {
    chrome.notifications.create('olxg-more-' + Date.now(), {
      type: 'basic',
      iconUrl: 'icons/icon128.png',
      title: `+${rest} alertas no OLX Garimpo`,
      message: 'Abra a extensão para ver todos.',
      priority: 1,
    });
  }
  // mantém o mapa pequeno
  const keys = Object.keys(notifMap);
  if (keys.length > 200) keys.slice(0, keys.length - 200).forEach((k) => delete notifMap[k]);
  await chrome.storage.session.set({ notifMap });
}

async function updateBadge() {
  const { events = [] } = await get('events');
  const unread = events.filter((e) => !e.read).length;
  chrome.action.setBadgeBackgroundColor({ color: '#f28000' });
  chrome.action.setBadgeText({ text: unread ? String(Math.min(unread, 99)) : '' });
}

// ---------------------------------------------------------------- OLX parsing
// A página de busca da OLX é Next.js (App Router). Os anúncios vêm no "flight data"
// enviado em pedaços via self.__next_f.push([1, "..."]). Juntamos os pedaços e
// recortamos o array "ads":[...].

function flightFromHtml(html) {
  let flight = '';
  const re = /self\.__next_f\.push\(\[1,("(?:[^"\\]|\\.)*")\]\)/g;
  let m;
  while ((m = re.exec(html))) {
    try { flight += JSON.parse(m[1]); } catch (_) { /* ignora pedaço inválido */ }
  }
  return flight;
}

function extractAds(flight) {
  const k = flight.indexOf('"ads":[');
  if (k < 0) return null;
  let i = k + 6, depth = 0, inStr = false, esc = false;
  for (; i < flight.length; i++) {
    const c = flight[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === '[') depth++;
    else if (c === ']') { depth--; if (depth === 0) break; }
  }
  try {
    return JSON.parse(flight.slice(k + 6, i + 1));
  } catch (_) {
    return null;
  }
}

function parsePrice(p) {
  if (p == null) return null;
  const digits = String(p).replace(/,\d{1,2}$/, '').replace(/\D/g, '');
  return digits ? Number(digits) : null;
}

function normalizeAd(a) {
  const img = a.images && a.images[0] ? (a.images[0].originalWebp || a.images[0].original) : null;
  return {
    listId: a.listId,
    subject: (a.subject || a.title || '').replace(/<[^>]+>/g, '').trim(),
    price: parsePrice(a.priceValue || a.price),
    oldPrice: parsePrice(a.oldPrice),
    url: a.url,
    img,
    location: a.location || '',
    adDate: a.date ? a.date * 1000 : null,
    professional: !!a.professionalAd,
    fixedOnTop: !!a.fixedOnTop,
  };
}

// Plano B: se o fetch direto for bloqueado, abre a busca numa aba em segundo plano,
// lê os dados da própria página e fecha a aba.
async function fetchViaTab(url) {
  const tab = await chrome.tabs.create({ url, active: false });
  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => { cleanup(); reject(new Error('timeout')); }, 40000);
      function listener(id, info) {
        if (id === tab.id && info.status === 'complete') { cleanup(); resolve(); }
      }
      function cleanup() { clearTimeout(timer); chrome.tabs.onUpdated.removeListener(listener); }
      chrome.tabs.onUpdated.addListener(listener);
    });
    const [res] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      world: 'MAIN',
      func: () => (self.__next_f || []).filter((x) => x && x[0] === 1).map((x) => x[1]).join(''),
    });
    return extractAds(res && res.result ? res.result : '');
  } finally {
    chrome.tabs.remove(tab.id).catch(() => {});
  }
}

async function fetchAds(url) {
  let ads = null;
  try {
    const r = await fetch(url, { credentials: 'include', headers: { Accept: 'text/html' } });
    if (r.ok) ads = extractAds(flightFromHtml(await r.text()));
  } catch (_) { /* cai no plano B */ }
  if (!ads) ads = await fetchViaTab(url);
  if (!ads) throw new Error('Não consegui ler os anúncios (a OLX pode ter mudado a página).');
  return ads.filter((a) => a && a.listId).map(normalizeAd);
}

function buildUrl(watch, sort, page) {
  const u = new URL(watch.url);
  ['sf', 'sp', 'o', 'ps', 'pe'].forEach((p) => u.searchParams.delete(p));
  if (sort === 'recent') u.searchParams.set('sf', '1');
  else u.searchParams.set('sp', '1');
  if (watch.min) u.searchParams.set('ps', String(watch.min));
  if (watch.max) u.searchParams.set('pe', String(watch.max));
  if (page > 1) u.searchParams.set('o', String(page));
  return u.toString();
}

// ---------------------------------------------------------------- filtering
const norm = (s) => (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
const terms = (s) => (s || '').split(',').map((t) => norm(t).trim()).filter(Boolean);
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const hasTerm = (text, t) => new RegExp(`(^|[^a-z0-9])${esc(t)}([^a-z0-9]|$)`).test(text);

function passes(ad, watch) {
  if (ad.price == null) return false;
  if (watch.min && ad.price < Number(watch.min)) return false;
  if (watch.max && ad.price > Number(watch.max)) return false;
  const text = norm(ad.subject);
  const inc = terms(watch.include);
  const exc = terms(watch.exclude);
  if (inc.length && !inc.every((t) => hasTerm(text, t))) return false;
  if (exc.some((t) => hasTerm(text, t))) return false;
  return true;
}

// ---------------------------------------------------------------- scanning
let scanning = false;

async function scanWatch(watch) {
  const found = new Map();

  // 1) menor preço — percorre páginas até acabar (com faixa de preço, costuma ser 1 página)
  for (let p = 1; p <= MAX_PAGES_CHEAPEST; p++) {
    const ads = await fetchAds(buildUrl(watch, 'cheap', p));
    ads.forEach((a) => found.set(a.listId, a));
    if (ads.length < 40) break;
    await sleep(800 + Math.random() * 700);
  }
  // 2) mais recentes — primeira página
  await sleep(600 + Math.random() * 600);
  const recent = await fetchAds(buildUrl(watch, 'recent', 1));
  recent.forEach((a) => found.set(a.listId, a));

  return [...found.values()].filter((a) => passes(a, watch));
}

async function scanAll(reason, onlyWatchId) {
  if (scanning) return { ok: false, busy: true };
  scanning = true;
  const now = Date.now();
  const newEvents = [];
  try {
    const store = await get(['watches', 'seen', 'events']);
    const watches = store.watches || [];
    const seen = store.seen || {};
    let events = store.events || [];

    for (const w of watches) {
      if (!w.enabled) continue;
      if (onlyWatchId && w.id !== onlyWatchId) continue;
      try {
        const ads = await scanWatch(w);
        const bucket = (seen[w.id] = seen[w.id] || {});
        for (const ad of ads) {
          const prev = bucket[ad.listId];
          if (!prev) {
            bucket[ad.listId] = {
              ...ad, firstSeen: now, lastSeen: now,
              history: [{ p: ad.price, t: now }],
            };
            if (w.baselineDone) {
              newEvents.push({ type: 'novo', ...ad });
            }
          } else {
            if (ad.price != null && prev.price != null && ad.price < prev.price) {
              newEvents.push({ type: 'baixou', ...ad, prevPrice: prev.price });
            }
            if (ad.price !== prev.price) {
              prev.history = [...(prev.history || []), { p: ad.price, t: now }].slice(-20);
            }
            Object.assign(prev, ad, { lastSeen: now });
          }
        }
        for (const ev of newEvents) {
          if (!ev.watchId) { ev.watchId = w.id; ev.watchName = w.name; }
        }
        w.baselineDone = true;
        w.lastScan = now;
        w.lastCount = ads.length;
        w.lastError = null;
      } catch (e) {
        w.lastError = String(e && e.message ? e.message : e);
        w.lastErrorAt = now;
      }
    }

    // limpa anúncios que não aparecem há muito tempo
    const cutoff = now - SEEN_TTL_DAYS * 864e5;
    for (const wid of Object.keys(seen)) {
      if (!watches.some((w) => w.id === wid)) { delete seen[wid]; continue; }
      for (const id of Object.keys(seen[wid])) {
        if (seen[wid][id].lastSeen < cutoff) delete seen[wid][id];
      }
    }

    newEvents.forEach((e) => { e.id = uid(); e.t = now; e.read = false; });
    events = [...newEvents.reverse(), ...events].slice(0, MAX_EVENTS);

    await set({ watches, seen, events, lastRun: { t: now, reason } });
    await updateBadge();
    await notify(newEvents);
    return { ok: true, newEvents: newEvents.length };
  } finally {
    scanning = false;
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
