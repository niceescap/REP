# app/matching.py
import json
import re
import requests
from typing import Optional, Tuple, List, Dict

OLLAMA_URL = "http://localhost:11434"
MODEL_NAME = "qwen2.5:3b"

def match_rush_to_plan(
    rush_description: str,
    blocks: List[Dict],
    use_llm: bool = True
) -> Optional[Tuple[int, float]]:
    if not blocks:
        return None
    if use_llm:
        try:
            return _match_with_llm(rush_description, blocks)
        except Exception as e:
            print(f"[Matching] LLM failed, fallback to keywords: {e}")
            return _keyword_match(rush_description, blocks)
    else:
        return _keyword_match(rush_description, blocks)

def _match_with_llm(rush_description: str, blocks: List[Dict]) -> Optional[Tuple[int, float]]:
    blocks_info = []
    for b in blocks:
        blocks_info.append({
            "id": b["id"],
            "name": b.get("name", ""),
            "description": b.get("description", ""),
            "keywords": b.get("keywords", [])
        })

    prompt = f"""Tu es assistant de montage vidéo.

Un cadreur vient de tourner le rush décrit ci-dessous :
"{rush_description}"

Voici la liste des plans prévus dans le projet :
{json.dumps(blocks_info, ensure_ascii=False, indent=2)}

Parmi ces plans, lequel correspond le mieux au rush ?
Réponds uniquement par un objet JSON avec :
- "block_id" : l'identifiant du plan (nombre entier)
- "score" : un entier entre 0 et 100 (confiance)
Si aucun plan ne correspond, utilise block_id = null et score = 0.

Exemple de réponse : {{"block_id": 42, "score": 85}}"""

    resp = requests.post(
        f"{OLLAMA_URL}/api/generate",
        json={"model": MODEL_NAME, "prompt": prompt, "stream": False},
        timeout=240
    )
    data = resp.json()
    answer = data.get("response", "").strip()
    json_match = re.search(r'\{.*\}', answer, re.DOTALL)
    if not json_match:
        return None
    result = json.loads(json_match.group())
    block_id = result.get("block_id")
    score = result.get("score", 0)
    if block_id is None or score == 0:
        return None
    return int(block_id), float(score)

def _keyword_match(rush_description: str, blocks: List[Dict]) -> Optional[Tuple[int, float]]:
    rush_words = set(re.findall(r'\w+', rush_description.lower()))
    best_score = 0
    best_block_id = None
    for b in blocks:
        block_text = f"{b.get('name', '')} {b.get('description', '')} {' '.join(b.get('keywords', []))}".lower()
        block_words = set(re.findall(r'\w+', block_text))
        common = rush_words & block_words
        score = len(common) / max(len(rush_words), 1) * 100
        if score > best_score:
            best_score = score
            best_block_id = b["id"]
    if best_score >= 20:
        return best_block_id, best_score
    return None
