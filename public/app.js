/* ═══════════════════════════════════════════════════════════════════
   AfroSpeak Studio — client SaaS
   EPIC 2 · interface premium, double idéation, sélecteur de format,
   progression temps réel par polling.
   ═══════════════════════════════════════════════════════════════════ */
'use strict';

const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];

const api = async (url, opts) => {
  const o = opts && opts.body
    ? { method: 'POST', headers: { 'content-type': 'application/json' }, ...opts }
    : opts;
  const r = await fetch(url, o);
  const j = await r.json().catch(() => ({ ok: false, error: 'Réponse illisible' }));
  if (!j.ok) { const e = new Error(j.error || 'Erreur serveur'); e.code = j.code; e.status = r.status; throw e; }
  return j;
};

const esc = s => String(s == null ? '' : s)
  .replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtSize = b => !b ? '—' : b > 1e9 ? (b / 1e9).toFixed(1) + ' Go' : (b / 1e6).toFixed(1) + ' Mo';
const fmtDur = s => { s = Math.round(s || 0); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };
const fmtAgo = d => {
  const m = Math.floor((Date.now() - new Date(d)) / 60000);
  if (m < 1) return "à l'instant";
  if (m < 60) return `il y a ${m} min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `il y a ${h} h`;
  const j = Math.floor(h / 24);
  return j < 7 ? `il y a ${j} j` : new Date(d).toLocaleDateString('fr-FR');
};

/* État global */
const S = {
  me: null, platform: null, presets: null, feeds: [],
  format: 'vertical', style: 'brut',
  trends: [], news: [], selNews: [], videos: [],
  polls: new Map(), autoFeeds: new Set(),
};

/* ─────────────── Notifications & modale ─────────────── */
function toast(msg, kind = '') {
  const el = document.createElement('div');
  el.className = 'tst ' + kind;
  el.textContent = msg;
  $('#toast').appendChild(el);
  setTimeout(() => {
    el.style.opacity = '0';
    el.style.transform = 'translateX(110%)';
    setTimeout(() => el.remove(), 280);
  }, 4400);
}
function openModal(title, html) {
  $('#modalTitle').textContent = title;
  $('#modalBody').innerHTML = html;
  $('#modal').classList.add('on');
}
function closeModal() { $('#modal').classList.remove('on'); }
window.closeModal = closeModal;
$('#modal').addEventListener('click', e => { if (e.target.id === 'modal') closeModal(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });

/* ─────────────── Navigation ─────────────── */
function go(page) {
  $$('.nav').forEach(n => n.classList.toggle('on', n.dataset.p === page));
  $$('.page').forEach(p => p.classList.toggle('on', p.id === 'p-' + page));
  window.scrollTo({ top: 0, behavior: 'smooth' });
  const loaders = {
    dash: loadDash, library: loadLibrary, news: loadNews, media: () => {},
    social: loadSocial, auto: loadAuto, settings: () => { loadHealth(); loadLLM(); },
  };
  if (loaders[page]) loaders[page]();
}
window.go = go;
$$('.nav').forEach(n => n.addEventListener('click', () => go(n.dataset.p)));

/* ─────────────── Démarrage ─────────────── */
(async function boot() {
  try {
    const session = await loadSession();
    if (!session) return;                    // redirigé vers /auth.html

    const cfg = await api('/api/config');
    S.presets = cfg.presets;
    S.feeds = cfg.feeds;
    renderStyles();
    renderFeeds();
    fillSettings(cfg.config);
    fillBrand(cfg.config);

    await loadPlatform();
    loadTrending();                          // F-01b, en tâche de fond
    setInterval(refreshActiveBadge, 15000);
  } catch (e) {
    toast('Connexion au moteur impossible : ' + e.message, 'err');
  }
})();

/* ─────────────── Session ─────────────── */
async function loadSession() {
  try {
    const j = await api('/api/auth/me');
    if (!j.user) { location.href = '/auth.html'; return null; }
    S.me = j;
    const u = j.user;
    $('#userBox').style.display = '';
    $('#uAvatar').textContent = (u.name || u.email)[0].toUpperCase();
    $('#uName').textContent = u.name || u.email.split('@')[0];
    $('#uQuota').textContent = `${j.quota.remaining}/${j.quota.limit} vidéos aujourd'hui`;
    return j;
  } catch (e) { location.href = '/auth.html'; return null; }
}
$('#btnLogout').addEventListener('click', async () => {
  await fetch('/api/auth/logout', { method: 'POST' });
  location.href = '/auth.html';
});

/* ═══════════ F-02 · SÉLECTEUR DE FORMAT ═══════════ */
$$('#fmtToggle .fmt-opt').forEach(el => el.addEventListener('click', () => {
  S.format = el.dataset.f;
  $$('#fmtToggle .fmt-opt').forEach(x => x.classList.toggle('on', x.dataset.f === S.format));
  // Le style « Brut » colle au vertical, « Écofin » au horizontal.
  const suggested = S.format === 'vertical' ? 'brut' : 'ecofin';
  if (S.style !== suggested) { S.style = suggested; renderStyles(); }
}));

function renderStyles() {
  if (!S.presets) return;
  $('#styleGrid').innerHTML = Object.values(S.presets.styles).map(s => `
    <div class="style ${s.id === S.style ? 'on' : ''}" data-s="${s.id}">
      <b>${esc(s.label.split('—')[0].trim())}</b>
      <small>${esc(s.desc)}</small>
    </div>`).join('');
  $$('#styleGrid .style').forEach(el => el.addEventListener('click', () => {
    S.style = el.dataset.s;
    $$('#styleGrid .style').forEach(x => x.classList.toggle('on', x.dataset.s === S.style));
  }));
  const sel = $('#aStyle');
  if (sel) sel.innerHTML = Object.values(S.presets.styles)
    .map(s => `<option value="${s.id}">${esc(s.label)}</option>`).join('');
}

/* Curseurs */
const bindRange = (id, vid, fmt) => {
  const r = $(id); if (!r) return;
  const up = () => $(vid).textContent = fmt(+r.value);
  r.addEventListener('input', up); up();
};
bindRange('#fMin', '#fMinV', v => v < 1 ? Math.round(v * 60) + ' s' : v + ' min');
bindRange('#aMin', '#aMinV', v => v < 1 ? Math.round(v * 60) + ' s' : v + ' min');
bindRange('#aInt', '#aIntV', v => v < 60 ? v + ' min' : (v / 60).toFixed(v % 60 ? 1 : 0) + ' h');
bindRange('#fSocRatio', '#fSocRatioV', v => Math.round(v * 100) + ' %');
$$('.check input').forEach(c => c.addEventListener('change',
  () => c.closest('.check').classList.toggle('on', c.checked)));
$('#oSocial').addEventListener('change', e => {
  $('#socialOpts').style.display = e.target.checked ? '' : 'none';
  if (e.target.checked) loadSocial();
});

