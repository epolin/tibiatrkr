#!/usr/bin/env python3
# -*- coding: utf-8 -*-
import os, sys, time
from datetime import datetime
from urllib.parse import quote

import requests
from zoneinfo import ZoneInfo

# === Config de entorno (vienen de GitHub Secrets) ===
SUPABASE_URL = os.environ.get("SUPABASE_URL")
SUPABASE_SERVICE_ROLE = os.environ.get("SUPABASE_SERVICE_ROLE")
if not SUPABASE_URL or not SUPABASE_SERVICE_ROLE:
    print("Faltan SUPABASE_URL / SUPABASE_SERVICE_ROLE (Secrets de GitHub).", file=sys.stderr)
    sys.exit(1)

# Endpoints REST de Supabase
REST_PLAYERS   = f"{SUPABASE_URL}/rest/v1/players"
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
UA  = {"User-Agent": "TibiaLevelLogger/3.2 (GitHub Actions; https://github.com/epolin/tibiatrkr)"}

def fetch_players():
    # Lee solo los activos
    url = f"{REST_PLAYERS}?select=player&is_active=eq.true&order=player.asc"
    r = requests.get(url, headers=SB_HEADERS_
