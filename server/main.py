import os
from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from app.database import init_db

# Import des routeurs — chaque fichier gère une fonctionnalité métier
from app.routers import auth, projects, uploads, blocks

# Chemins absolus pour les fichiers statiques
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
STATIC_DIR = os.path.join(SCRIPT_DIR, "..", "director")

app = FastAPI(
    title="Rush Event Pilot",
    version="0.1.0",
)

# 1. Middleware CORS — autorise les requêtes depuis n'importe quelle origine
# (utile en dev ; à restreindre en production)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# 2. Initialisation de la base de données au démarrage
@app.on_event("startup")
def startup():
    init_db()

# 3. Routeurs API — préfixe /api commun à toutes les routes métier
app.include_router(auth.router, prefix="/api")
app.include_router(projects.router, prefix="/api")
app.include_router(uploads.router, prefix="/api")  # ← nouveau
app.include_router(blocks.router, prefix="/api")

# 4. Endpoint de santé — vérifie que le serveur répond
@app.get("/health")
def health():
    return {"status": "ok"}

# 5. Montage du frontend en dernier — OBLIGATOIRE en dernière position
# sinon FastAPI intercepte toutes les routes avant les routeurs API
app.mount("/", StaticFiles(directory=STATIC_DIR, html=True), name="director")
