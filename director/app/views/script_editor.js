// =============================================================================
// Rush Event Pilot — Éditeur de Timeline (script_editor.js)
// =============================================================================
// Ce script gère toute l'interface du réalisateur :
//   1. Authentification (login / mode invité)
//   2. Gestion des projets (créer, ouvrir, sauvegarder)
//   3. Gestion des blocs/plans (ajouter, modifier, supprimer)
//   4. Rendu de la timeline (blocs proportionnels, règle, curseur)
//   5. Panneau de prévisualisation (détails du bloc sélectionné)
//
// Le script est chargé en fin de <body> : tous les éléments DOM existent déjà.
// =============================================================================

// ── CONFIGURATION ──────────────────────────────────────────────
// L'API est servie sur la même URL que le frontend (pas de préfixe)
const API = '';

// ── ÉTAT GLOBAL ────────────────────────────────────────────────
// Ces variables stockent l'état courant de l'application.
let token = localStorage.getItem('rep_token') || null;  // JWT d'auth
let currentProject = null;    // Projet actif : { _draft, label, project_uid }
let blocks = [];               // Liste des plans [{ id, type, name, desc, duration, keywords, pourvu, _dirty }]
let activeBlockId = null;      // ID du bloc sélectionné (null = aucun)
let totalDuration = 90;        // Durée totale du projet en minutes
let zoom = 1;                  // Niveau de zoom (0.5 à 4)
let selectedType = 'ouverture'; // Type de plan sélectionné dans le formulaire
let cursorPos = 0;             // Position du curseur de navigation en minutes

// Couleurs par type de plan
const TYPE_COLORS = {
  ouverture: '#4DA6FF', interview: '#FF5E3A',
  broll: '#A8FF47', transition: '#C47FFF', cloture: '#FFB830',
};
// Libellés affichés par type de plan
const TYPE_LABELS = {
  ouverture: 'Ouverture', interview: 'Interview',
  broll: 'B-Roll', transition: 'Transition', cloture: 'Clôture',
};

// ── UTILITAIRES ────────────────────────────────────────────────

/**
 * Formate un nombre de minutes en texte lisible.
 * Ex : 5 → "5 min", 65 → "1h05", 90 → "1h30"
 */
function fmtMin(m) {
  const h = Math.floor(m / 60);
  const mn = Math.round(m % 60);
  if (h > 0) return `${h}h${mn.toString().padStart(2, '0')}`;
  return `${mn} min`;
}

/**
 * Affiche un message temporaire (toast) en bas de l'écran.
 * Disparaît automatiquement après 2,2 secondes.
 */
function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 2200);
}

/**
 * Renvoie les en-têtes HTTP pour les requêtes API authentifiées.
 */
function authHeaders() {
  return {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json'
  };
}

/**
 * Effectue une requête API et gère les erreurs courantes (401, réseau).
 * Renvoie le JSON de la réponse, ou null en cas d'erreur.
 */
async function apiFetch(path, opts = {}) {
  try {
    const res = await fetch(API + path, {
      ...opts,
      headers: { ...authHeaders(), ...(opts.headers || {}) }
    });
    if (res.status === 401) {
      if (token) { logout(); } else { showToast('⚠ Connexion requise'); }
      return null;
    }
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      showToast('⚠ ' + (err.detail || 'Erreur API'));
      return null;
    }
    return res.json();
  } catch (e) {
    showToast('⚠ Erreur réseau');
    return null;
  }
}

// ── AUTHENTIFICATION ────────────────────────────────────────────

/** Déconnexion : efface le token et réinitialise l'état */
function logout() {
  token = null;
  localStorage.removeItem('rep_token');
  initDraftProject();
  renderTimeline();
  updateSaveButton();
  document.getElementById('loginModal').classList.add('open');
  document.getElementById('projectModal').classList.remove('open');
}

/** Mode invité : ferme la modale et initialise un brouillon local */
function enterGuestMode() {
  document.getElementById('loginModal').classList.remove('open');
  document.getElementById('loginError').textContent = '';
  initDraftProject();
  renderTimeline();
  updateSaveButton();
  showToast('Mode invité — plans en local uniquement');
}

