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
    r = requests.get(url, headers=SB_HEADERS, timeout=30)
    r.raise_for_status()
    rows = r.json()
    return [row["player"] for row in rows]

def fetch_char(name: str) -> dict:
    r = requests.get(API.format(quote(name, safe="")), headers=UA, timeout=30)
    r.raise_for_status()
    return r.json()

def killers_assists_to_list(xs):
    if not xs: return []
    return [ (k.get("name") or k.get("monster") or "Unknown") for k in xs ]

def main():
    tz = ZoneInfo("America/Mexico_City")
    today = datetime.now(tz).date().isoformat()

    # 1) Obtiene la lista de players desde Supabase
    try:
        players = fetch_players()
    except Exception as e:
        print(f"[ERROR] leyendo players: {e}", file=sys.stderr)
        sys.exit(1)

    if not players:
        print("[WARN] No hay players activos en la tabla public.players")
        return

    snap_payload = []
    deaths_payload = []

    for i, name in enumerate(players):
        try:
            js = fetch_char(name)

            # Estructura de TibiaData v4
            root = js.get("character", {})      # (sin 's')
            ch = (root.get("character") or {})  # datos del personaje
            deaths = root.get("deaths") or []   # lista de muertes

            level = ch.get("level")
            if level is not None:
                snap_payload.append({
                    "date": today,
                    "player": ch.get("name") or name,
                    "world": ch.get("world"),
                    "residence": ch.get("residence"),
                    "sex": ch.get("sex"),
                    "guild": (ch.get("guild") or {}).get("name"),
                    "achievement_points": ch.get("achievement_points"),
                    "account_status": ch.get("account_status"),
                    "vocation": ch.get("vocation"),
                    "level": level,
                    "last_login": ch.get("last_login")
                })
            else:
                print(f"[WARN] {name}: sin level en respuesta; omito snapshot")

            for d in deaths:
                t = d.get("time") or d.get("date") or d.get("timestamp")
                if not t:
                    continue
                deaths_payload.append({
                    "death_time_utc": t,
                    "player": ch.get("name") or name,
                    "level_at_death": d.get("level"),
                    "reason": d.get("reason"),
                    "killers": killers_assists_to_list(d.get("killers", [])),
                    "assists": killers_assists_to_list(d.get("assists", []))
                })

            print(f"[OK] {name}: lvl {level} ({ch.get('vocation')}) | deaths: {len(deaths)}")

        except Exception as e:
            print(f"[ERROR] {name}: {e}", file=sys.stderr)

        if i < len(players) - 1:
            time.sleep(0.8)  # cortesía

    # 2) Upsert a Supabase
    if snap_payload:
        rs = requests.post(
            REST_SNAPSHOTS, headers=SB_HEADERS, json=snap_payload,
            params={"on_conflict": "date,player"}
        )
        if not rs.ok:
            print(f"[ERROR] upsert snapshots: {rs.status_code} {rs.text}", file=sys.stderr)

    if deaths_payload:
        rd = requests.post(
            REST_DEATHS, headers=SB_HEADERS, json=deaths_payload,
            params={"on_conflict": "player,death_time_utc"}
        )
        if not rd.ok:
            print(f"[ERROR] upsert deaths: {rd.status_code} {rd.text}", file=sys.stderr)

    print(f"Subidos: snapshots={len(snap_payload)} deaths={len(deaths_payload)}")

if __name__ == "__main__":
    main()
