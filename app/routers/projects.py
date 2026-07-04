# app/routers/projects.py
import re
from fastapi import APIRouter, Depends, HTTPException
from app.database import get_db
from app.auth import get_current_user
from pydantic import BaseModel
from typing import Optional

router = APIRouter(prefix="/projects", tags=["projects"])

def slugify(text: str) -> str:
    text = text.lower().strip()
    text = re.sub(r'[^\w\s-]', '', text)
    text = re.sub(r'[\s_-]+', '-', text)
    return text

class ProjectCreate(BaseModel):
    label: str

class PrescriptUpdate(BaseModel):
    prescript: str

@router.post("")
def create_project(body: ProjectCreate, user=Depends(get_current_user), db=Depends(get_db)):
    slug = slugify(body.label)
    project_uid = f"REP_{user['id']}_{slug}"
    try:
        db.execute(
            "INSERT INTO projects (project_uid, user_id, label) VALUES (?, ?, ?)",
            (project_uid, user["id"], body.label)
        )
        db.commit()
    except Exception:
        raise HTTPException(status_code=409, detail="Projet déjà existant")
    return {"project_uid": project_uid, "label": body.label}

@router.get("")
def list_projects(user=Depends(get_current_user), db=Depends(get_db)):
    rows = db.execute(
        "SELECT project_uid, label, created_at FROM projects WHERE user_id = ?",
        (user["id"],)
    ).fetchall()
    return [dict(r) for r in rows]

@router.get("/{project_uid}")
def get_project(project_uid: str, user=Depends(get_current_user), db=Depends(get_db)):
    row = db.execute(
        "SELECT * FROM projects WHERE project_uid = ? AND user_id = ?",
        (project_uid, user["id"])
    ).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Projet introuvable")
    return dict(row)

@router.put("/{project_uid}/prescript")
def update_prescript(project_uid: str, body: PrescriptUpdate, user=Depends(get_current_user), db=Depends(get_db)):
    result = db.execute(
        "UPDATE projects SET prescript = ? WHERE project_uid = ? AND user_id = ?",
        (body.prescript, project_uid, user["id"])
    )
    db.commit()
    if result.rowcount == 0:
        raise HTTPException(status_code=404, detail="Projet introuvable")
    return {"status": "ok"}
