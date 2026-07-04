// =============================================================================
// Rush Event Pilot — Timeline Editor (script_editor.js)
// =============================================================================
// Mode "bac à sable" : la timeline est éditable immédiatement dans un projet
// implicite non sauvegardé (comme un document Word sans titre).
// La persistance (création projet + blocs) se fait en un clic.
// =============================================================================

// ── CONFIGURATION ──────────────────────────────────────────────────────────
const API = '';

// ── ÉTAT GLOBAL ────────────────────────────────────────────────────────────
let token = localStorage.getItem('rep_token') || null;
let currentProject = null;          // { _draft:true, label, project_uid:null } ou { project_uid, label }
let blocks = [];                    // liste des plans, chaque bloc a { id, type, name, desc, duration, keywords, pourvu, _dirty }
let activeBlockId = null;
let totalDuration = 90;
let zoom = 1;
let selectedType = 'ouverture';

const TYPE_COLORS = {
  ouverture: '#4DA6FF', interview: '#FF5E3A',
  broll: '#A8FF47', transition: '#C47FFF', cloture: '#FFB830',
};
const TYPE_LABELS = {
  ouverture: 'Ouverture', interview: 'Interview',
  broll: 'B-Roll', transition: 'Transition', cloture: 'Clôture',
};

// ── UTILITAIRES ────────────────────────────────────────────────────────────

function fmtMin(m) {
  const h = Math.floor(m / 60);
  const mn = Math.round(m % 60);
  if (h > 0) return `${h}h${mn.toString().padStart(2, '0')}`;
  return `${mn} min`;
}

function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 2200);
}

function authHeaders() {
  return {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json'
  };
}

async function apiFetch(path, opts = {}) {
  const res = await fetch(API + path, {
    ...opts,
    headers: { ...authHeaders(), ...(opts.headers || {}) }
  });
  if (res.status === 401) {
    logout();
    return null;
  }
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    showToast('⚠ ' + (err.detail || 'Erreur API'));
    return null;
  }
  return res.json();
}

/** Met à jour le libellé et l'icône du bouton principal selon l'état */
function updateSaveButton() {
  const btn = document.getElementById('saveBtn');
  if (!currentProject || currentProject._draft) {
    btn.innerHTML = `
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M19 21H5a2 2 0 01-2-2V5a2 2 0 012-2h11l5 5v11a2 2 0 01-2 2z"/>
        <polyline points="17 21 17 13 7 13 7 21"/>
        <polyline points="7 3 7 8 15 8"/>
      </svg> Créer projet`;
  } else {
    btn.innerHTML = `
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M19 21H5a2 2 0 01-2-2V5a2 2 0 012-2h11l5 5v11a2 2 0 01-2 2z"/>
        <polyline points="17 21 17 13 7 13 7 21"/>
        <polyline points="7 3 7 8 15 8"/>
      </svg> Enregistrer`;
  }
}

// ── AUTHENTIFICATION ───────────────────────────────────────────────────────

function logout() {
  token = null;
  localStorage.removeItem('rep_token');
  currentProject = null;
  blocks = [];
  document.getElementById('loginModal').classList.add('open');
  document.getElementById('projectModal').classList.remove('open');
  updateSaveButton();
  renderTimeline();
}

document.getElementById('loginForm').addEventListener('submit', async e => {
  e.preventDefault();
  const username = document.getElementById('loginUser').value.trim();
  const password = document.getElementById('loginPass').value;
  const body = new URLSearchParams({ username, password });
  const res = await fetch(API + '/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body
  });
  if (!res.ok) {
    document.getElementById('loginError').textContent = 'Identifiants incorrects';
    return;
  }
  const data = await res.json();
  token = data.access_token;
  localStorage.setItem('rep_token', token);
  document.getElementById('loginModal').classList.remove('open');
  initDraftProject();
  renderTimeline();
  showToast('Connecté — commencez à construire votre timeline');
});

// ── PROJET DRAFT (bac à sable) ─────────────────────────────────────────────

/** Initialise un projet non sauvegardé (mode brouillon). */
function initDraftProject() {
  currentProject = { _draft: true, label: 'Sans titre', project_uid: null };
  blocks = [];
  document.getElementById('projectName').value = 'Sans titre';
  updateSaveButton();
}

