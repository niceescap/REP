# database.py
import sqlite3
from pathlib import Path
from app.config import settings


def get_db():
    conn = sqlite3.connect(settings.DB_PATH, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    try:
        yield conn
    finally:
        conn.close()


def init_db():
    Path(settings.DB_PATH).parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(settings.DB_PATH)
    cur = conn.cursor()

    cur.executescript("""
        CREATE TABLE IF NOT EXISTS users (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            username    TEXT UNIQUE NOT NULL,
            hashed_pw   TEXT NOT NULL,
            created_at  TEXT DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS projects (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            project_uid TEXT UNIQUE NOT NULL,
            user_id     INTEGER NOT NULL,
            label       TEXT NOT NULL,
            prescript   TEXT,
            created_at  TEXT DEFAULT (datetime('now')),
            FOREIGN KEY (user_id) REFERENCES users(id)
        );

        CREATE TABLE IF NOT EXISTS rushes (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            project_uid TEXT NOT NULL,
            filename    TEXT NOT NULL,
            mimetype    TEXT,
            description TEXT NOT NULL,
            metadata    TEXT,
            matched_plan TEXT,
            score REAL,
            uploaded_at TEXT DEFAULT (datetime('now')),
            FOREIGN KEY (project_uid) REFERENCES projects(project_uid)
        );

        CREATE TABLE IF NOT EXISTS blocks (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            project_uid TEXT NOT NULL,
            type        TEXT NOT NULL,
            name        TEXT NOT NULL DEFAULT '',
            description TEXT DEFAULT '',
            duration    INTEGER NOT NULL DEFAULT 5,
            keywords    TEXT DEFAULT '[]',
            FOREIGN KEY (project_uid) REFERENCES projects(project_uid)
        );
    """)

    conn.commit()
    conn.close()
