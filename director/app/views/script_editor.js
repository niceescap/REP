// =============================================================================
// Rush Event Pilot — Timeline Editor (script_editor.js)
// =============================================================================
// Ce script gère toute l'interface du réalisateur :
//   - Authentification JWT
//   - Chargement / création de projets
//   - Gestion des blocs (plans) synchronisée avec l'API
//   - Affichage de la timeline avec statut "pourvu" (rushs matchés)
// =============================================================================

// ── CONFIGURATION ──────────────────────────────────────────────────────────
const API = '';  // même origine, pas de préfixe d'hôte

// ── ÉTAT GLOBAL ────────────────────────────────────────────────────────────
let token = localStorage.getItem('rep_token') || null;
let currentProject = null;          // { project_uid, label, prescript, ... }
let blocks = [];                    // liste des plans affichés dans la timeline
let activeBlockId = null;           // identifiant du bloc sélectionné (panneau de droite)
let totalDuration = 90;             // durée totale du projet en minutes
let zoom = 1;                       // facteur de zoom de la timeline
let selectedType = 'ouverture';     // type de plan sélectionné par défaut dans le formulaire

// Correspondance type → couleur / libellé (utilisé dans le CSS et l'affichage)
const TYPE_COLORS = {
  ouverture:  '#4DA6FF', interview: '#FF5E3A',
  broll:      '#A8FF47', transition: '#C47FFF', cloture: '#FFB830',
};
const TYPE_LABELS = {
  ouverture: 'Ouverture', interview: 'Interview',
  broll: 'B-Roll', transition: 'Transition', cloture: 'Clôture',
};

// ── UTILITAIRES ────────────────────────────────────────────────────────────

/** Formatte un nombre de minutes en chaîne lisible (ex: 1h30, 5 min) */
function fmtMin(m) {
  const h = Math.floor(m / 60);
  const mn = Math.round(m % 60);
  if (h > 0) return `${h}h${mn.toString().padStart(2,'0')}`;
  return `${mn} min`;
}

/** Affiche un message temporaire en bas de l'écran (toast) */
function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 2200);
}

/** Construit les headers HTTP pour les requêtes authentifiées */
function authHeaders() {
  return {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json'
  };
}

/**
 * Effectue une requête vers l'API et gère les erreurs automatiquement.
 * @param {string} path - Chemin absolu (ex: '/api/projects')
 * @param {object} opts - Options fetch supplémentaires
 * @returns {object|null} Données JSON ou null en cas d'échec
 */
async function apiFetch(path, opts = {}) {
  const res = await fetch(API + path, {
    ...opts,
    headers: { ...authHeaders(), ...(opts.headers || {}) }
  });
  if (res.status === 401) {          // token expiré ou invalide → déconnexion
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

// ── AUTHENTIFICATION ───────────────────────────────────────────────────────

/** Déconnecte l'utilisateur, efface le token et affiche la modale de connexion */
function logout() {
  token = null;
  localStorage.removeItem('rep_token');
  currentProject = null;
  blocks = [];
  document.getElementById('loginModal').classList.add('open');
  document.getElementById('projectModal').classList.remove('open');
}

/** Gère la soumission du formulaire de connexion */
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
  loadProjectList();   // une fois connecté, affiche la liste des projets
});

// ── GESTION DES PROJETS ────────────────────────────────────────────────────

/**
 * Charge la liste des projets de l'utilisateur et ouvre la modale de sélection.
 */