// ── GESTION DES PROJETS ────────────────────────────────────────

/** Initialise un projet brouillon (non sauvegardé en base) */
function initDraftProject() {
  currentProject = { _draft: true, label: 'Sans titre', project_uid: null };
  blocks = [];
  activeBlockId = null;
  cursorPos = 0;
  document.getElementById('projectName').value = 'Sans titre';
  closeDetail();
}

/** Charge la liste des projets depuis l'API et affiche la modale */
async function loadProjectList() {
  const data = await apiFetch('/api/projects');
  if (!data) return;
  const list = document.getElementById('projectList');
  list.innerHTML = '';
  if (data.length === 0) {
    list.innerHTML = '<p class="muted-text">Aucun projet — créez-en un ci-dessous.</p>';
  }
  data.forEach(p => {
    const el = document.createElement('div');
    el.className = 'proj-item';
    el.innerHTML = `<div class="proj-item-label">${p.label}</div><div class="proj-item-uid">${p.project_uid}</div>`;
    el.addEventListener('click', () => openProject(p));
    list.appendChild(el);
  });
  document.getElementById('projectModal').classList.add('open');
}

/** Ferme la modale des projets */
function hideProjectModal() {
  document.getElementById('projectModal').classList.remove('open');
}

/** Ouvre un projet existant (charge ses blocs depuis l'API) */
async function openProject(p) {
  const hasDirty = blocks.some(b => b._dirty);
  if (hasDirty && currentProject && currentProject._draft) {
    if (!confirm('Modifications non sauvegardées. Les abandonner ?')) return;
  }
  currentProject = { project_uid: p.project_uid, label: p.label, _draft: false };
  hideProjectModal();
  document.getElementById('projectName').value = p.label;
  updateSaveButton();
  await loadBlocks();
  showToast(`Projet "${p.label}" chargé`);
}

// ── BOUTON SAUVEGARDER / CRÉER ─────────────────────────────────

/** Met à jour le texte du bouton principal selon l'état du projet */
function updateSaveButton() {
  const btn = document.getElementById('saveBtn');
  if (!currentProject || currentProject._draft) {
    btn.textContent = '💾 Créer projet';
  } else {
    btn.textContent = '💾 Enregistrer';
  }
}

// ── GESTION DES BLOCS ──────────────────────────────────────────

/** Charge les blocs d'un projet depuis l'API */
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
    keywords: Array.isArray(b.keywords) ? b.keywords : [],
    pourvu: null,
    _dirty: false
  }));
  await enrichBlocksWithRushes();
  renderTimeline();
}

/** Associe les rushs aux blocs (statut "pourvu") en interrogeant l'API */
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
      } catch (e) { /* metadata invalide → on garde "cadreur" */ }
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

/** Sauvegarde un bloc modifié vers l'API (PUT) */
async function saveBlockToAPI(b) {
  if (!currentProject || currentProject._draft) return;
  if (String(b.id).startsWith('tmp_')) return;
  await apiFetch(`/api/projects/${currentProject.project_uid}/blocks/${b.id}`, {
    method: 'PUT',
    body: JSON.stringify({
      type: b.type, name: b.name, description: b.desc,
      duration: b.duration, keywords: b.keywords
    })
  });
}

/** Supprime un bloc (local si brouillon, API si projet connecté) */
async function deleteBlock(id) {
  if (!currentProject) return;
  if (currentProject._draft || String(id).startsWith('tmp_')) {
    blocks = blocks.filter(x => x.id != id);
    closeDetail();
    renderTimeline();
    showToast('Plan supprimé');
    return;
  }
  await apiFetch(`/api/projects/${currentProject.project_uid}/blocks/${id}`, { method: 'DELETE' });
  blocks = blocks.filter(x => x.id != id);
  closeDetail();
  renderTimeline();
  showToast('Plan supprimé');
}

// ── RENDU DE LA TIMELINE ───────────────────────────────────────

/**
 * Calcule la largeur de la piste en pixels selon le zoom.
 * Base : au moins 320px (taille mobile), plafonnée à 4000px.
 */
function getTrackWidth() {
  const base = Math.max(320, window.innerWidth * 1.2);
  return Math.min(base * zoom, 4000);
}

