# app/routers/auth.py
from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import OAuth2PasswordRequestForm
from pydantic import BaseModel
import sqlite3
from app.database import get_db
from app.auth import hash_password, verify_password, create_access_token

router = APIRouter(prefix="/auth", tags=["auth"])

class RegisterRequest(BaseModel):
    username: str
    password: str

@router.post("/register")
def register(req: RegisterRequest, db: sqlite3.Connection = Depends(get_db)):
    try:
        db.execute(
            "INSERT INTO users (username, hashed_pw) VALUES (?, ?)",
            (req.username, hash_password(req.password))
        )
        db.commit()
        return {"message": f"Utilisateur {req.username} créé"}
    except Exception:
        raise HTTPException(status_code=400, detail="Nom d'utilisateur déjà pris")

@router.post("/login")
def login(form: OAuth2PasswordRequestForm = Depends(), db: sqlite3.Connection = Depends(get_db)):
    user = db.execute(
        "SELECT * FROM users WHERE username = ?", (form.username,)
    ).fetchone()

    if not user or not verify_password(form.password, user["hashed_pw"]):
        raise HTTPException(status_code=401, detail="Identifiants invalides")

    token = create_access_token({"sub": str(user["id"]), "username": user["username"]})
    return {"access_token": token, "token_type": "bearer"}