/* ═══════════ F-01b · SUJETS TENDANCES ═══════════ */
async function loadTrending(refresh = false) {
  const box = $('#trendScroll');
  if (refresh) box.innerHTML = '<div class="trend-skel"></div>'.repeat(4);
  try {
    const j = await api('/api/trending' + (refresh ? '?refresh=1' : ''));
    S.trends = j.topics || [];
    if (!S.trends.length) {
      box.innerHTML = '<div class="empty" style="flex:1"><p>Aucune tendance disponible.</p></div>';
      return;
    }
    box.innerHTML = S.trends.map((t, k) => `
      <div class="trend-card" onclick="useTrend(${k})" title="Cliquez pour produire cette vidéo">
        <div class="top">
          <span class="tag o">${esc(t.tag || 'Afrique')}</span>
          <span class="score"><span class="dotmini"></span>${t.score || 75}</span>
        </div>
        <b>${esc(t.topic)}</b>
        <p>${esc(t.angle || t.why || '')}</p>
        ${t.source ? `<div class="src">via ${esc(t.source)}</div>` : ''}
        <div class="cta"><span>Produire cette vidéo</span><span>→</span></div>
      </div>`).join('');
    if (j.offline) toast('Veille hors ligne — sujets de secours affichés.', '');
  } catch (e) {
    box.innerHTML = `<div class="empty" style="flex:1"><p>${esc(e.message)}</p></div>`;
  }
}
$('#btnRefreshTrends').addEventListener('click', () => loadTrending(true));

/** Un clic sur une tendance remplit le champ et lance la production. */
window.useTrend = async k => {
  const t = S.trends[k];
  if (!t) return;
  $('#fTopic').value = t.topic;
  $('#fAngle').value = t.angle || '';
  $('#fTopic').scrollIntoView({ behavior: 'smooth', block: 'center' });
  $('#fTopic').focus();
  toast('Sujet chargé — vérifiez le format puis lancez.', 'ok');
};

/* ═══════════ PRODUCTION ═══════════ */
$('#btnGo').addEventListener('click', submitVideo);
$('#fTopic').addEventListener('keydown', e => { if (e.key === 'Enter') submitVideo(); });

async function submitVideo() {
  const topic = $('#fTopic').value.trim();
  if (!topic) {
    toast('Indiquez un sujet ou choisissez une tendance.', 'err');
    $('#fTopic').focus();
    return;
  }
  const body = {
    topic,
    angle: $('#fAngle').value.trim(),
    format: S.format,
    style: S.style,
    minutes: +$('#fMin').value,
    captionMode: $('#fCapMode').value,
    creditCorner: $('#fCorner').value,
    creditSize: $('#fCredSize').value,
    musicMood: $('#fMood').value,
    kenburns: $('#oKen').checked,
    broll: $('#oBroll').checked,
    music: $('#oMusic').checked,
    watermark: $('#oMark').checked,
    progressBar: $('#oProg').checked,
    sourceUrls: $('#fUrls').value.split('\n').map(s => s.trim()).filter(Boolean),
    sourceItems: S.selNews,
  };
  if ($('#oSocial').checked) {
    body.social = true;
    body.socialPlatforms = [...$('#fSocPlatforms').querySelectorAll('.chip.on')].map(c => c.dataset.p);
    body.socialRatio = +$('#fSocRatio').value;
    const acc = $('#socAccounts') ? $('#socAccounts').value.trim() : '';
    if (acc) body.socialAccounts = acc.split(',').map(x => {
      const t = x.trim();
      const [platform, handle] = t.includes(':') ? t.split(':') : ['x', t];
      return { platform: platform.trim(), handle: (handle || '').trim() };
    }).filter(x => x.handle);
  }

  const btn = $('#btnGo');
  btn.disabled = true;
  btn.innerHTML = '<span class="spin"></span> Lancement…';
  try {
    const j = await api('/api/videos', { body: JSON.stringify(body) });
    toast(`Production lancée — position ${j.queue.position} dans la file.`, 'ok');
    $('#fTopic').value = '';
    S.selNews = []; renderSelNews();
    go('dash');
    await loadDash();
    pollVideo(j.video.id);
  } catch (e) {
    toast(e.message, 'err');
    if (e.code === 'QUOTA') toast('Revenez demain ou augmentez FREE_DAILY_QUOTA.', 'err');
  }
  btn.disabled = false;
  btn.innerHTML = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg> Produire';
}

function renderSelNews() {
  $('#selNews').innerHTML = S.selNews.length
    ? `<div class="note"><b>${S.selNews.length} source(s) sélectionnée(s) :</b><br>${
      S.selNews.map(s => esc(s.title.slice(0, 72))).join('<br>')}</div>` : '';
}

/* ═══════════ F-03 · TABLEAU DE BORD ═══════════ */
async function loadDash() {
  await Promise.all([loadSession(), loadPlatform()]);
  if (!S.me) return;
  const st = S.me.stats || {};
  $('#dashStats').innerHTML = `
    <div class="stat"><div class="ic">🎬</div>
      <div class="v">${st.total || 0}</div><div class="k">Vidéos créées</div></div>
    <div class="stat"><div class="ic">✅</div>
      <div class="v" style="color:var(--green)">${st.done || 0}</div><div class="k">Terminées</div></div>
    <div class="stat"><div class="ic">⏳</div>
      <div class="v" style="color:var(--gold)">${st.active || 0}</div><div class="k">En cours</div></div>
    <div class="stat"><div class="ic">⏱️</div>
      <div class="v">${fmtDur(st.seconds || 0)}</div><div class="k">Durée totale</div></div>`;

  try {
    const { videos } = await api('/api/videos?limit=40');
    S.videos = videos;
    $('#prodCount').textContent = videos.length;
    $('#dashVideos').innerHTML = videos.length
      ? videos.map(videoRow).join('')
      : `<div class="empty">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="M10 9l5 3-5 3V9z"/></svg>
          <p>Aucune production pour l'instant.</p>
          <button class="btn pri sm" onclick="go('studio')">Créer ma première vidéo</button>
        </div>`;
    videos.filter(v => ['queued', 'running'].includes(v.status)).forEach(v => pollVideo(v.id));
    refreshActiveBadge();
  } catch (e) {
    $('#dashVideos').innerHTML = `<div class="empty"><p>${esc(e.message)}</p></div>`;
  }
}