/**
 * Rend la timeline : crée les éléments DOM pour chaque bloc,
 * dessine la règle, positionne le curseur, met à jour les compteurs.
 */
function renderTimeline() {
  const track = document.getElementById('timelineTrack');
  const inner = document.getElementById('timelineInner');
  const empty = document.getElementById('emptyState');
  const cursor = document.getElementById('timelineCursor');
  const trackWidth = getTrackWidth();

  // Fixe la largeur du contenu intérieur (pour le scroll horizontal)
  inner.style.minWidth = trackWidth + 'px';

  // Vider les anciens blocs (on garde emptyState et cursor qui ne sont pas .block)
  [...track.querySelectorAll('.block')].forEach(el => el.remove());

  if (blocks.length === 0) {
    // État vide
    empty.style.display = 'flex';
    cursor.style.display = 'none';
    drawRuler();
    updateFooter();
    return;
  }
  empty.style.display = 'none';
  cursor.style.display = 'block';

  // Créer un élément DOM pour chaque bloc
  blocks.forEach(b => {
    // Largeur proportionnelle à la durée du bloc vs durée totale
    const ratio = b.duration / (totalDuration || 1);
    const w = Math.max(70, Math.floor(ratio * trackWidth));
    const el = document.createElement('div');
    el.className = `block type-${b.type}`;
    if (b.pourvu) el.classList.add('pourvu');
    if (b._dirty) el.classList.add('dirty');
    if (b.id === activeBlockId) el.classList.add('active');
    el.dataset.id = b.id;
    el.style.width = w + 'px';
    el.style.flexShrink = '0';
    el.innerHTML = `
      <div class="block-label">${TYPE_LABELS[b.type] || b.type}</div>
      <div class="block-name">${b.name || 'Plan sans titre'}</div>
      <div class="block-duration">${fmtMin(b.duration)}</div>
      ${b.pourvu ? `<div class="block-badge">✓ ${b.pourvu.cadreur}</div>` : ''}
    `;
    // Clic sur un bloc → ouvrir le panneau de détail
    el.addEventListener('click', () => openDetail(b.id));
    track.appendChild(el);
  });

  drawRuler();
  updateCursor();
  updateFooter();
}

/**
 * Dessine la règle graduée sur le canvas.
 * Les graduations s'adaptent à la durée totale (toutes les 1, 5, 10 ou 15 min).
 */
function drawRuler() {
  const canvas = document.getElementById('rulerCanvas');
  const trackWidth = getTrackWidth();
  canvas.width = trackWidth;
  canvas.height = 28;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, trackWidth, 28);
  ctx.font = '9px monospace';
  // Espacement des graduations selon la durée totale
  const step = totalDuration <= 30 ? 1 : totalDuration <= 90 ? 5 : totalDuration <= 180 ? 10 : 15;
  const pxPerMin = trackWidth / totalDuration;
  for (let m = 0; m <= totalDuration; m += step) {
    const x = m * pxPerMin;
    ctx.fillStyle = '#353545';
    ctx.fillRect(x, 18, 1, 10);           // trait
    ctx.fillStyle = '#6B6B85';
    ctx.fillText(fmtMin(m), x + 3, 14);   // texte
  }
}

/** Met à jour la position visuelle du curseur de navigation */
function updateCursor() {
  const cursor = document.getElementById('timelineCursor');
  const trackWidth = getTrackWidth();
  const left = (cursorPos / (totalDuration || 1)) * trackWidth;
  cursor.style.left = left + 'px';
  document.getElementById('cursorTime').textContent = fmtMin(Math.round(cursorPos));
}

/** Met à jour les compteurs en bas de la timeline */
function updateFooter() {
  const total = blocks.reduce((s, b) => s + b.duration, 0);
  const pourvuCount = blocks.filter(b => b.pourvu).length;
  document.getElementById('blockCount').textContent = blocks.length;
  document.getElementById('plannedTotal').textContent = fmtMin(total);
  document.getElementById('totalDisplay').textContent = fmtMin(totalDuration);
  const coverEl = document.getElementById('coverageCount');
  coverEl.textContent = pourvuCount;
  coverEl.style.color = pourvuCount === blocks.length && blocks.length > 0 ? '#A8FF47' : '#FFB830';
}