// ── GESTION DES PROJETS ────────────────────────────────────────────────────

async function loadProjectList() {
  const data = await apiFetch('/api/projects');
  if (!data) return;
  const list = document.getElementById('projectList');
  list.innerHTML = '';
  if (data.length === 0) {
    list.innerHTML = '<div style="color:var(--muted);font-size:13px;padding:8px 0">Aucun projet — créez-en un ci-dessous.</div>';
  }
  data.forEach(p => {
    const el = document.createElement('div');
    el.className = 'proj-item';
    el.innerHTML = `
      <div class="proj-item-label">${p.label}</div>
      <div class="proj-item-uid">${p.project_uid}</div>
    `;
    el.addEventListener('click', () => openProject(p));
    list.appendChild(el);
  });
  document.getElementById('projectModal').classList.add('open');
}

function hideProjectModal() {
  document.getElementById('projectModal').classList.remove('open');
}

/** Ouvre un projet existant (remplace le brouillon en cours). */
async function openProject(p) {
  const hasDirtyBlocks = blocks.some(b => b._dirty);
  if (hasDirtyBlocks && currentProject && currentProject._draft) {
    if (!confirm('Vous avez des modifications non sauvegardées. Les abandonner ?')) return;
  }
  currentProject = { project_uid: p.project_uid, label: p.label, _draft: false };
  hideProjectModal();
  document.getElementById('projectName').value = p.label;
  updateSaveButton();
  await loadBlocks();
  showToast(`Projet "${p.label}" chargé`);
}

// ── BOUTON PRINCIPAL : CRÉER / ENREGISTRER ─────────────────────────────────

document.getElementById('saveBtn').addEventListener('click', async () => {
  const label = document.getElementById('projectName').value.trim();
  if (!label) { showToast('⚠ Donnez un nom au projet'); return; }

  // Cas 1 : projet brouillon → création groupée (projet + blocs)
  if (currentProject && currentProject._draft) {
    const data = await apiFetch('/api/projects', {
      method: 'POST',
      body: JSON.stringify({ label })
    });
    if (!data) return;

    currentProject = { project_uid: data.project_uid, label: data.label, _draft: false };
    document.getElementById('projectName').value = data.label;
    updateSaveButton();

    // Envoyer tous les blocs un par un
    let saved = 0;
    for (const b of blocks) {
      const payload = { type: b.type, name: b.name, description: b.desc, duration: b.duration, keywords: b.keywords };
      const blockData = await apiFetch(`/api/projects/${currentProject.project_uid}/blocks`, {
        method: 'POST',
        body: JSON.stringify(payload)
      });
      if (blockData) {
        b.id = blockData.id;
        b._dirty = false;
        saved++;
      }
    }
    showToast(`Projet "${label}" créé ✓ · ${saved} plan(s) sauvegardé(s)`);
    renderTimeline();
    return;
  }

  // Cas 2 : projet connecté → sauvegarde des blocs modifiés
  if (currentProject && !currentProject._draft) {
    let saved = 0;
    for (const b of blocks.filter(b => b._dirty)) {
      await saveBlockToAPI(b);
      b._dirty = false;
      saved++;
    }
    showToast(saved > 0 ? `${saved} plan(s) sauvegardé(s) ✓` : 'Aucune modification');
    return;
  }
});

// ── CRÉATION DE PROJET DEPUIS LA MODALE ────────────────────────────────────
document.getElementById('createProjectBtn').addEventListener('click', async () => {
  const label = document.getElementById('newProjectLabel').value.trim();
  if (!label) { showToast('⚠ Donnez un nom'); return; }
  const data = await apiFetch('/api/projects', {
    method: 'POST',
    body: JSON.stringify({ label })
  });
  if (!data) return;
  await openProject(data);
  showToast(`Projet "${data.label}" créé ✓`);
});

// ── FERMETURE MODALE PROJETS ───────────────────────────────────────────────
document.getElementById('projectModalClose').addEventListener('click', hideProjectModal);
document.getElementById('projectModal').addEventListener('click', e => {
  if (e.target === document.getElementById('projectModal')) hideProjectModal();
});