function videoRow(v) {
  const st = {
    done: ['g', 'Terminée'], running: ['o', 'En cours'], queued: ['n', 'En file'],
    error: ['r', 'Erreur'], cancelled: ['n', 'Annulée'],
    awaiting_review: ['o', 'Validation requise'],
  }[v.status] || ['n', v.status];
  const pct = Math.round((v.progress || 0) * 100);
  const active = ['queued', 'running'].includes(v.status);
  const vert = v.format === 'vertical';
  return `<div class="vid-item" id="vr-${v.id}">
    ${v.thumbUrl
      ? `<img class="vid-thumb ${vert ? 'v' : 'h'}" src="${esc(v.thumbUrl)}" alt="" loading="lazy">`
      : `<div class="vid-ph">${active ? '<span class="spin"></span>' : '<span style="opacity:.3">🎬</span>'}</div>`}
    <div class="vid-body">
      <div class="vid-meta">
        <span class="dot ${st[0]}"></span>
        <span class="tag ${st[0] === 'g' ? 'g' : st[0] === 'o' ? 'o' : st[0] === 'r' ? 'r' : 'n'}">${st[1]}</span>
        <span class="tag n">${vert ? '9:16' : '16:9'}</span>
        ${v.ephemeral && v.status === 'done' ? '<span class="tag o" title="Perdue au redémarrage du serveur">éphémère</span>' : ''}
      </div>
      <span class="vid-title">${esc(v.title || v.topic)}</span>
      <div class="vid-sub">${v.duration ? fmtDur(v.duration) + ' · ' : ''}${
        v.size ? fmtSize(v.size) + ' · ' : ''}${fmtAgo(v.createdAt)}</div>
      ${active ? `
        <div class="pbar" style="margin-top:10px"><div class="pfill" id="vp-${v.id}" style="width:${pct}%"></div></div>
        <div style="display:flex;justify-content:space-between;margin-top:6px;font-size:11px;color:var(--txt-2)">
          <span id="vs-${v.id}">${esc(v.step || 'En attente…')}</span>
          <b id="vn-${v.id}" style="font-variant-numeric:tabular-nums">${pct}%</b>
        </div>` : ''}
      ${v.error ? `<div style="color:#ff9ba3;font-size:11.5px;margin-top:7px">${esc(v.error)}</div>` : ''}
      <div class="btns" style="margin-top:10px">
        ${v.status === 'done' && v.videoUrl ? `
          <button class="btn xs ok" onclick="watchVideo('${v.id}')">▶ Voir</button>
          <a class="btn xs" href="${esc(v.videoUrl)}" download>⬇ MP4</a>
          ${v.srtUrl ? `<a class="btn xs ghost" href="${esc(v.srtUrl)}" download>SRT</a>` : ''}
          ${v.metaUrl ? `<a class="btn xs ghost" href="${esc(v.metaUrl)}" target="_blank">Description</a>` : ''}` : ''}
        ${active ? `<button class="btn xs dan" onclick="cancelVideo('${v.id}')">Arrêter</button>` : ''}
        ${v.status === 'awaiting_review' ? `<button class="btn xs ok" onclick="reviewStoryboard('${v.id}')">🖼️ Valider les médias</button>` : ''}
        ${!active && v.status !== 'awaiting_review' ? `<button class="btn xs dan" onclick="deleteVideo('${v.id}')">✕</button>` : ''}
      </div>
    </div>
  </div>`;
}

/**
 * POLLING — le frontend interroge le backend pendant que FFmpeg travaille.
 * Tolère les échecs : le conteneur gratuit peut s'endormir puis se réveiller.
 */
function pollVideo(id) {
  if (S.polls.has(id)) return;
  let fails = 0;
  const tick = async () => {
    try {
      const { video: v, queue: q } = await api('/api/videos/' + id);
      const pb = $('#vp-' + id), ps = $('#vs-' + id), pn = $('#vn-' + id);
      const pct = Math.round((v.progress || 0) * 100);
      if (pb) pb.style.width = pct + '%';
      if (pn) pn.textContent = pct + '%';
      if (ps) ps.textContent = (v.status === 'queued' && q && q.position > 0)
        ? `En file — position ${q.position}${q.waitSeconds ? ` (~${Math.ceil(q.waitSeconds / 60)} min)` : ''}`
        : (v.step || '…');
      if (['done', 'error', 'cancelled', 'awaiting_review'].includes(v.status)) {
        clearInterval(iv); S.polls.delete(id);
        if (v.status === 'done') { toast('✅ Vidéo terminée !', 'ok'); loadDash(); }
        else if (v.status === 'awaiting_review') {
          toast('🖼️ Médias prêts à valider — cliquez pour vérifier.', 'ok');
          loadDash();
        }
        else if (v.status === 'error') { toast('❌ ' + (v.error || 'échec'), 'err'); loadDash(); }
        else { toast('Production annulée', 'err'); loadDash(); }
      }
      fails = 0;
    } catch (e) {
      if (++fails > 8) { clearInterval(iv); S.polls.delete(id); }
    }
  };
  const iv = setInterval(tick, 3000);
  S.polls.set(id, iv);
  tick();
}

function refreshActiveBadge() {
  const n = S.videos.filter(v => ['queued', 'running'].includes(v.status)).length;
  const b = $('#badgeActive');
  b.style.display = n ? '' : 'none';
  b.textContent = n;
}

window.watchVideo = async id => {
  const { video: v } = await api('/api/videos/' + id);
  const vert = v.format === 'vertical';
  openModal(v.title || v.topic, `
    <div style="display:grid;place-items:center;background:#000;border-radius:var(--r);overflow:hidden">
      <video src="${esc(v.videoUrl)}" controls autoplay playsinline
        style="max-height:60vh;${vert ? 'max-width:340px;' : 'width:100%;'}display:block"></video>
    </div>
    <div class="btns" style="margin-top:16px">
      <a class="btn pri" href="${esc(v.videoUrl)}" download>⬇ Télécharger le MP4</a>
      ${v.srtUrl ? `<a class="btn" href="${esc(v.srtUrl)}" download>⬇ Sous-titres</a>` : ''}
      ${v.metaUrl ? `<a class="btn ghost" href="${esc(v.metaUrl)}" target="_blank">📄 Titre & description</a>` : ''}
    </div>
    ${v.script && v.script.stats ? `<div class="hr"></div>
      <div class="kv"><span>Plans</span><b>${v.script.stats.shots}</b></div>
      <div class="kv"><span>Mots</span><b>${v.script.stats.words}</b></div>` : ''}
    ${v.credits && v.credits.length ? `<div class="hr"></div>
      <h3>Crédits médias — incrustés dans la vidéo</h3>
      ${v.credits.map(c => `<div class="kv">
        <span>${esc(String(c.title || 'Média').slice(0, 44))}</span>
        <b>${esc([c.author, c.provider].filter(Boolean).join(' / '))}</b></div>`).join('')}` : ''}`);
};

window.cancelVideo = async id => {
  await api('/api/videos/' + id + '/cancel', { body: '{}' });
  toast('Arrêt demandé…');
};
window.deleteVideo = async id => {
  if (!confirm('Supprimer cette vidéo ?')) return;
  await fetch('/api/videos/' + id, { method: 'DELETE' });
  toast('Vidéo supprimée.');
  loadDash();
};

