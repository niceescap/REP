# app/routers/uploads.py
#
# Ce routeur gère la réception des rushs envoyés par les cadreurs.
# Particularité : pas de JWT ici — l'accès cadreur se fait par ID projet uniquement.
# Le réalisateur, lui, a besoin du JWT pour consulter les rushs.

import os
import json
import uuid
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form
from app.database import get_db
from app.auth import get_current_user
from app.matching import match_rush_to_plan

# Même préfixe que projects.py — les routes s'ajoutent à /projects
router = APIRouter(prefix="/projects", tags=["uploads"])

# Dossier racine de stockage des fichiers
# __file__ = app/routers/uploads.py → on remonte deux fois pour atteindre ~/REP/data/storage
STORAGE_ROOT = os.path.join(os.path.dirname(__file__), "..", "..", "data", "storage")


# ── Helpers ───────────────────────────────────────────────────────────────────

def project_dir(project_uid: str) -> str:
    """
    Retourne le chemin du dossier du projet, et le crée s'il n'existe pas.
    Chaque projet a son propre dossier dans STORAGE_ROOT.
    """
    path = os.path.join(STORAGE_ROOT, project_uid)
    os.makedirs(path, exist_ok=True)
    return path

def check_project_exists(project_uid: str, db):
    """
    Vérifie qu'un projet existe en base — utilisé pour l'accès cadreur sans JWT.
    Lève une 404 si le projet n'existe pas.
    """
    row = db.execute(
        "SELECT project_uid FROM projects WHERE project_uid = ?",
        (project_uid,)
    ).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Projet introuvable")


# ── POST /api/projects/{project_uid}/rushes ───────────────────────────────────
# Accessible aux cadreurs SANS JWT — ils connaissent seulement l'ID projet.
# Reçoit : un fichier (video/photo) + une description texte + des métadonnées JSON

@router.post("/{project_uid}/rushes")
async def upload_rush(
    project_uid: str,
    file: UploadFile = File(...),        # fichier binaire obligatoire
    description: str = Form(...),        # texte libre obligatoire
    metadata: str = Form("{}"),          # JSON optionnel — ex: {"cadreur":"cam1"}
    db=Depends(get_db),
):
    """
    Endpoint pour déposer un rush (vidéo/photo).
    - project_uid : identifiant unique du projet (ex: REP_2_evenement-test1)
    - file : fichier multimédia uploadé par le cadreur
    - description : texte décrivant le contenu du rush (utilisé pour le matching)
    - metadata : JSON facultatif avec des infos supplémentaires (cadreur, lieu, etc.)
    """

    # 1. Vérifier que le projet existe
    check_project_exists(project_uid, db)

    # 2. Valider que metadata est bien du JSON
    try:
        meta_dict = json.loads(metadata)
    except json.JSONDecodeError:
        raise HTTPException(status_code=400, detail="metadata doit être un JSON valide")

    # 3. Générer un nom de fichier unique pour éviter les collisions
    ext = os.path.splitext(file.filename)[1] if file.filename else ""
    filename = f"{uuid.uuid4().hex}{ext}"   # ex: a3f9c21d...mp4

    # 4. Écrire le fichier sur le disque
    dest = os.path.join(project_dir(project_uid), filename)
    with open(dest, "wb") as f:
        content = await file.read()         # lecture asynchrone du fichier uploadé
        f.write(content)

    # 5. Insérer le rush en base
    # matched_plan sera rempli plus tard par le système de matching (Qwen ou fallback)
    db.execute(
        """INSERT INTO rushes
           (project_uid, filename, mimetype, description, metadata)
           VALUES (?, ?, ?, ?, ?)""",
        (project_uid, filename, file.content_type, description, json.dumps(meta_dict))
    )
    db.commit()

    # 6. Récupérer l'id auto-incrémenté de l'insertion
    rush_id = db.execute("SELECT last_insert_rowid()").fetchone()[0]

    # ── Matching automatique ───────────────────────────────────────────────
    # Récupérer tous les blocs/plans du projet depuis la table `blocks`
    blocks_rows = db.execute(
        "SELECT id, name, description, keywords FROM blocks WHERE project_uid = ?",
        (project_uid,)
    ).fetchall()
    blocks_list = [dict(r) for r in blocks_rows]

    # Convertir le champ `keywords` (stocké en JSON string) en liste Python
    for b in blocks_list:
        try:
            b["keywords"] = json.loads(b["keywords"])
        except:
            b["keywords"] = []

    # Appeler la fonction de matching (LLM si disponible, sinon fallback mots‑clés)
    match_result = match_rush_to_plan(description, blocks_list, use_llm=True)
    if match_result:
        matched_block_id, score = match_result
        # Mettre à jour le rush avec l'identifiant du plan trouvé
        db.execute(
            "UPDATE rushes SET matched_plan = ?, score = ? WHERE id = ?",
            (str(matched_block_id), rush_id)
        )
        db.commit()
        # Note : on pourrait aussi stocker le score dans une colonne dédiée
    # ── Fin matching ───────────────────────────────────────────────────────

    # Retourner la réponse (dans tous les cas, même si aucun plan n'a été matché)
    return {
        "rush_id": rush_id,
        "filename": filename,
        "project_uid": project_uid,
        "description": description,
    }


# ── GET /api/projects/{project_uid}/rushes ────────────────────────────────────
# Réservé au réalisateur — JWT obligatoire.
# Retourne tous les rushs d'un projet avec leur statut de concordance Qwen.

@router.get("/{project_uid}/rushes")
def list_rushes(
    project_uid: str,
    user=Depends(get_current_user),     # JWT requis
    db=Depends(get_db),
):
    """
    Liste tous les rushs d'un projet.
    Nécessite un token JWT valide (le réalisateur doit être connecté).
    Retourne pour chaque rush : id, filename, mimetype, description, metadata,
    matched_plan (si le matching a réussi), uploaded_at.
    """
    # Vérifier que le projet appartient bien à ce réalisateur
    row = db.execute(
        "SELECT project_uid FROM projects WHERE project_uid = ? AND user_id = ?",
        (project_uid, user["id"])
    ).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Projet introuvable")

    # Récupérer tous les rushs liés au projet
    rows = db.execute(
        """SELECT id, filename, mimetype, description, metadata,
                  matched_plan, uploaded_at
           FROM rushes WHERE project_uid = ?""",
        (project_uid,)
    ).fetchall()

    # Convertir les lignes en liste de dictionnaires
    return [dict(r) for r in rows]