// ── DÉCONNEXION ────────────────────────────────────────────────────────────
document.getElementById('modalLogoutBtn').addEventListener('click', () => {
  hideProjectModal();
  logout();
});

// ── GESTION DES BLOCS ──────────────────────────────────────────────────────

async function loadBlocks() {
  if (!currentProject || currentProject._draft) return;
  const data = await apiFetch(`/api/projects/${currentProject.project_uid}/blocks`);
  if (!data) return;
  blocks = data.map(b => ({
    id: b.id,
    type: b.type,
    name: b.name,
    desc: b.description,
    duration: b.duration,
    keywords: Array.isArray(b.keywords) ? b.keywords : (b.keywords || '').split(',').map(s => s.trim()),
    pourvu: null,
    _dirty: false
  }));
  await enrichBlocksWithRushes();
  renderTimeline();
}

async function enrichBlocksWithRushes() {
  if (!currentProject || currentProject._draft) return;
  const rushes = await apiFetch(`/api/projects/${currentProject.project_uid}/rushes`);
  if (!rushes) return;
  blocks.forEach(b => {
    const match = rushes.find(r => r.matched_plan == b.id || r.matched_plan == String(b.id));
    if (match) {
      let cadreur = 'cadreur';
      try {
        const meta = JSON.parse(match.metadata || '{}');
        cadreur = meta.cadreur || cadreur;
      } catch (e) { }
      b.pourvu = {
        cadreur: cadreur,
        filename: match.filename,
        date: match.uploaded_at ? match.uploaded_at.slice(0, 10) : '',
        heure: match.uploaded_at ? match.uploaded_at.slice(11, 16) : '',
        score: match.score || '?',
      };
    } else {
      b.pourvu = null;
    }
  });
}

// ── AJOUTER UN BLOC (formulaire de gauche) ─────────────────────────────────
document.getElementById('addBlockBtn').addEventListener('click', () => {
  if (!currentProject) { showToast('⚠ Aucun projet actif'); return; }
  const name = document.getElementById('newBlockName').value.trim();
  const desc = document.getElementById('newBlockDesc').value.trim();
  const dur = Math.max(1, parseInt(document.getElementById('newBlockDur').value) || 5);

  const newBlock = {
    id: 'tmp_' + Date.now(),
    type: selectedType,
    name: name || 'Plan sans titre',
    desc: desc,
    duration: dur,
    keywords: [],
    pourvu: null,
    _dirty: true
  };
  blocks.push(newBlock);
  document.getElementById('newBlockName').value = '';
  document.getElementById('newBlockDesc').value = '';
  document.getElementById('newBlockDur').value = 5;
  renderTimeline();
  showToast('Plan ajouté' + (currentProject._draft ? ' (non sauvegardé)' : ''));
});

// ── BOUTON DANS L'ÉTAT VIDE ────────────────────────────────────────────────
document.getElementById('emptyAddBlockBtn').addEventListener('click', () => {
  document.getElementById('addBlockBtn').click();
});

async function saveBlockToAPI(b) {
  if (!currentProject || currentProject._draft) return;
  await apiFetch(`/api/projects/${currentProject.project_uid}/blocks/${b.id}`, {
    method: 'PUT',
    body: JSON.stringify({
      type: b.type,
      name: b.name,
      description: b.desc,
      duration: b.duration,
      keywords: b.keywords
    })
  });
}

async function deleteBlock(id) {
  if (!currentProject) return;
  const b = blocks.find(x => x.id == id);

  // Si brouillon ou ID temporaire → suppression locale uniquement
  if (currentProject._draft || String(id).startsWith('tmp_')) {
    blocks = blocks.filter(x => x.id != id);
    closeDetail();
    renderTimeline();
    showToast('Plan supprimé');
    return;
  }

  // Projet connecté → suppression API
  await apiFetch(`/api/projects/${currentProject.project_uid}/blocks/${id}`, { method: 'DELETE' });
  blocks = blocks.filter(x => x.id != id);
  closeDetail();
  renderTimeline();
  showToast('Plan supprimé');
}