async function loadProjectList() {
  const data = await apiFetch('/api/projects');
  if (!data) return;
  const list = document.getElementById('projectList');
  list.innerHTML = '';
  if (data.length === 0) {
    list.innerHTML = '<div style="color:var(--muted);font-size:13px">Aucun projet — créez-en un ci-dessous.</div>';
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

/** Ferme la modale des projets */
function hideProjectModal() {
  document.getElementById('projectModal').classList.remove('open');
}

/**
 * Ouvre un projet : met à jour l'état, change le titre, et charge ses blocs.
 * @param {object} p - Objet projet (project_uid, label, ...)
 */
async function openProject(p) {
  currentProject = p;
  hideProjectModal();
  document.getElementById('projectName').value = p.label;
  // Transforme le bouton "Créer projet" en indicateur "Projet actif"
  document.getElementById('saveBtn').innerHTML = `
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <path d="M19 21H5a2 2 0 01-2-2V5a2 2 0 012-2h11l5 5v11a2 2 0 01-2 2z"/>
    </svg> Projet actif`;
  await loadBlocks();
  showToast(`Projet "${p.label}" chargé`);
}

// ── CRÉATION D'UN PROJET (bouton principal) ────────────────────────────────
document.getElementById('saveBtn').addEventListener('click', async () => {
  if (currentProject) {
    showToast('Projet déjà actif — modifiez les blocs directement');
    return;
  }
  const label = document.getElementById('projectName').value.trim();
  if (!label) { showToast('⚠ Donnez un nom au projet'); return; }
  const data = await apiFetch('/api/projects', {
    method: 'POST',
    body: JSON.stringify({ label, prescript: '' })
  });
  if (!data) return;
  await openProject(data);
  showToast(`Projet "${data.label}" créé ✓`);
});

// ── CRÉATION D'UN PROJET DEPUIS LA MODALE ──────────────────────────────────
document.getElementById('createProjectBtn').addEventListener('click', async () => {
  const label = document.getElementById('newProjectLabel').value.trim();
  if (!label) { showToast('⚠ Donnez un nom'); return; }
  const data = await apiFetch('/api/projects', {
    method: 'POST',
    body: JSON.stringify({ label, prescript: '' })
  });
  if (!data) return;
  await openProject(data);
  showToast(`Projet "${data.label}" créé ✓`);
});

// ── DÉCONNEXION DEPUIS LA MODALE ──────────────────────────────────────────
document.getElementById('modalLogoutBtn').addEventListener('click', () => {
  hideProjectModal();
  logout();
});

// ── GESTION DES BLOCS (PLANS) ──────────────────────────────────────────────

/**
 * Charge les blocs du projet courant depuis l'API.
 * Puis enrichit avec les rushs pour déterminer le statut "pourvu".
 */
async function loadBlocks() {
  if (!currentProject) return;
  const data = await apiFetch(`/api/projects/${currentProject.project_uid}/blocks`);
  if (!data) return;
  // Adaptation des champs de l'API vers le modèle interne
  blocks = data.map(b => ({
    id: b.id,
    type: b.type,
    name: b.name,
    desc: b.description,
    duration: b.duration,
    keywords: Array.isArray(b.keywords) ? b.keywords : (b.keywords || '').split(',').map(s=>s.trim()),
    pourvu: null
  }));
  await enrichBlocksWithRushes();
  renderTimeline();
}

/**
 * Interroge les rushs du projet et, pour chaque bloc, cherche si un rush y est matché.
 * Remplit alors le champ `pourvu` avec les infos du rush.
 */
async function enrichBlocksWithRushes() {
  if (!currentProject) return;
  const rushes = await apiFetch(`/api/projects/${currentProject.project_uid}/rushes`);
  if (!rushes) return;
  blocks.forEach(b => {
    const match = rushes.find(r => r.matched_plan == b.id || r.matched_plan == String(b.id));
    if (match) {
      let cadreur = 'cadreur';
      try {
        const meta = JSON.parse(match.metadata || '{}');
        cadreur = meta.cadreur || cadreur;
      } catch(e) {}
      b.pourvu = {
        cadreur: cadreur,
        filename: match.filename,
        date: match.uploaded_at ? match.uploaded_at.slice(0,10) : '',
        heure: match.uploaded_at ? match.uploaded_at.slice(11,16) : '',
        score: match.score || '?',
      };
    } else {
      b.pourvu = null;
    }
  });
}

// ── AJOUTER UN BLOC (formulaire de gauche) ─────────────────────────────────
document.getElementById('addBlockBtn').addEventListener('click', async () => {
  if (!currentProject) { showToast('⚠ Ouvrez ou créez un projet d\'abord'); return; }
  const name = document.getElementById('newBlockName').value.trim();
  const desc = document.getElementById('newBlockDesc').value.trim();
  const dur  = Math.max(1, parseInt(document.getElementById('newBlockDur').value) || 5);
  const payload = {
    type: selectedType,
    name: name,
    description: desc,
    duration: dur,
    keywords: []
  };
  const data = await apiFetch(`/api/projects/${currentProject.project_uid}/blocks`, {
    method: 'POST',
    body: JSON.stringify(payload)
  });
  if (!data) return;
  // Ajoute le nouveau bloc dans l'état local
  blocks.push({
    id: data.id, type: data.type, name: data.name,
    desc: data.description, duration: data.duration,
    keywords: data.keywords, pourvu: null
  });
  // Réinitialise les champs du formulaire
  document.getElementById('newBlockName').value = '';
  document.getElementById('newBlockDesc').value = '';
  document.getElementById('newBlockDur').value = 5;
  renderTimeline();
  showToast('Plan ajouté ✓');
});

/**
 * Sauvegarde les modifications d'un bloc vers l'API.
 * @param {object} b - Le bloc (issu de l'état `blocks`)
 */
async function saveBlockToAPI(b) {
  if (!currentProject) return;
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

/**
 * Supprime un bloc via l'API et le retire de l'état local.
 * @param {number} id - Identifiant du bloc à supprimer
 */
async function deleteBlock(id) {
  if (!currentProject) return;
  await apiFetch(`/api/projects/${currentProject.project_uid}/blocks/${id}`, {
    method: 'DELETE'
  });
  blocks = blocks.filter(x => x.id != id);
  closeDetail();
  renderTimeline();
  showToast('Plan supprimé');
}

// ── RÈGLE GRADUÉE (RULER) ─────────────────────────────────────────────────
function drawRuler() {
  const canvas = document.getElementById('rulerCanvas');
  const track  = document.getElementById('timelineTrack');
  const W = track.scrollWidth || 600;
  canvas.width = W; canvas.height = 28;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, W, 28);
  ctx.font = '9px JetBrains Mono, monospace';
  const pxPerMin = (W - 32) / totalDuration;
  const step = totalDuration <= 30 ? 1 : totalDuration <= 90 ? 5 : totalDuration <= 180 ? 10 : 15;
  for (let m = 0; m <= totalDuration; m += step) {
    const x = 16 + m * pxPerMin;
    ctx.fillStyle = '#353545'; ctx.fillRect(x, 18, 1, 10);
    ctx.fillStyle = '#6B6B85'; ctx.fillText(fmtMin(m), x + 2, 14);
  }
}

// ── RENDU DE LA TIMELINE ───────────────────────────────────────────────────
function renderTimeline() {
  const track = document.getElementById('timelineTrack');
  const empty = document.getElementById('emptyState');
  const trackWidth = Math.max(600, 800 * zoom);
  // Supprime tous les blocs existants dans le DOM
  [...track.querySelectorAll('.block')].forEach(el => el.remove());

  if (blocks.length === 0) {
    empty.style.display = 'flex';
    empty.style.minWidth = trackWidth + 'px';
    drawRuler();
    updateFooter();
    return;
  }
  empty.style.display = 'none';

  // Pour chaque bloc, on crée un élément HTML proportionnel à sa durée
  blocks.forEach(b => {
    const ratio = b.duration / (totalDuration || 1);
    const w = Math.max(70, Math.floor(ratio * trackWidth));
    const el = document.createElement('div');
    el.className = `block type-${b.type}${b.pourvu ? ' pourvu' : ''}`;
    el.dataset.id = b.id;
    el.style.width = w + 'px';
    el.style.flexShrink = '0';
    if (b.id === activeBlockId) el.classList.add('active');
    el.innerHTML = `
      <div class="block-label">${TYPE_LABELS[b.type] || b.type}</div>
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

// ── REDIMENSIONNEMENT DES BLOCS (poignées) ─────────────────────────────────
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
      renderTimeline();
      if (activeBlockId == blockId) refreshDetailDuration(b.duration);
    };

    // Événements souris
    handle.addEventListener('mousedown', e => {
      e.stopPropagation();
      startResize(e.clientX, handle.dataset.id);
      const onMove = e => doResize(e.clientX);
      const onUp = () => {
        const b = blocks.find(b => b.id == blockId);
        if (b) saveBlockToAPI(b);   // sauvegarde après le redimensionnement
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
      };
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });

    // Événements tactiles
    handle.addEventListener('touchstart', e => {
      e.stopPropagation();
      startResize(e.touches[0].clientX, handle.dataset.id);
      const onMove = e => {
        e.preventDefault();
        doResize(e.touches[0].clientX);
      };
      const onEnd = () => {
        const b = blocks.find(b => b.id == blockId);
        if (b) saveBlockToAPI(b);
        document.removeEventListener('touchmove', onMove);
        document.removeEventListener('touchend', onEnd);
      };
      document.addEventListener('touchmove', onMove, { passive: false });
      document.addEventListener('touchend', onEnd);
    });
  });
}

// ── PIED DE TIMELINE (compteurs) ──────────────────────────────────────────
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

// ── PANNEAU DE DÉTAIL D'UN BLOC ────────────────────────────────────────────

/**
 * Ouvre le panneau de droite avec les informations du bloc.
 * @param {number} id - Identifiant du bloc
 */
function openDetail(id) {
  activeBlockId = id;
  const b = blocks.find(x => x.id == id);
  if (!b) return;

  const c = TYPE_COLORS[b.type];
  document.getElementById('detailBadge').textContent = TYPE_LABELS[b.type] || b.type;
  document.getElementById('detailBadge').style.setProperty('--dc', c);

  // Construction du contenu du panneau (y compris la bannière "pourvu" si applicable)
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

  // ── Écouteurs d'événements (dans openDetail pour être sûrs qu'ils existent) ──
  document.getElementById('det-name').addEventListener('input', e => {
    b.name = e.target.value;
    renderTimeline();
  });
  document.getElementById('det-desc').addEventListener('input', e => {
    b.desc = e.target.value;
  });
  document.getElementById('det-kw').addEventListener('input', e => {
    b.keywords = e.target.value.split(',').map(s => s.trim()).filter(Boolean);
  });
  document.getElementById('det-dur-range').addEventListener('input', e => {
    b.duration = parseInt(e.target.value);
    document.getElementById('det-dur-val').textContent = fmtMin(b.duration);
    renderTimeline();
  });
  // Bouton "Enregistrer" → sauvegarde via l'API
  document.getElementById('det-save').addEventListener('click', async () => {
    await saveBlockToAPI(b);
    showToast('Plan sauvegardé ✓');
  });
  // Bouton "Supprimer"
  document.getElementById('det-delete').addEventListener('click', () => deleteBlock(id));

  renderTimeline();
}

/** Met à jour l'affichage de la durée dans le panneau (appelé depuis le resize) */
function refreshDetailDuration(dur) {
  const r = document.getElementById('det-dur-range');
  const v = document.getElementById('det-dur-val');
  if (r) r.value = dur;
  if (v) v.textContent = fmtMin(dur);
}

/** Ferme le panneau de détail */
function closeDetail() {
  activeBlockId = null;
  document.getElementById('detailPanel').classList.remove('open');
  renderTimeline();
}

document.getElementById('detailClose').addEventListener('click', closeDetail);

// ── SÉLECTION DU TYPE DE PLAN (formulaire de gauche) ────────────────────────
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
  if (!currentProject) { showToast('⚠ Ouvrez un projet d\'abord'); return; }
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
        const payload = {
          type: type,
          name: name,
          description: '',
          duration: 5,
          keywords: []
        };
        const data = await apiFetch(`/api/projects/${currentProject.project_uid}/blocks`, {
          method: 'POST',
          body: JSON.stringify(payload)
        });
        if (data) {
          blocks.push({ id: data.id, type: data.type, name: data.name,
                        desc: data.description, duration: data.duration,
                        keywords: [], pourvu: null });
          added++;
        }
      }
    }
    renderTimeline();
    showToast(`${added} plan(s) importé(s) ✓`);
  };
  reader.readAsText(file);
  e.target.value = '';
});

// ── BOUTON "PROJETS" DANS LA TOPBAR ────────────────────────────────────────
document.getElementById('openProjectsBtn').addEventListener('click', loadProjectList);

// ── INITIALISATION ─────────────────────────────────────────────────────────
(function init() {
  renderTimeline();   // affiche une timeline vide
  if (!token) {
    // Pas de token → modale de connexion
    document.getElementById('loginModal').classList.add('open');
  } else {
    // Token existant → liste des projets
    loadProjectList();
  }
})();