/* ─────────────── Plateforme ─────────────── */
async function loadPlatform() {
  try {
    const p = await api('/api/platform');
    S.platform = p;

    const w = $('#storageWarn');
    if (p.storage.ephemeral) {
      w.style.display = '';
      w.textContent = '⚠ Stockage éphémère — configurez Cloudflare R2 pour conserver vos vidéos.';
    } else w.style.display = 'none';

    $('#srvTxt').textContent = p.llm.ready
      ? (p.llm.activeSource || 'moteur actif').replace('cloud:', '')
      : 'AfroWriter local';
    $('#srvDot').className = 'dot ' + (p.llm.ready ? 'g' : 'o');

    const box = $('#platformBox');
    if (box) box.innerHTML = `
      <div class="kv"><span>Base de données</span><b>${p.db.neon
        ? '<span class="tag g">Neon Postgres</span>' : '<span class="tag o">locale</span>'}</b></div>
      <div class="kv"><span>Stockage vidéos</span><b>${p.storage.mode === 's3'
        ? '<span class="tag g">Cloudflare R2</span>' : '<span class="tag r">éphémère</span>'}</b></div>
      <div class="kv"><span>Moteur de script</span><b>${p.llm.ready
        ? `<span class="tag g">${esc(p.llm.activeSource || 'actif')}</span>`
        : '<span class="tag o">AfroWriter local</span>'}</b></div>
      <div class="kv"><span>Scraping</span><b>${p.social
        ? `<span class="tag ${p.social.ytdlp ? 'g' : 'n'}">yt-dlp</span>
           <span class="tag ${p.social.gallerydl ? 'g' : 'n'}">gallery-dl</span>` : '—'}</b></div>
      <div class="kv"><span>Durée maximale</span><b>${p.limits.maxMinutes} min</b></div>
      ${p.storage.hint ? `<div class="note warn" style="margin-top:12px">${esc(p.storage.hint)}</div>` : ''}
      ${!p.llm.ready && p.llm.install ? `<div class="note warn" style="margin-top:12px">
        <b>Activez l'IA gratuitement :</b><br>${(p.llm.install.cloud || []).map(esc).join('<br>')}</div>` : ''}`;

    const q = $('#queueBox');
    if (q) q.innerHTML = `
      <div class="kv"><span>En cours</span><b>${p.queue.active}</b></div>
      <div class="kv"><span>En attente</span><b>${p.queue.pending}</b></div>
      <div class="kv"><span>Rendus simultanés</span><b>${p.queue.concurrency}</b></div>`;

    // Borne le curseur de durée sur la limite serveur
    const mm = p.limits.maxMinutes;
    const r = $('#fMin');
    if (r && mm) {
      r.max = mm;
      if (+r.value > mm) { r.value = mm; r.dispatchEvent(new Event('input')); }
      $('#maxMinHint').textContent = `— maximum ${mm} min sur cette instance`;
    }
    return p;
  } catch (e) { return null; }
}

/* ─────────────── Bibliothèque ─────────────── */
async function loadLibrary() {
  try {
    const { videos } = await api('/api/videos?limit=60');
    const done = videos.filter(v => v.status === 'done' && v.videoUrl);
    $('#libList').innerHTML = done.length ? `<div class="vgrid">${done.map(v => `
      <div class="vcard">
        ${v.thumbUrl
          ? `<img class="vt ${v.format === 'vertical' ? 'v' : 'h'}" src="${esc(v.thumbUrl)}"
                 onclick="watchVideo('${v.id}')" loading="lazy" alt="">`
          : `<video class="vt ${v.format === 'vertical' ? 'v' : 'h'}" src="${esc(v.videoUrl)}"
                 onclick="watchVideo('${v.id}')"></video>`}
        <div class="vb">
          <b style="font-size:13px;display:block;margin-bottom:5px;line-height:1.4;
             overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(v.title || v.topic)}</b>
          <div style="color:var(--txt-3);font-size:11px;margin-bottom:11px">
            ${fmtDur(v.duration)} · ${fmtSize(v.size)} · ${fmtAgo(v.createdAt)}</div>
          <div class="btns">
            <a class="btn xs pri" href="${esc(v.videoUrl)}" download>⬇ MP4</a>
            ${v.srtUrl ? `<a class="btn xs ghost" href="${esc(v.srtUrl)}" download>SRT</a>` : ''}
            <button class="btn xs dan" onclick="deleteVideo('${v.id}')">✕</button>
          </div>
        </div>
      </div>`).join('')}</div>`
      : `<div class="card"><div class="empty">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="M10 9l5 3-5 3V9z"/></svg>
          <p>Aucune vidéo terminée pour l'instant.</p>
          <button class="btn pri sm" onclick="go('studio')">Créer une vidéo</button></div></div>`;
  } catch (e) { toast(e.message, 'err'); }
}
$('#btnRefreshLib').addEventListener('click', loadLibrary);

/* ─────────────── Veille ─────────────── */
function renderFeeds() {
  const html = S.feeds.map(f => `<div class="chip" data-f="${f.id}">${esc(f.name)}</div>`).join('');
  $('#feedChips').innerHTML = html;
  $$('#feedChips .chip').forEach(c => c.addEventListener('click', () => { c.classList.toggle('on'); loadNews(); }));
  const af = $('#autoFeeds');
  if (af) {
    af.innerHTML = html;
    $$('#autoFeeds .chip').forEach(c => c.addEventListener('click', () => {
      c.classList.toggle('on');
      c.classList.contains('on') ? S.autoFeeds.add(c.dataset.f) : S.autoFeeds.delete(c.dataset.f);
    }));
  }
}

async function loadNews() {
  const sel = $$('#feedChips .chip.on').map(c => c.dataset.f);
  $('#newsList').innerHTML = '<div class="empty"><span class="spin"></span><p style="margin-top:10px">Collecte des flux…</p></div>';
  try {
    const q = new URLSearchParams({ limit: 40 });
    if (sel.length) q.set('sources', sel.join(','));
    if ($('#nQ').value.trim()) q.set('q', $('#nQ').value.trim());
    const { items } = await api('/api/news?' + q);
    S.news = items;
    $('#newsList').innerHTML = items.length ? items.map((i, k) => `
      <div class="nitem" data-k="${k}">
        ${i.image ? `<img src="${esc(i.image)}" loading="lazy" onerror="this.style.display='none'" alt="">` : ''}
        <div class="nb"><b>${esc(i.title)}</b>
          <small>${esc(i.source)}${i.date ? ' · ' + fmtAgo(i.date) : ''}</small>
          <p>${esc(i.summary || '')}</p></div>
      </div>`).join('') : '<div class="empty"><p>Aucun résultat.</p></div>';
    $$('#newsList .nitem').forEach(el => el.addEventListener('click', () => {
      const it = S.news[+el.dataset.k];
      el.classList.toggle('sel');
      const ix = S.selNews.findIndex(s => s.link === it.link);
      if (ix >= 0) S.selNews.splice(ix, 1);
      else S.selNews.push({ title: it.title, summary: it.summary, source: it.source, link: it.link });
      renderSelNews();
      toast(ix >= 0 ? 'Source retirée' : 'Source ajoutée au prochain script');
    }));
  } catch (e) { $('#newsList').innerHTML = `<div class="empty"><p>${esc(e.message)}</p></div>`; }
}
$('#btnNews').addEventListener('click', loadNews);
$('#btnNewsFilter').addEventListener('click', loadNews);
$('#nQ').addEventListener('keydown', e => { if (e.key === 'Enter') loadNews(); });