// ── RÈGLE GRADUÉE ─────────────────────────────────────────────────────────
function drawRuler() {
  const canvas = document.getElementById('rulerCanvas');
  const track = document.getElementById('timelineTrack');
  const W = track.scrollWidth || 600;
  canvas.width = W;
  canvas.height = 28;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, W, 28);
  ctx.font = '9px JetBrains Mono, monospace';
  const pxPerMin = (W - 32) / totalDuration;
  const step = totalDuration <= 30 ? 1 : totalDuration <= 90 ? 5 : totalDuration <= 180 ? 10 : 15;
  for (let m = 0; m <= totalDuration; m += step) {
    const x = 16 + m * pxPerMin;
    ctx.fillStyle = '#353545';
    ctx.fillRect(x, 18, 1, 10);
    ctx.fillStyle = '#6B6B85';
    ctx.fillText(fmtMin(m), x + 2, 14);
  }
}

// ── RENDU DE LA TIMELINE ───────────────────────────────────────────────────
function renderTimeline() {
  const track = document.getElementById('timelineTrack');
  const empty = document.getElementById('emptyState');
  const trackWidth = Math.max(600, 800 * zoom);

  [...track.querySelectorAll('.block')].forEach(el => el.remove());

  if (blocks.length === 0) {
    empty.style.display = 'flex';
    empty.style.minWidth = trackWidth + 'px';
    drawRuler();
    updateFooter();
    return;
  }
  empty.style.display = 'none';

  blocks.forEach(b => {
    const ratio = b.duration / (totalDuration || 1);
    const w = Math.max(70, Math.floor(ratio * trackWidth));
    const el = document.createElement('div');
    el.className = `block type-${b.type}${b.pourvu ? ' pourvu' : ''}${b._dirty ? ' dirty' : ''}`;
    el.dataset.id = b.id;
    el.style.width = w + 'px';
    el.style.flexShrink = '0';
    if (b.id === activeBlockId) el.classList.add('active');
    el.innerHTML = `
      <div class="block-label">${TYPE_LABELS[b.type] || b.type}${b._dirty ? ' ·' : ''}</div>
      <div class="block-name">${b.name || 'Plan sans titre'}</div>
      <div class="block-duration">${fmtMin(b.duration)}${b.pourvu ? ` · <span style="color:#A8FF47;font-size:9px">${b.pourvu.cadreur}</span>` : ''}</div>
      <div class="block-resize" data-id="${b.id}"></div>
    `;
    el.addEventListener('click', e => {
      if (e.target.classList.contains('block-resize')) return;
      openDetail(b.id);
    });
    track.appendChild(el);
  });

  setupResizeHandles();
  drawRuler();
  updateFooter();
}

// ── REDIMENSIONNEMENT ──────────────────────────────────────────────────────
function setupResizeHandles() {
  document.querySelectorAll('.block-resize').forEach(handle => {
    let startX, startDur, blockId;

    const startResize = (x, id) => {
      startX = x;
      blockId = id;
      const b = blocks.find(b => b.id == id);
      startDur = b.duration;
    };

    const doResize = (x) => {
      const trackWidth = Math.max(600, 800 * zoom);
      const pxPerMin = trackWidth / totalDuration;
      const b = blocks.find(b => b.id == blockId);
      if (!b) return;
      b.duration = Math.max(1, Math.round(startDur + (x - startX) / pxPerMin));
      b._dirty = true;
      renderTimeline();
      if (activeBlockId == blockId) refreshDetailDuration(b.duration);
    };

    const finalizeResize = () => {
      const b = blocks.find(b => b.id == blockId);
      // Sauvegarde auto en mode connecté
      if (b && currentProject && !currentProject._draft) {
        saveBlockToAPI(b).then(() => { b._dirty = false; renderTimeline(); });
      }
    };

    handle.addEventListener('mousedown', e => {
      e.stopPropagation();
      startResize(e.clientX, handle.dataset.id);
      const onMove = e => doResize(e.clientX);
      const onUp = () => {
        finalizeResize();
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
      };
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });

    handle.addEventListener('touchstart', e => {
      e.stopPropagation();
      startResize(e.touches[0].clientX, handle.dataset.id);
      const onMove = e => { e.preventDefault(); doResize(e.touches[0].clientX); };
      const onEnd = () => {
        finalizeResize();
        document.removeEventListener('touchmove', onMove);
        document.removeEventListener('touchend', onEnd);
      };
      document.addEventListener('touchmove', onMove, { passive: false });
      document.addEventListener('touchend', onEnd);
    });
  });
}

