const $ = (s) => document.querySelector(s);
const get = (k) => chrome.storage.local.get(k);
const set = (o) => chrome.storage.local.set(o);
const send = (msg) => chrome.runtime.sendMessage(msg);

const brl = (n) => (n == null ? '—' : 'R$ ' + Number(n).toLocaleString('pt-BR'));
const escapeHtml = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function ago(t) {
  if (!t) return '';
  const s = Math.round((Date.now() - t) / 1000);
  if (s < 60) return 'agora';
  const m = Math.round(s / 60);
  if (m < 60) return `há ${m} min`;
  const h = Math.round(m / 60);
  if (h < 24) return `há ${h} h`;
  const d = Math.round(h / 24);
  return `há ${d} dia${d > 1 ? 's' : ''}`;
}
const fmtDate = (t) => (t ? new Date(t).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '');

// ---------------------------------------------------------------- tabs
document.querySelectorAll('nav button').forEach((b) =>
  b.addEventListener('click', () => {
    document.querySelectorAll('nav button').forEach((x) => x.classList.toggle('active', x === b));
    document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t.id === 'tab-' + b.dataset.tab));
  })
);

// ---------------------------------------------------------------- card
function adCard(ad, opts = {}) {
  const tags = [];
  if (opts.type === 'novo') tags.push('<span class="tag novo">NOVO</span>');
  if (opts.type === 'baixou') tags.push('<span class="tag baixou">BAIXOU</span>');
  if (ad.professional) tags.push('<span class="tag loja">LOJA</span>');

  const before = opts.type === 'baixou' ? ad.prevPrice : (ad.oldPrice && ad.oldPrice > ad.price ? ad.oldPrice : null);
  const metaBits = [ad.location];
  if (opts.watchName) metaBits.push(opts.watchName);
  if (opts.when) metaBits.push(opts.when);

  return `
    <a class="ad ${opts.unread ? 'unread' : ''}" href="${escapeHtml(ad.url)}" target="_blank">
      ${ad.img ? `<img src="${escapeHtml(ad.img)}" alt="" loading="lazy">` : '<img alt="">'}
      <div class="body">
        <div class="title" title="${escapeHtml(ad.subject)}">${tags.join('')}${escapeHtml(ad.subject)}</div>
        <div class="price">${brl(ad.price)}${before ? `<span class="old">${brl(before)}</span>` : ''}</div>
        <div class="meta">${metaBits.filter(Boolean).map(escapeHtml).join(' · ')}</div>
      </div>
    </a>`;
}