// ── CURSEUR DE NAVIGATION ─────────────────────────────────────

/**
 * Convertit une position en pixels (clientX) en minutes sur la timeline.
 * Utilise getBoundingClientRect() qui tient compte du scroll horizontal.
 */
function pixelToMinutes(clientX) {
  const track = document.getElementById('timelineTrack');
  const rect = track.getBoundingClientRect();
  const x = clientX - rect.left;
  const trackWidth = getTrackWidth();
  const minutes = (x / trackWidth) * totalDuration;
  return Math.max(0, Math.min(totalDuration, minutes));
}

/**
 * Configure le drag du curseur (souris + touch) et le clic sur la règle.
 * Appelé une seule fois au chargement.
 */
function setupCursorDrag() {
  const cursor = document.getElementById('timelineCursor');
  let isDragging = false;

  function startDrag(e) {
    e.stopPropagation();
    isDragging = true;
    document.body.style.userSelect = 'none';  // empêche la sélection de texte
  }
  function doDrag(clientX) {
    if (!isDragging) return;
    cursorPos = pixelToMinutes(clientX);
    updateCursor();
  }
  function endDrag() {
    isDragging = false;
    document.body.style.userSelect = '';
  }

  // Événements souris
  cursor.addEventListener('mousedown', startDrag);
  document.addEventListener('mousemove', e => doDrag(e.clientX));
  document.addEventListener('mouseup', endDrag);

  // Événements tactiles (pour mobile)
  cursor.addEventListener('touchstart', e => { e.preventDefault(); startDrag(e); }, { passive: false });
  document.addEventListener('touchmove', e => {
    if (isDragging) { e.preventDefault(); doDrag(e.touches[0].clientX); }
  }, { passive: false });
  document.addEventListener('touchend', endDrag);

  // Clic sur la règle → déplacer le curseur à cette position
  const ruler = document.querySelector('.ruler');
  if (ruler) {
    ruler.addEventListener('click', e => {
      if (blocks.length > 0) {
        cursorPos = pixelToMinutes(e.clientX);
        updateCursor();
      }
    });
  }
}

// ── PANNEAU DE DÉTAIL (ZONE PREVIEW) ────────────────────────────

/**
 * Ouvre le panneau de détail pour un bloc donné.
 * Construit le HTML avec les champs éditables et la bannière "pourvu" le cas échéant.
 */
function openDetail(id) {
  activeBlockId = id;
  const b = blocks.find(x => x.id == id);
  if (!b) return;

  // Masquer l'état vide, afficher l'en-tête
  document.getElementById('previewEmpty').hidden = true;
  document.getElementById('detailHeader').hidden = false;
  document.getElementById('previewArea').classList.add('open');

  // Badge coloré selon le type
  const c = TYPE_COLORS[b.type];
  const badge = document.getElementById('detailBadge');
  badge.textContent = TYPE_LABELS[b.type] || b.type;
  badge.style.color = c;
  badge.style.background = c + '22';  // '22' = ~13% d'opacité en hex

  // Construire le HTML du corps
  document.getElementById('detailBody').innerHTML = `
    ${b.pourvu ? `
    <div class="pourvu-banner">
      <div class="pourvu-check">✅</div>
      <div class="pourvu-meta">
        <div class="pourvu-meta-title">Plan pourvu</div>
        <div class="pourvu-meta-line">Cadreur : <strong>${b.pourvu.cadreur}</strong></div>
        <div class="pourvu-meta-line">Tourné le : ${b.pourvu.date} à ${b.pourvu.heure}</div>
        <div class="pourvu-filename">${b.pourvu.filename}</div>
        <div class="pourvu-score">Confiance Qwen : ${b.pourvu.score}%</div>
      </div>
    </div>` : ''}
    ${currentProject && currentProject._draft ? `
    <div class="draft-banner">⚠ Plan non sauvegardé — créez le projet pour le persister</div>` : ''}
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
    <button class="btn btn-primary btn-sm" id="det-save" style="width:100%;margin-top:8px">Enregistrer</button>
    <button class="btn btn-ghost btn-sm" id="det-delete" style="width:100%;margin-top:4px;color:#FF5E3A">Supprimer ce plan</button>
  `;

  // Listeners sur les champs éditables
  document.getElementById('det-name').addEventListener('input', e => {
    b.name = e.target.value; b._dirty = true; renderTimeline();
  });
  document.getElementById('det-desc').addEventListener('input', e => {
    b.desc = e.target.value; b._dirty = true;
  });
  document.getElementById('det-kw').addEventListener('input', e => {
    b.keywords = e.target.value.split(',').map(s => s.trim()).filter(Boolean);
    b._dirty = true;
  });
  document.getElementById('det-dur-range').addEventListener('input', e => {
    b.duration = parseInt(e.target.value); b._dirty = true;
    document.getElementById('det-dur-val').textContent = fmtMin(b.duration);
    renderTimeline();
  });
  document.getElementById('det-save').addEventListener('click', async () => {
    if (currentProject && !currentProject._draft && !String(b.id).startsWith('tmp_')) {
      await saveBlockToAPI(b);
      b._dirty = false;
      renderTimeline();
      showToast('Plan sauvegardé ✓');
    } else {
      showToast('Plan modifié (local) — créez le projet pour sauvegarder');
    }
  });
  document.getElementById('det-delete').addEventListener('click', () => deleteBlock(id));

  renderTimeline();
}