$('#btnIdeas').addEventListener('click', async () => {
  $('#ideaList').innerHTML = '<div class="empty"><span class="spin"></span><p style="margin-top:10px">Analyse des angles…</p></div>';
  try {
    const { ideas } = await api('/api/ideas', { body: JSON.stringify({ items: S.news.slice(0, 25), n: 8 }) });
    window.__ideas = ideas;
    $('#ideaList').innerHTML = ideas.map((i, k) => `
      <div style="padding:13px;background:var(--bg-elev);border:1px solid var(--line);
                  border-radius:var(--r-sm);margin-bottom:10px">
        <div style="display:flex;justify-content:space-between;gap:11px;align-items:flex-start">
          <div style="flex:1"><b style="font-size:13.5px">${esc(i.topic)}</b>
            <p style="color:var(--txt-2);font-size:12px;margin-top:5px">${esc(i.angle || '')}</p></div>
          <button class="btn xs pri" onclick="useIdea(${k})">Produire</button></div>
      </div>`).join('');
  } catch (e) { $('#ideaList').innerHTML = `<div class="empty"><p>${esc(e.message)}</p></div>`; }
});
window.useIdea = k => {
  const i = window.__ideas[k];
  $('#fTopic').value = i.topic;
  $('#fAngle').value = i.angle || '';
  go('studio');
  toast('Sujet chargé.', 'ok');
};

/* ─────────────── Médias ─────────────── */
$('#btnMedia').addEventListener('click', searchMedia);
$('#mQ').addEventListener('keydown', e => { if (e.key === 'Enter') searchMedia(); });
async function searchMedia() {
  const q = $('#mQ').value.trim(); if (!q) return;
  $('#mediaGrid').innerHTML = '<div class="empty" style="grid-column:1/-1"><span class="spin"></span><p style="margin-top:10px">Recherche multi-sources…</p></div>';
  try {
    const p = new URLSearchParams({ q, format: $('#mFmt').value, limit: 36 });
    if ($('#mVid').checked) p.set('video', '1');
    const { results } = await api('/api/media/search?' + p);
    $('#mediaGrid').innerHTML = results.length ? results.map(r => `
      <div class="mitem" onclick="window.open('${esc(r.pageUrl || r.url)}','_blank')">
        <img src="${esc(r.thumb || r.url)}" loading="lazy" alt="">
        <div class="lic">${esc((r.license || '').split(' ')[0] || r.provider)}</div>
        <div class="mi"><b>${esc(r.title || 'Sans titre')}</b>
          <small>${esc(r.credit)}${r.width ? ` · ${r.width}×${r.height}` : ''}</small></div>
      </div>`).join('') : '<div class="empty" style="grid-column:1/-1"><p>Aucun résultat.</p></div>';
  } catch (e) { $('#mediaGrid').innerHTML = `<div class="empty" style="grid-column:1/-1"><p>${esc(e.message)}</p></div>`; }
}

/* ─────────────── Réseaux sociaux ─────────────── */
const SOC_LABELS = {
  x: 'X (Twitter)', tiktok: 'TikTok', instagram: 'Instagram', reddit: 'Reddit',
  youtube: 'YouTube', mastodon: 'Mastodon', archive: 'Internet Archive', facebook: 'Facebook',
};

async function loadSocial() {
  try {
    const { social } = await api('/api/social/status');
    const t = $('#socTools');
    if (t) t.innerHTML = `
      <div class="kv"><span>yt-dlp <span class="hint">vidéos</span></span><b>${social['yt-dlp'].available
        ? `<span class="tag g">v${esc(social['yt-dlp'].version)}</span>`
        : '<span class="tag r">absent</span>'}</b></div>
      <div class="kv"><span>gallery-dl <span class="hint">images</span></span><b>${social['gallery-dl'].available
        ? `<span class="tag g">v${esc(social['gallery-dl'].version)}</span>`
        : '<span class="tag r">absent</span>'}</b></div>`;

    const sel = $('#ckPlatform');
    if (sel && !sel.options.length) {
      sel.innerHTML = social.platforms.filter(p => p.needsCookies)
        .map(p => `<option value="${p.id}">${esc(p.label)}</option>`).join('');
    }
    const list = $('#ckList');
    if (list) list.innerHTML = social.platforms.map(p => {
      const c = p.cookies || {};
      const badge = !p.needsCookies ? '<span class="tag g">ouverte</span>'
        : c.present ? (c.expired ? '<span class="tag r">expirés</span>' : '<span class="tag g">active</span>')
          : '<span class="tag n">cookies requis</span>';
      return `<div class="kv"><span>${esc(p.label)}</span><b>${badge}</b></div>`;
    }).join('');

    const chipHtml = social.platforms.map(p =>
      `<div class="chip ${['archive', 'mastodon'].includes(p.id) ? 'on' : ''}" data-p="${p.id}">${
        esc(p.label)}${p.needsCookies && !p.ready ? ' 🔒' : ''}</div>`).join('');
    for (const id of ['#socPlatforms', '#fSocPlatforms']) {
      const el = $(id);
      if (el && !el.children.length) {
        el.innerHTML = chipHtml;
        el.querySelectorAll('.chip').forEach(ch => ch.addEventListener('click', () => ch.classList.toggle('on')));
      }
    }
  } catch (e) { /* silencieux : panneau secondaire */ }
}
$('#btnSocialRefresh').addEventListener('click', loadSocial);
$('#btnCkSave').addEventListener('click', async () => {
  const platform = $('#ckPlatform').value, content = $('#ckContent').value.trim();
  if (!content) { toast('Collez vos cookies.', 'err'); return; }
  try {
    await api('/api/social/cookies', { body: JSON.stringify({ platform, content }) });
    $('#ckContent').value = '';
    toast(`Session ${SOC_LABELS[platform] || platform} enregistrée.`, 'ok');
    loadSocial();
  } catch (e) { toast(e.message, 'err'); }
});
$('#btnCkDel').addEventListener('click', async () => {
  await fetch('/api/social/cookies/' + $('#ckPlatform').value, { method: 'DELETE' });
  toast('Session supprimée.'); loadSocial();
});
$('#btnSocSearch').addEventListener('click', async () => {
  const q = $('#socQ').value.trim();
  if (!q) { toast('Indiquez des mots-clés.', 'err'); return; }
  const platforms = [...$('#socPlatforms').querySelectorAll('.chip.on')].map(c => c.dataset.p);
  const out = $('#socResults');
  out.innerHTML = '<div class="empty"><span class="spin"></span><p style="margin-top:10px">Collecte…</p></div>';
  try {
    const r = await api('/api/social/search', {
      body: JSON.stringify({
        keywords: q.split(',').map(s => s.trim()).filter(Boolean),
        platforms, perPlatform: 6, browser: $('#ckBrowser').value || undefined,
      }),
    });
    const errs = (r.errors || []).map(e =>
      `<div class="note ${e.authNeeded ? 'warn' : ''}" style="margin-bottom:8px">
        <b>${esc(SOC_LABELS[e.platform] || e.platform)}</b> — ${esc(e.error)}</div>`).join('');
    out.innerHTML = errs + (r.items.length ? `
      <div style="font-size:12px;color:var(--txt-2);margin:10px 0">${r.items.length} média(s) — crédit incrusté indiqué</div>
      ${r.items.slice(0, 12).map(i => `<div class="kv">
        <span>${esc(String(i.title || '(sans titre)').slice(0, 42))}
          <span class="tag ${i.kind === 'video' ? 'b' : 'n'}">${i.kind}</span></span>
        <b style="font-size:11.5px">Source : ${esc(i.credit)}</b></div>`).join('')}`
      : '<div class="empty"><p>Aucun résultat exploitable.</p></div>');
  } catch (e) { out.innerHTML = `<div class="empty"><p>${esc(e.message)}</p></div>`; }
});

