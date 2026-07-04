# app/routers/blocks.py
from fastapi import APIRouter, Depends, HTTPException
from app.database import get_db
from app.auth import get_current_user
from pydantic import BaseModel
from typing import List, Optional
import json

router = APIRouter(prefix="/projects/{project_uid}", tags=["blocks"])

class BlockCreate(BaseModel):
    type: str
    name: str = ""
    description: str = ""
    duration: int = 5
    keywords: List[str] = []

class BlockUpdate(BaseModel):
    type: Optional[str] = None
    name: Optional[str] = None
    description: Optional[str] = None
    duration: Optional[int] = None
    keywords: Optional[List[str]] = None

class BlockOut(BaseModel):
    id: int
    project_uid: str
    type: str
    name: str
    description: str
    duration: int
    keywords: List[str]

# Helper pour vérifier que le projet appartient à l'utilisateur
def own_project(project_uid: str, user, db):
    project = db.execute(
        "SELECT project_uid FROM projects WHERE project_uid = ? AND user_id = ?",
        (project_uid, user["id"])
    ).fetchone()
    if not project:
        raise HTTPException(status_code=404, detail="Projet introuvable")
    return project

# ── POST ──
@router.post("/blocks", response_model=BlockOut)
def create_block(
    project_uid: str,
    body: BlockCreate,
    user=Depends(get_current_user),
    db=Depends(get_db)
):
    own_project(project_uid, user, db)
    # Insérer le bloc
    cursor = db.execute(
        """INSERT INTO blocks (project_uid, type, name, description, duration, keywords)
           VALUES (?, ?, ?, ?, ?, ?)""",
        (project_uid, body.type, body.name, body.description, body.duration, json.dumps(body.keywords))
    )
    db.commit()
    block_id = cursor.lastrowid
    # Retourner le bloc créé
    row = db.execute("SELECT * FROM blocks WHERE id = ?", (block_id,)).fetchone()
    row = dict(row)
    row["keywords"] = json.loads(row["keywords"])
    return row

# ── GET ALL ──
@router.get("/blocks", response_model=List[BlockOut])
def list_blocks(
    project_uid: str,
    user=Depends(get_current_user),
    db=Depends(get_db)
):
    own_project(project_uid, user, db)
    rows = db.execute(
        "SELECT * FROM blocks WHERE project_uid = ? ORDER BY id",
        (project_uid,)
    ).fetchall()
    result = []
    for r in rows:
        r = dict(r)
        r["keywords"] = json.loads(r["keywords"])
        result.append(r)
    return result

# ── PUT ──
@router.put("/blocks/{block_id}", response_model=BlockOut)
def update_block(
    project_uid: str,
    block_id: int,
    body: BlockUpdate,
    user=Depends(get_current_user),
    db=Depends(get_db)
):
    own_project(project_uid, user, db)
    # Vérifier que le bloc existe dans ce projet
    block = db.execute(
        "SELECT * FROM blocks WHERE id = ? AND project_uid = ?",
        (block_id, project_uid)
    ).fetchone()
    if not block:
        raise HTTPException(status_code=404, detail="Bloc introuvable")
    # Mise à jour partielle
    updates = {}
    if body.type is not None:
        updates["type"] = body.type
    if body.name is not None:
        updates["name"] = body.name
    if body.description is not None:
        updates["description"] = body.description
    if body.duration is not None:
        updates["duration"] = body.duration
    if body.keywords is not None:
        updates["keywords"] = json.dumps(body.keywords)
    if updates:
        set_clause = ", ".join(f"{k} = ?" for k in updates)
        values = list(updates.values()) + [block_id, project_uid]
        db.execute(
            f"UPDATE blocks SET {set_clause} WHERE id = ? AND project_uid = ?",
            values
        )
        db.commit()
    row = db.execute("SELECT * FROM blocks WHERE id = ?", (block_id,)).fetchone()
    row = dict(row)
    row["keywords"] = json.loads(row["keywords"])
    return row

# ── DELETE ──
@router.delete("/blocks/{block_id}")
def delete_block(
    project_uid: str,
    block_id: int,
    user=Depends(get_current_user),
    db=Depends(get_db)
):
    own_project(project_uid, user, db)
    result = db.execute(
        "DELETE FROM blocks WHERE id = ? AND project_uid = ?",
        (block_id, project_uid)
    )
    db.commit()
    if result.rowcount == 0:
        raise HTTPException(status_code=404, detail="Bloc introuvable")
    return {"status": "ok"}