/** Ferme le panneau de détail et revient à l'état vide */
function closeDetail() {
  activeBlockId = null;
  document.getElementById('previewArea').classList.remove('open');
  document.getElementById('detailHeader').hidden = true;
  document.getElementById('detailBody').innerHTML = '';
  document.getElementById('previewEmpty').hidden = false;
  renderTimeline();
}

// ── ÉVÉNEMENTS DOM ─────────────────────────────────────────────

// --- Authentification : bouton invité ---
document.getElementById('guestBtn').addEventListener('click', enterGuestMode);

// --- Authentification : formulaire de connexion ---
document.getElementById('loginForm').addEventListener('submit', async e => {
  e.preventDefault();
  const username = document.getElementById('loginUser').value.trim();
  const password = document.getElementById('loginPass').value;
  const body = new URLSearchParams({ username, password });
  try {
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
    document.getElementById('loginError').textContent = '';
    initDraftProject();
    renderTimeline();
    updateSaveButton();
    showToast('Connecté — commencez à construire votre timeline');
  } catch (e) {
    document.getElementById('loginError').textContent = 'Erreur réseau';
  }
});

// --- Bouton sauvegarder / créer projet ---
document.getElementById('saveBtn').addEventListener('click', async () => {
  const label = document.getElementById('projectName').value.trim();
  if (!label) { showToast('⚠ Donnez un nom au projet'); return; }

  // Cas 1 : projet brouillon → créer le projet + POST tous les blocs
  if (currentProject && currentProject._draft) {
    const data = await apiFetch('/api/projects', {
      method: 'POST',
      body: JSON.stringify({ label })
    });
    if (!data) return;
    currentProject = { project_uid: data.project_uid, label: data.label, _draft: false };
    document.getElementById('projectName').value = data.label;
    updateSaveButton();
    let saved = 0;
    for (const b of blocks) {
      const payload = { type: b.type, name: b.name, description: b.desc, duration: b.duration, keywords: b.keywords };
      const blockData = await apiFetch(`/api/projects/${currentProject.project_uid}/blocks`, {
        method: 'POST', body: JSON.stringify(payload)
      });
      if (blockData) { b.id = blockData.id; b._dirty = false; saved++; }
    }
    showToast(`Projet "${label}" créé ✓ · ${saved} plan(s) sauvegardé(s)`);
    renderTimeline();
    return;
  }

  // Cas 2 : projet connecté → PUT les blocs modifiés
  if (currentProject && !currentProject._draft) {
    let saved = 0;
    for (const b of blocks.filter(b => b._dirty && !String(b.id).startsWith('tmp_'))) {
      await saveBlockToAPI(b);
      b._dirty = false;
      saved++;
    }
    showToast(saved > 0 ? `${saved} plan(s) sauvegardé(s) ✓` : 'Aucune modification');
    renderTimeline();
    return;
  }
});