// ── PIED DE TIMELINE ───────────────────────────────────────────────────────
function updateFooter() {
  const total = blocks.reduce((s, b) => s + b.duration, 0);
  const pourvuCount = blocks.filter(b => b.pourvu).length;
  document.getElementById('blockCount').textContent = blocks.length;
  document.getElementById('plannedTotal').textContent = fmtMin(total);
  document.getElementById('totalDisplay').textContent = fmtMin(totalDuration);
  const coverEl = document.getElementById('coverageCount');
  if (coverEl) {
    coverEl.textContent = pourvuCount;
    coverEl.style.color = pourvuCount === blocks.length && blocks.length > 0 ? '#A8FF47' : '#FFB830';
  }
}

// ── PANNEAU DE DÉTAIL ──────────────────────────────────────────────────────
function openDetail(id) {
  activeBlockId = id;
  const b = blocks.find(x => x.id == id);
  if (!b) return;

  const c = TYPE_COLORS[b.type];
  document.getElementById('detailBadge').textContent = TYPE_LABELS[b.type] || b.type;
  document.getElementById('detailBadge').style.setProperty('--dc', c);

  document.getElementById('detailBody').innerHTML = `
    ${b.pourvu ? `
    <div class="pourvu-banner">
      <div class="pourvu-check">✅</div>
      <div class="pourvu-meta">
        <div class="pourvu-meta-title">Plan pourvu</div>
        <div class="pourvu-meta-line">Cadreur : <span>${b.pourvu.cadreur}</span></div>
        <div class="pourvu-meta-line">Tourné le : <span>${b.pourvu.date}</span> à <span>${b.pourvu.heure}</span></div>
        <div class="pourvu-filename">${b.pourvu.filename}</div>
        <div class="pourvu-score">Confiance Qwen : ${b.pourvu.score}%</div>
      </div>
    </div>` : ''}
    ${currentProject && currentProject._draft ? `
    <div class="draft-banner">
      ⚠ Plan non sauvegardé — créez le projet pour le persister
    </div>` : ''}
    <div class="detail-field">
      <div class="detail-field-label">Intitulé du plan</div>
      <input class="detail-input" id="det-name" value="${b.name || ''}">
    </div>
    <div class="detail-field">
      <div class="detail-field-label">Description attendue</div>
      <textarea class="detail-input detail-textarea" id="det-desc">${b.desc || ''}</textarea>
    </div>
    <div class="detail-field">
      <div class="detail-field-label">Mots-clés Qwen</div>
      <input class="detail-input" id="det-kw" placeholder="ex. speaker, podium" value="${(b.keywords || []).join(', ')}">
    </div>
    <div class="detail-field">
      <div class="detail-field-label">Durée estimée</div>
      <div class="detail-duration-row">
        <input type="range" id="det-dur-range" min="1" max="${totalDuration}" value="${b.duration}">
        <span class="detail-duration-val" id="det-dur-val">${fmtMin(b.duration)}</span>
      </div>
    </div>
    <div class="detail-field" style="margin-top:8px">
      <button class="btn btn-primary btn-sm" id="det-save" style="width:100%">Enregistrer</button>
    </div>
    <div class="detail-field" style="margin-top:8px;padding-top:12px;border-top:1px solid var(--border)">
      <button class="btn btn-ghost btn-sm" id="det-delete" style="color:#FF5E3A;border-color:#FF5E3A33;width:100%">
        Supprimer ce plan
      </button>
    </div>
  `;

  document.getElementById('detailPanel').classList.add('open');

  document.getElementById('det-name').addEventListener('input', e => {
    b.name = e.target.value;
    b._dirty = true;
    renderTimeline();
  });
  document.getElementById('det-desc').addEventListener('input', e => {
    b.desc = e.target.value;
    b._dirty = true;
  });
  document.getElementById('det-kw').addEventListener('input', e => {
    b.keywords = e.target.value.split(',').map(s => s.trim()).filter(Boolean);
    b._dirty = true;
  });
  document.getElementById('det-dur-range').addEventListener('input', e => {
    b.duration = parseInt(e.target.value);
    b._dirty = true;
    document.getElementById('det-dur-val').textContent = fmtMin(b.duration);
    renderTimeline();
  });
  document.getElementById('det-save').addEventListener('click', async () => {
    if (currentProject && !currentProject._draft) {
      await saveBlockToAPI(b);
      b._dirty = false;
      renderTimeline();
    }
    showToast(currentProject && currentProject._draft
      ? 'Plan modifié (local) — créez le projet pour sauvegarder'
      : 'Plan sauvegardé ✓');
  });
  document.getElementById('det-delete').addEventListener('click', () => deleteBlock(id));

  renderTimeline();
}