// ---------------------------------------------------------------- render
let settingsFilled = false;
async function render() {
  const { watches = [], seen = {}, events = [], lastRun } = await get(['watches', 'seen', 'events', 'lastRun']);

  // status
  const errs = watches.filter((w) => w.enabled && w.lastError);
  const st = $('#status');
  st.classList.toggle('err', errs.length > 0);
  st.textContent = errs.length
    ? `⚠️ ${errs[0].name}: ${errs[0].lastError}`
    : lastRun ? `Última verificação ${ago(lastRun.t)} (${fmtDate(lastRun.t)})` : 'Ainda não verificou.';

  // alerts
  const unread = events.filter((e) => !e.read).length;
  $('#unread').textContent = unread || '';
  $('#alertsList').innerHTML = events.length
    ? events.map((e) => adCard(e, { type: e.type, unread: !e.read, watchName: e.watchName, when: ago(e.t) })).join('')
    : `<div class="empty">Nenhum alerta ainda.<br>Na primeira verificação eu só memorizo o que já existe;
       daqui pra frente aviso quando aparecer anúncio novo ou quando um preço baixar.<br><br>
       Veja o que já está na faixa em <b>Na faixa agora</b>.</div>`;

  // live
  const sel = $('#liveWatch');
  const cur = sel.value;
  sel.innerHTML = watches.map((w) => `<option value="${w.id}">${escapeHtml(w.name)}</option>`).join('');
  if (cur && watches.some((w) => w.id === cur)) sel.value = cur;
  renderLive(watches, seen);

  // watches
  $('#watchesList').innerHTML = watches.map((w) => `
    <div class="card watch ${w.enabled ? '' : 'off'}" data-id="${w.id}">
      <h4>${escapeHtml(w.name)}</h4>
      <div class="muted">${w.min ? brl(w.min) : 'R$ 0'} até ${w.max ? brl(w.max) : 'sem limite'}
        ${w.include ? ` · precisa ter: <b>${escapeHtml(w.include)}</b>` : ''}</div>
      ${w.exclude ? `<div class="muted">ignora: ${escapeHtml(w.exclude)}</div>` : ''}
      <div class="muted">${w.lastScan ? `${w.lastCount ?? 0} anúncio(s) na faixa · verificado ${ago(w.lastScan)}` : 'ainda não verificado'}
        ${w.lastError ? `<br><span style="color:#b3261e">erro: ${escapeHtml(w.lastError)}</span>` : ''}</div>
      <div class="actions">
        <button class="link" data-act="edit">editar</button>
        <button class="link" data-act="toggle">${w.enabled ? 'pausar' : 'ativar'}</button>
        <button class="link" data-act="open">abrir na OLX</button>
        <button class="link" data-act="reset">recomeçar memória</button>
        <button class="link danger" data-act="del">excluir</button>
      </div>
    </div>`).join('') || '<div class="empty">Nenhuma busca. Crie uma abaixo.</div>';

  // settings (preenche só uma vez, pra não apagar o que você estiver digitando)
  if (settingsFilled) return;
  settingsFilled = true;
  const { settings = {} } = await get('settings');
  $('#sInterval').value = settings.intervalMin ?? 5;
  $('#sDesktop').checked = settings.notifyDesktop ?? true;
  $('#sSticky').checked = settings.requireInteraction ?? true;
  $('#sNtfy').value = settings.ntfyTopic ?? '';
}

function renderLive(watches, seen) {
  const id = $('#liveWatch').value;
  const w = watches.find((x) => x.id === id);
  if (!w) { $('#liveList').innerHTML = '<div class="empty">Nenhuma busca.</div>'; $('#liveInfo').textContent = ''; return; }
  const ads = Object.values(seen[id] || {})
    .filter((a) => a.lastSeen === w.lastScan)
    .sort((a, b) => a.price - b.price);
  $('#liveInfo').textContent = `${ads.length} anúncio(s), do mais barato ao mais caro`;
  $('#liveList').innerHTML = ads.length
    ? ads.map((a) => {
        const hist = (a.history || []);
        const firstPrice = hist.length ? hist[0].p : null;
        const dropped = firstPrice && a.price < firstPrice;
        return adCard(
          dropped ? { ...a, prevPrice: firstPrice } : a,
          { type: dropped ? 'baixou' : null, when: a.adDate ? `publicado ${fmtDate(a.adDate)}` : '' }
        );
      }).join('')
    : '<div class="empty">Nada na faixa no momento.</div>';
}

$('#liveWatch').addEventListener('change', async () => {
  const { watches = [], seen = {} } = await get(['watches', 'seen']);
  renderLive(watches, seen);
});

// ---------------------------------------------------------------- actions
$('#scanNow').addEventListener('click', async () => {
  const b = $('#scanNow');
  b.disabled = true; b.textContent = 'Verificando…';
  const r = await send({ type: 'scanNow' });
  b.disabled = false; b.textContent = '↻ Verificar agora';
  if (r && r.busy) $('#status').textContent = 'Já estava verificando, aguarde um instante…';
  await render();
});

$('#markRead').addEventListener('click', async () => { await send({ type: 'markAllRead' }); render(); });

