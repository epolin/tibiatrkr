#!/usr/bin/env python3
# -*- coding: utf-8 -*-
import os, sys, time
from datetime import datetime
from pathlib import Path
from urllib.parse import quote

import requests
from zoneinfo import ZoneInfo

# Rutas
REPO_ROOT = Path(__file__).resolve().parents[1]
PLAYERS_FILE = REPO_ROOT / "players.txt"

# Supabase (via REST)
SUPABASE_URL = os.environ.get("SUPABASE_URL")
SUPABASE_SERVICE_ROLE = os.environ.get("SUPABASE_SERVICE_ROLE")
if not SUPABASE_URL or not SUPABASE_SERVICE_ROLE:
    print("Faltan SUPABASE_URL / SUPABASE_SERVICE_ROLE (Secrets de GitHub).", file=sys.stderr)
    sys.exit(1)

REST_SNAPSHOTS = f"{SUPABASE_URL}/rest/v1/snapshots"
REST_DEATHS    = f"{SUPABASE_URL}/rest/v1/deaths"
SB_HEADERS = {
    "apikey": SUPABASE_SERVICE_ROLE,
    "Authorization": f"Bearer {SUPABASE_SERVICE_ROLE}",
    "Content-Type": "application/json",
    "Prefer": "resolution=merge-duplicates"  # upsert si hay PK/unique
}

# TibiaData API
API = "https://api.tibiadata.com/v4/character/{}"
UA  = {"User-Agent": "TibiaLevelLogger/3.1 (GitHub Actions; https://github.com/epolin/tibiatrkr)"}

def fetch_char(name: str) -> dict:
    r = requests.get(API.format(quote(name, safe="")), headers=UA, timeout=30)
    r.raise_for_status()
    return r.json()

def killers_assists_to_list(xs):
    if not xs: return []
    out=[]
    for k in xs:
        out.append(k.get("name") or k.get("monster") or "Unknown")
    return out

def main():
    tz = ZoneInfo("America/Mexico_City")
    today = datetime.now(tz).date().isoformat()

    if not PLAYERS_FILE.exists():
        print("Falta players.txt", file=sys.stderr); sys.exit(1)

    with open(PLAYERS_FILE, "r", encoding="utf-8") as f:
        players = [p.strip() for p in f if p.strip() and not p.strip().startswith("#")]()