/* ─────────────── Pilote auto ─────────────── */
async function loadAuto() {
  try {
    const { autopilot: a } = await api('/api/autopilot');
    $('#badgeAuto').style.display = a.running ? '' : 'none';
    $('#btnAutoToggle').textContent = a.running ? 'Arrêter le pilote' : 'Démarrer le pilote';
    $('#btnAutoToggle').className = 'btn ' + (a.running ? 'dan' : 'pri');
    $('#aInt').value = a.intervalMinutes; $('#aInt').dispatchEvent(new Event('input'));
    $('#aPer').value = a.perRun;
    $('#aMin').value = Math.min(a.targetMinutes, +$('#aMin').max);
    $('#aMin').dispatchEvent(new Event('input'));
    $('#aFmt').value = a.format; $('#aStyle').value = a.style;
    $('#aTopics').value = (a.topics || []).join(', ');
    S.autoFeeds = new Set(a.sources || []);
    $$('#autoFeeds .chip').forEach(c => c.classList.toggle('on', S.autoFeeds.has(c.dataset.f)));
    $('#autoState').innerHTML = `
      <div class="kv"><span>État</span><b><span class="dot ${a.running ? 'g' : 'n'}"></span>
        ${a.running ? 'Actif' : 'Arrêté'}${a.busy ? ' · production en cours' : ''}</b></div>
      <div class="kv"><span>Dernier cycle</span><b>${a.lastRun ? fmtAgo(a.lastRun) : 'jamais'}</b></div>
      <div class="kv"><span>Prochain cycle</span><b>${a.nextRunAt
        ? new Date(a.nextRunAt).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }) : '—'}</b></div>
      <div class="kv"><span>Articles traités</span><b>${a.seenCount}</b></div>`;
    $('#autoProd').innerHTML = a.produced.length ? a.produced.map(p => `
      <div class="kv"><span>${esc(p.topic.slice(0, 44))}</span>
        <b>${p.ok ? '<span class="tag g">OK</span>' : '<span class="tag r">échec</span>'} ${fmtAgo(p.at)}</b></div>`).join('')
      : '<div class="empty"><p>Aucune production automatique.</p></div>';
  } catch (e) { /* silencieux */ }
}
$('#btnAutoToggle').addEventListener('click', async () => {
  const running = $('#btnAutoToggle').textContent.includes('Arrêter');
  try {
    if (running) { await api('/api/autopilot/stop', { body: '{}' }); toast('Pilote arrêté.'); }
    else {
      await api('/api/autopilot/start', {
        body: JSON.stringify({
          intervalMinutes: +$('#aInt').value, perRun: +$('#aPer').value,
          targetMinutes: +$('#aMin').value, format: $('#aFmt').value, style: $('#aStyle').value,
          topics: $('#aTopics').value.split(',').map(s => s.trim()).filter(Boolean),
          sources: [...S.autoFeeds],
        }),
      });
      toast('Pilote démarré — production en continu.', 'ok');
    }
    loadAuto();
  } catch (e) { toast(e.message, 'err'); }
});
$('#btnAutoNow').addEventListener('click', async () => {
  await api('/api/autopilot/run-now', { body: '{}' });
  toast('Cycle lancé — suivez la progression sur le tableau de bord.', 'ok');
  setTimeout(loadAuto, 1500);
});

/* ─────────────── Configuration ─────────────── */
function fillSettings(cfg) {
  const k = cfg.keys, has = cfg._has || {};
  const ph = (id, key, def) => {
    const e = $(id); if (!e) return;
    e.placeholder = has[key] ? 'Clé enregistrée ' + (k[key] || '') : def;
  };
  ph('#kGroq', 'groq', 'gsk_…');
  ph('#kOpenrouter', 'openrouter', 'sk-or-…');
  ph('#kOpenai', 'openai', 'sk-…');
  ph('#kEleven', 'elevenlabs', 'sk_…');
  ph('#kPexels', 'pexels', 'Clé API Pexels');
  ph('#kPixabay', 'pixabay', 'Clé API Pixabay');
  ph('#kUnsplash', 'unsplash', 'Access key Unsplash');
  if (k.openaiModel) $('#kOpenaiModel').value = k.openaiModel;
  if (k.elevenVoice) $('#kElevenVoice').value = k.elevenVoice;

  /* Réglages de production. Absents des anciennes configurations
   * enregistrées : on retombe sur les valeurs par défaut plutôt que de
   * laisser les cases dans un état indéterminé. */
  const p = cfg.production || {};
  const coche = (id, val, defaut) => {
    const e = $(id); if (!e) return;
    e.checked = (val === undefined ? defaut : !!val);
  };
  coche('#oMediaReview', p.mediaReview, true);
  coche('#oFiltreEdito', p.filtreEdito, true);
  const qs = $('#oQualite');
  if (qs) qs.value = (p.modeQualite === false) ? 'rapide' : 'qualite';
  const tm = $('#oTimeoutMult');
  if (tm) tm.value = String(p.timeoutMult || 3);
}
$('#btnSaveKeys').addEventListener('click', async () => {
  const keys = {};
  const g = (id, name) => { const v = $(id).value.trim(); if (v) keys[name] = v; };
  g('#kGroq', 'groq'); g('#kOpenrouter', 'openrouter'); g('#kOpenai', 'openai');
  g('#kOpenaiModel', 'openaiModel'); g('#kEleven', 'elevenlabs'); g('#kElevenVoice', 'elevenVoice');
  g('#kPexels', 'pexels'); g('#kPixabay', 'pixabay'); g('#kUnsplash', 'unsplash');
  // Réglages de production, enregistrés avec les clés.
  const production = {
    mediaReview: $('#oMediaReview') ? $('#oMediaReview').checked : true,
    filtreEdito: $('#oFiltreEdito') ? $('#oFiltreEdito').checked : true,
    modeQualite: $('#oQualite') ? $('#oQualite').value !== 'rapide' : true,
    timeoutMult: $('#oTimeoutMult') ? Number($('#oTimeoutMult').value) || 3 : 3,
  };
  try {
    const j = await api('/api/config', { body: JSON.stringify({ keys, production }) });
    fillSettings(j.config);
    toast('Configuration enregistrée.', 'ok');
    loadHealth(); loadLLM(); loadPlatform();
  } catch (e) { toast(e.message, 'err'); }
});