// --- Bouton projets (topbar) ---
document.getElementById('openProjectsBtn').addEventListener('click', loadProjectList);

// --- Création de projet depuis la modale ---
document.getElementById('createProjectBtn').addEventListener('click', async () => {
  const label = document.getElementById('newProjectLabel').value.trim();
  if (!label) { showToast('⚠ Donnez un nom'); return; }
  const data = await apiFetch('/api/projects', {
    method: 'POST', body: JSON.stringify({ label })
  });
  if (!data) return;
  document.getElementById('newProjectLabel').value = '';
  await openProject(data);
  showToast(`Projet "${data.label}" créé ✓`);
});

// --- Fermeture modale projets ---
document.getElementById('projectModalClose').addEventListener('click', hideProjectModal);
document.getElementById('projectModal').addEventListener('click', e => {
  if (e.target === document.getElementById('projectModal')) hideProjectModal();
});

// --- Déconnexion ---
document.getElementById('modalLogoutBtn').addEventListener('click', () => {
  hideProjectModal();
  logout();
});

// --- Fermeture panneau de détail ---
document.getElementById('detailClose').addEventListener('click', closeDetail);

// --- Ajout de bloc (bouton principal) ---
document.getElementById('addBlockBtn').addEventListener('click', async () => {
  if (!currentProject) { showToast('⚠ Aucun projet actif'); return; }
  const name = document.getElementById('newBlockName').value.trim();
  const desc = document.getElementById('newBlockDesc').value.trim();
  const dur = Math.max(1, parseInt(document.getElementById('newBlockDur').value) || 5);

  if (currentProject._draft) {
    // Mode brouillon : ajout local uniquement
    blocks.push({
      id: 'tmp_' + Date.now(),
      type: selectedType,
      name: name || 'Plan sans titre',
      desc: desc,
      duration: dur,
      keywords: [],
      pourvu: null,
      _dirty: true
    });
    renderTimeline();
    showToast('Plan ajouté (non sauvegardé)');
  } else {
    // Projet connecté : POST immédiat vers l'API
    const data = await apiFetch(`/api/projects/${currentProject.project_uid}/blocks`, {
      method: 'POST',
      body: JSON.stringify({ type: selectedType, name: name || 'Plan sans titre', description: desc, duration: dur, keywords: [] })
    });
    if (data) {
      blocks.push({
        id: data.id, type: data.type, name: data.name,
        desc: data.description, duration: data.duration,
        keywords: data.keywords || [], pourvu: null, _dirty: false
      });
      renderTimeline();
      showToast('Plan ajouté ✓');
    }
  }

  // Vider le formulaire
  document.getElementById('newBlockName').value = '';
  document.getElementById('newBlockDesc').value = '';
  document.getElementById('newBlockDur').value = 5;
});

// --- Bouton "ajouter" dans l'état vide ---
document.getElementById('emptyAddBlockBtn').addEventListener('click', () => {
  document.getElementById('addBlockBtn').click();
});

// --- Sélection du type de plan (boutons) ---
document.querySelectorAll('.type-opt').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.type-opt').forEach(b => b.classList.remove('sel'));
    btn.classList.add('sel');
    selectedType = btn.dataset.type;
  });
});

// --- Changement de la durée totale ---
document.getElementById('totalDurationInput').addEventListener('change', e => {
  totalDuration = Math.max(1, parseInt(e.target.value) || 90);
  renderTimeline();
  updateFooter();
});

// --- Zoom in / out ---
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

// --- Import Markdown ---
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
  e.target.value = '';  // reset pour permettre de réimporter le même fichier
});

// ── INITIALISATION ─────────────────────────────────────────────

// Re-rend la timeline quand la fenêtre change de taille (rotation mobile)
window.addEventListener('resize', () => renderTimeline());

// Configure le drag du curseur (une seule fois au chargement)
setupCursorDrag();

// Initialise un brouillon vide
initDraftProject();
updateSaveButton();

// Affiche la modale de connexion si pas de token
if (!token) {
  document.getElementById('loginModal').classList.add('open');
}