$('#watchesList').addEventListener('click', async (e) => {
  const btn = e.target.closest('button[data-act]');
  if (!btn) return;
  const id = btn.closest('.watch').dataset.id;
  const { watches = [], seen = {} } = await get(['watches', 'seen']);
  const w = watches.find((x) => x.id === id);
  if (!w) return;
  switch (btn.dataset.act) {
    case 'edit': fillForm(w); break;
    case 'toggle': w.enabled = !w.enabled; await set({ watches }); break;
    case 'open': chrome.tabs.create({ url: w.url }); break;
    case 'reset':
      if (confirm('Esquecer os anúncios já vistos desta busca? A próxima verificação vira a nova base (sem alertas).'))
        await send({ type: 'resetWatch', watchId: id });
      break;
    case 'del':
      if (confirm(`Excluir a busca "${w.name}"?`)) {
        delete seen[id];
        await set({ watches: watches.filter((x) => x.id !== id), seen });
      }
      break;
  }
  render();
});

function fillForm(w) {
  $('#formTitle').textContent = w ? 'Editar busca' : 'Nova busca';
  $('#fId').value = w?.id || '';
  $('#fName').value = w?.name || '';
  $('#fUrl').value = w?.url || '';
  $('#fMin').value = w?.min || '';
  $('#fMax').value = w?.max || '';
  $('#fInclude').value = w?.include || '';
  $('#fExclude').value = w?.exclude || '';
  $('#cancelEdit').classList.toggle('hidden', !w);
  if (w) $('#watchForm').scrollIntoView({ behavior: 'smooth' });
}
$('#cancelEdit').addEventListener('click', () => fillForm(null));

$('#useTab').addEventListener('click', async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !/^https:\/\/([a-z]+\.)?olx\.com\.br\//.test(tab.url || '')) {
    alert('Abra uma busca da OLX na aba atual primeiro.');
    return;
  }
  const u = new URL(tab.url);
  $('#fUrl').value = u.toString();
  if (u.searchParams.get('ps')) $('#fMin').value = u.searchParams.get('ps');
  if (u.searchParams.get('pe')) $('#fMax').value = u.searchParams.get('pe');
  if (!$('#fName').value && u.searchParams.get('q')) $('#fName').value = u.searchParams.get('q');
});

$('#watchForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  let url;
  try {
    url = new URL($('#fUrl').value.trim());
    if (!/(^|\.)olx\.com\.br$/.test(url.hostname)) throw new Error();
  } catch { alert('Cole um link de busca da OLX (olx.com.br).'); return; }

  const { watches = [] } = await get('watches');
  const id = $('#fId').value;
  const data = {
    name: $('#fName').value.trim() || url.searchParams.get('q') || 'Busca',
    url: url.toString(),
    min: Number($('#fMin').value) || 0,
    max: Number($('#fMax').value) || 0,
    include: $('#fInclude').value.trim(),
    exclude: $('#fExclude').value.trim(),
  };
  let watchId = id;
  if (id) {
    const w = watches.find((x) => x.id === id);
    Object.assign(w, data);
  } else {
    watchId = Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
    watches.push({ ...data, id: watchId, enabled: true, createdAt: Date.now(), baselineDone: false });
  }
  await set({ watches });
  fillForm(null);
  await render();
  $('#status').textContent = 'Salvo. Verificando…';
  await send({ type: 'scanNow', watchId });
  render();
});

async function saveSettings() {
  const settings = {
    intervalMin: Math.max(1, Math.min(120, Number($('#sInterval').value) || 5)),
    notifyDesktop: $('#sDesktop').checked,
    requireInteraction: $('#sSticky').checked,
    ntfyTopic: $('#sNtfy').value.trim().replace(/[^\w-]/g, ''),
  };
  await set({ settings });
  await send({ type: 'reschedule' });
  $('#status').textContent = `Ajustes salvos. Verificando a cada ${settings.intervalMin} min.`;
}
$('#saveSettings').addEventListener('click', saveSettings);

$('#testNotify').addEventListener('click', async () => {
  await saveSettings();
  await send({ type: 'testNotify' });
});

chrome.storage.onChanged.addListener(() => render());
render();