async function loadLLM() {
  const box = $('#llmBox');
  box.innerHTML = '<div class="empty"><span class="spin"></span></div>';
  try {
    const { llm } = await api('/api/llm/status');
    const cloud = (llm.cloud || []).map(c =>
      `<span class="tag ${c.configured ? 'g' : 'n'}">${esc(c.label)}</span>`).join(' ');
    box.innerHTML = `
      <div class="kv"><span>Source active</span><b>${llm.ready
        ? `<span class="tag g">${esc(llm.activeSource || 'actif')}</span>`
        : '<span class="tag o">AfroWriter local (sans IA)</span>'}</b></div>
      <div class="kv"><span>API cloud</span><b>${cloud || '—'}</b></div>
      <div class="kv"><span>Ollama local</span><b>${llm.ollama && llm.ollama.available
        ? `<span class="tag g">${esc(llm.ollama.best)}</span>`
        : llm.ollama && llm.ollama.disabled
          ? '<span class="tag n">désactivé (conteneur)</span>'
          : '<span class="tag n">non détecté</span>'}</b></div>
      ${!llm.ready && llm.install ? `<div class="note warn" style="margin-top:12px">
        <b>${esc(llm.install.hint)}</b><br>${(llm.install.cloud || []).map(esc).join('<br>')}</div>` : ''}`;
  } catch (e) { box.innerHTML = `<div class="empty"><p>${esc(e.message)}</p></div>`; }
}
$('#btnLlmCheck').addEventListener('click', loadLLM);

async function loadHealth() {
  try {
    const h = await api('/api/health');
    const p = S.platform || await loadPlatform();
    $('#healthBox').innerHTML = `
      <div class="kv"><span>Moteur vidéo</span><b>FFmpeg · ${h.cpus} cœur(s) · ${h.mem}</b></div>
      <div class="kv"><span>Node.js</span><b>${h.node}</b></div>
      <div class="kv"><span>Base de données</span><b>${p && p.db.neon ? 'Neon Postgres' : 'locale'}</b></div>
      <div class="kv"><span>Stockage</span><b>${p && p.storage.mode === 's3' ? 'Cloudflare R2' : 'disque éphémère'}</b></div>
      <div class="kv"><span>Rendus simultanés</span><b>${p ? p.queue.concurrency : 1}</b></div>`;
  } catch (e) { $('#healthBox').innerHTML = `<div class="empty"><p>${esc(e.message)}</p></div>`; }
}

/* ─────────────── Identité de marque ─────────────── */
function fillBrand(cfg) {
  const c = cfg.channel;
  $('#bName').value = c.name; $('#bHandle').value = c.handle; $('#bLogo').value = c.logoText;
  $('#bTag').value = c.tagline; $('#bCta').value = c.cta;
  $('#bPri').value = c.primary; $('#bSec').value = c.secondary;
  $('#bAcc').value = c.accent; $('#bBg').value = c.bg;
  updateBrandPrev();
  ['#bPri', '#bBg', '#bLogo'].forEach(id => $(id).addEventListener('input', updateBrandPrev));
}
function updateBrandPrev() {
  $('#brandPrev').style.background = $('#bBg').value;
  $('#bpTitle').textContent = $('#bLogo').value;
  $('#bpTitle').style.color = $('#bPri').value;
  $('#bpBar').style.background = $('#bPri').value;
}
$('#btnSaveBrand').addEventListener('click', async () => {
  try {
    await api('/api/config', {
      body: JSON.stringify({
        channel: {
          name: $('#bName').value, handle: $('#bHandle').value, logoText: $('#bLogo').value,
          tagline: $('#bTag').value, cta: $('#bCta').value,
          primary: $('#bPri').value, secondary: $('#bSec').value,
          accent: $('#bAcc').value, bg: $('#bBg').value,
        },
      }),
    });
    toast('Identité enregistrée.', 'ok');
  } catch (e) { toast(e.message, 'err'); }
});

/* ═══════════ VALIDATION DES MÉDIAS ═══════════ */
window.reviewStoryboard = async function(id) {
  try {
    const { storyboard: sb } = await api('/api/projects/' + id + '/storyboard');
    const shots = sb.shots || [];
    const totalDur = sb.timeline ? fmtDur(sb.timeline.duration) : '—';

    const shotHtml = shots.map(s => {
      const hasAsset = s.asset && s.asset.file;
      const isModified = s.asset && s.asset.replacedAt;
      const thumbUrl = hasAsset
        ? '/api/media/file?p=' + encodeURIComponent(s.asset.file)
        : null;
      const providerTag = s.asset
        ? (s.asset.genereParIA ? '<span class="tag o">IA</span>'
           : s.asset.provider ? `<span class="tag n">${esc(s.asset.provider)}</span>` : '')
        : '<span class="tag r">manquant</span>';

      return `<div class="rev-shot" id="rev-shot-${s.index}">
        <div class="rev-shot-num">Plan ${s.index + 1}</div>
        <div class="rev-shot-preview" onclick="expandShot(${s.index})">
          ${thumbUrl
            ? `<img src="${esc(thumbUrl)}" alt="" loading="lazy"
                onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">
               <div class="rev-noimg" style="display:none">📷<br>Erreur</div>`
            : `<div class="rev-noimg">📷<br>Aucun visuel</div>`}
        </div>
        <div class="rev-shot-info">
          <div class="rev-shot-narr">${esc((s.narration || '').slice(0, 120))}${(s.narration||'').length > 120 ? '…' : ''}</div>
          <div class="rev-shot-meta">
            ${providerTag}
            <span class="tag n">${fmtDur(s.duration || 0)}</span>
            ${isModified ? '<span class="tag g">✓ Modifié</span>' : ''}
          </div>
          ${s.query ? `<div class="rev-shot-query">🔍 ${esc(s.query)}</div>` : ''}
          <div class="rev-shot-btns">
            <button class="btn xs" onclick="replaceShotPrompt('${id}', ${s.index})">
              🔁 Remplacer
            </button>
          </div>
        </div>
      </div>`;
    }).join('');

    openModal('Validation des médias — ' + esc(sb.title || ''), `
      <div class="rev-summary">
        <div class="rev-stat"><b>${shots.length}</b><span>plans</span></div>
        <div class="rev-stat"><b>${totalDur}</b><span>durée</span></div>
        <div class="rev-stat"><b>${shots.filter(s => s.asset && s.asset.file).length}/${shots.length}</b><span>visuels trouvés</span></div>
      </div>
      <div class="rev-grid">${shotHtml}</div>
      <div class="hr"></div>
      <div class="rev-actions">
        <button class="btn pri" onclick="approveProject('${id}')">
          ✅ Approuver et lancer le rendu
        </button>
        <button class="btn ghost" onclick="closeModal()">Annuler</button>
      </div>
    `);

    // Store storyboard for expand/replace
    S._reviewShots = shots;
    S._reviewProjectId = id;
  } catch (e) {
    toast('Erreur: ' + e.message, 'err');
  }
};