function refreshDetailDuration(dur) {
  const r = document.getElementById('det-dur-range');
  const v = document.getElementById('det-dur-val');
  if (r) r.value = dur;
  if (v) v.textContent = fmtMin(dur);
}

function closeDetail() {
  activeBlockId = null;
  document.getElementById('detailPanel').classList.remove('open');
  renderTimeline();
}

document.getElementById('detailClose').addEventListener('click', closeDetail);

// ── SÉLECTION DU TYPE ──────────────────────────────────────────────────────
document.querySelectorAll('.type-opt').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.type-opt').forEach(b => b.classList.remove('sel'));
    btn.classList.add('sel');
    selectedType = btn.dataset.type;
  });
});

// ── DURÉE TOTALE ───────────────────────────────────────────────────────────
document.getElementById('totalDurationInput').addEventListener('change', e => {
  totalDuration = Math.max(1, parseInt(e.target.value) || 90);
  renderTimeline();
});

// ── ZOOM ───────────────────────────────────────────────────────────────────
document.getElementById('zoomIn').addEventListener('click', () => {
  zoom = Math.min(4, zoom + 0.25);
  document.getElementById('zoomLabel').textContent = Math.round(zoom * 100) + '%';
  renderTimeline();
});
document.getElementById('zoomOut').addEventListener('click', () => {
  zoom = Math.max(0.5, zoom - 0.25);
  document.getElementById('zoomLabel').textContent = Math.round(zoom * 100) + '%';
  renderTimeline();
});

// ── IMPORT MARKDOWN ────────────────────────────────────────────────────────
document.getElementById('importMdBtn').addEventListener('click', () => {
  document.getElementById('mdFileInput').click();
});
document.getElementById('mdFileInput').addEventListener('change', async e => {
  if (!currentProject) { showToast('⚠ Aucun projet actif'); return; }
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = async ev => {
    const lines = ev.target.result.split('\n');
    let added = 0;
    for (const line of lines) {
      const m2 = line.match(/^##\s+(.+)/);
      const m3 = line.match(/^###\s+(.+)/);
      if (m2 || m3) {
        const name = (m2 || m3)[1].trim();
        const type = m3 ? 'broll' : 'interview';
        if (currentProject._draft) {
          blocks.push({ id: 'tmp_' + Date.now() + '_' + added, type, name, desc: '', duration: 5, keywords: [], pourvu: null, _dirty: true });
          added++;
        } else {
          const data = await apiFetch(`/api/projects/${currentProject.project_uid}/blocks`, {
            method: 'POST', body: JSON.stringify({ type, name, description: '', duration: 5, keywords: [] })
          });
          if (data) {
            blocks.push({ id: data.id, type: data.type, name: data.name, desc: data.description, duration: data.duration, keywords: [], pourvu: null, _dirty: false });
            added++;
          }
        }
      }
    }
    renderTimeline();
    showToast(`${added} plan(s) importé(s) ✓`);
  };
  reader.readAsText(file);
  e.target.value = '';
});

// ── BOUTON PROJETS DANS LA TOPBAR ──────────────────────────────────────────
document.getElementById('openProjectsBtn').addEventListener('click', loadProjectList);

// ── INITIALISATION ─────────────────────────────────────────────────────────
(function init() {
  if (!token) {
    document.getElementById('loginModal').classList.add('open');
  } else {
    initDraftProject();
  }
  renderTimeline();
  updateSaveButton();
})();