window.expandShot = function(idx) {
  const s = (S._reviewShots || [])[idx];
  if (!s) return;
  const hasAsset = s.asset && s.asset.file;
  const thumbUrl = hasAsset
    ? '/api/media/file?p=' + encodeURIComponent(s.asset.file)
    : null;
  openModal('Plan ' + (idx + 1) + ' — détail', `
    <div class="rev-expand">
      ${thumbUrl
        ? `<img src="${esc(thumbUrl)}" alt="" style="max-width:100%;border-radius:var(--r);margin-bottom:16px"
            onerror="this.style.display='none'">`
        : '<div class="rev-noimg" style="height:200px">📷 Aucun visuel</div>'}
      <div class="kv"><span>Durée</span><b>${fmtDur(s.duration || 0)}</b></div>
      <div class="kv"><span>Visuel prévu</span><b>${esc(s.visual || '—')}</b></div>
      <div class="kv"><span>Recherche</span><b>${esc(s.query || '—')}</b></div>
      <div class="kv"><span>Source</span><b>${s.asset ? esc(s.asset.provider || '—') : 'manquant'}</b></div>
      ${s.credit ? `<div class="kv"><span>Crédit</span><b>${esc(s.credit)}</b></div>` : ''}
      <div class="hr"></div>
      <p style="color:var(--txt-2);font-size:14px;line-height:1.6">${esc(s.narration || '')}</p>
      <div class="btns" style="margin-top:16px">
        <button class="btn xs" onclick="replaceShotPrompt('${S._reviewProjectId}', ${idx})">🔁 Remplacer l'image</button>
        <button class="btn ghost" onclick="reviewStoryboard('${S._reviewProjectId}')">← Retour</button>
      </div>
    </div>
  `);
};

window.replaceShotPrompt = function(id, shotIdx) {
  const s = (S._reviewShots || [])[shotIdx];
  const label = s ? 'Plan ' + (shotIdx + 1) : 'Plan';
  /* Requête pré-remplie : celle que le studio a réellement utilisée pour
   * ce plan. L'utilisateur part donc du contexte du plan au lieu d'une
   * page vide — il ajuste au lieu de tout retaper. */
  const q = (s && (s.query || s.visual)) || '';
  openModal('Remplacer — ' + label, `
    <div class="rev-replace">
      ${s && s.narration ? `<p style="color:var(--txt-2);font-size:13px;margin-bottom:12px;
        border-left:3px solid var(--acc);padding-left:10px">🎙️ ${esc(s.narration.slice(0, 160))}</p>` : ''}

      <div style="margin-bottom:8px;font-weight:600">🔎 Chercher un autre visuel</div>
      <div style="display:flex;gap:8px;margin-bottom:10px">
        <input type="text" id="searchQ" value="${esc(q)}" placeholder="mots-clés (anglais de préférence)"
          onkeydown="if(event.key==='Enter')doSearchShot('${id}',${shotIdx})"
          style="flex:1;padding:12px;background:var(--bg2);border:1px solid var(--bd);border-radius:var(--r);color:var(--txt);font-size:15px">
        <button class="btn" onclick="doSearchShot('${id}', ${shotIdx})">Chercher</button>
      </div>
      <label style="display:flex;align-items:center;gap:6px;font-size:13px;color:var(--txt-2);margin-bottom:12px">
        <input type="checkbox" id="searchVideo"> vidéos uniquement (B-roll)
      </label>

      <div id="searchResults" style="min-height:40px"></div>

      <div class="hr"></div>
      <div style="margin-bottom:8px;font-weight:600">🔗 Ou coller une URL précise</div>
      <input type="url" id="replaceUrl" placeholder="https://exemple.com/image.jpg"
        style="width:100%;padding:12px;background:var(--bg2);border:1px solid var(--bd);border-radius:var(--r);color:var(--txt);font-size:15px;margin-bottom:12px">
      <div class="btns">
        <button class="btn pri" onclick="doReplaceShot('${id}', ${shotIdx})">Télécharger & remplacer</button>
        <button class="btn ghost" onclick="reviewStoryboard('${id}')">← Retour</button>
      </div>
    </div>
  `);
  // Recherche lancée d'emblée : l'utilisateur voit des propositions tout de suite.
  if (q) doSearchShot(id, shotIdx);
};

/* Recherche de visuels de remplacement, affichés en galerie cliquable.
 * Utilise /api/media/search, qui interroge toute la cascade de banques. */
window.doSearchShot = async function(id, shotIdx) {
  const qEl = $('#searchQ'); const box = $('#searchResults');
  if (!qEl || !box) return;
  const q = qEl.value.trim();
  if (!q) { box.innerHTML = '<p style="color:var(--txt-2)">Saisissez des mots-clés.</p>'; return; }
  const video = $('#searchVideo') && $('#searchVideo').checked ? '1' : '0';
  box.innerHTML = '<p style="color:var(--txt-2)">Recherche en cours…</p>';
  try {
    const { results } = await api('/api/media/search?q=' + encodeURIComponent(q)
      + '&video=' + video + '&limit=18');
    if (!results || !results.length) {
      box.innerHTML = '<p style="color:var(--txt-2)">Aucun résultat — essayez d\'autres mots-clés, en anglais.</p>';
      return;
    }
    S._searchResults = results;
    box.innerHTML = '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(120px,1fr));gap:8px">'
      + results.map((r, i) => {
        const t = r.thumb || r.url;
        return `<div onclick="pickSearchResult('${id}',${shotIdx},${i})"
          title="${esc(r.title || '')} — ${esc(r.provider || '')}"
          style="cursor:pointer;border:1px solid var(--bd);border-radius:var(--r);overflow:hidden;background:var(--bg2)">
          <img src="${esc(t)}" loading="lazy" style="width:100%;height:80px;object-fit:cover;display:block"
            onerror="this.style.display='none'">
          <div style="font-size:10px;padding:4px;color:var(--txt-2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">
            ${esc(r.provider || '')}${r.kind === 'video' ? ' 🎬' : ''}
          </div>
        </div>`;
      }).join('') + '</div>';
  } catch (e) {
    box.innerHTML = '<p style="color:var(--dan)">Erreur : ' + esc(e.message) + '</p>';
  }
};

/* Applique un résultat choisi dans la galerie. On passe l'asset complet :
 * le serveur le télécharge et conserve licence, auteur et page source,
 * donc le crédit reste correct à l'écran. */
window.pickSearchResult = async function(id, shotIdx, i) {
  const asset = (S._searchResults || [])[i];
  if (!asset) return;
  try {
    toast('Téléchargement…');
    await api('/api/projects/' + id + '/storyboard/' + shotIdx + '/replace', {
      body: JSON.stringify({ asset })
    });
    toast('✅ Visuel remplacé', 'ok');
    await reviewStoryboard(id);
  } catch (e) {
    toast('Erreur: ' + e.message, 'err');
  }
};

window.doReplaceShot = async function(id, shotIdx) {
  const url = $('#replaceUrl').value.trim();
  if (!url) { toast('URL requise', 'err'); return; }
  try {
    toast('Téléchargement…');
    await api('/api/projects/' + id + '/storyboard/' + shotIdx + '/replace', {
      body: JSON.stringify({ url })
    });
    toast('✅ Visuel remplacé', 'ok');
    // Refresh the review modal
    await reviewStoryboard(id);
  } catch (e) {
    toast('Erreur: ' + e.message, 'err');
  }
};

window.approveProject = async function(id) {
  try {
    closeModal();
    toast('Lancement du rendu…');
    await api('/api/projects/' + id + '/approve', { body: '{}' });
    toast('✅ Rendu lancé !', 'ok');
    loadDash();
    pollVideo(id);
  } catch (e) {
    toast('Erreur: ' + e.message, 'err');
  }
};

/* Rafraîchissement discret du tableau de bord */
setInterval(() => { if ($('#p-dash').classList.contains('on')) loadDash(); }, 30000);
