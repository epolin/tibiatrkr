#!/usr/bin/env python3
# -*- coding: utf-8 -*-

import csv
import os
import re
import sys
import time
from datetime import datetime
from pathlib import Path
from urllib.parse import quote_plus
from zoneinfo import ZoneInfo

import requests
from bs4 import BeautifulSoup

# Rutas del repo
REPO_ROOT = Path(__file__).resolve().parents[1]
DOCS_DIR = REPO_ROOT / "docs"
DATA_DIR = DOCS_DIR / "data"
PLAYERS_FILE = REPO_ROOT / "players.txt"
CSV_FILE = DATA_DIR / "levels.csv"

BASE_URL = "https://www.tibia.com/community/?name="
HEADERS = {
    "User-Agent": "Mozilla/5.0 (compatible; TibiaLevelLogger/1.1; +https://github.com/tu-usuario/tibia-level-tracker)"
}

def _get_td_value(soup: BeautifulSoup, label: str) -> str | None:
    td = soup.find("td", string=lambda s: s and s.strip().lower() == f"{label.lower()}:")
    if td:
        nxt = td.find_next("td")
        if nxt:
            return nxt.get_text(strip=True)
    return None

def parse_fields(html: str) -> dict:
    soup = BeautifulSoup(html, "html.parser")
    # Level
    level_txt = _get_td_value(soup, "Level")
    level = None
    if level_txt:
        m = re.search(r"\d+", level_txt)
        if m:
            level = int(m.group())

    # Vocation
    vocation = _get_td_value(soup, "Vocation")
    # Fallbacks por regex si algo cambia
    if level is None:
        m = re.search(r"Level:\s*</td>\s*<td[^>]*>\s*(\d+)\s*</td>", html, re.I | re.S)
        if m:
            level = int(m.group(1))
    if not vocation:
        m = re.search(r"Vocation:\s*</td>\s*<td[^>]*>\s*([^<]+)\s*</td>", html, re.I | re.S)
        if m:
            vocation = m.group(1).strip()

    return {"level": level, "vocation": vocation}

def fetch_player(player: str) -> dict | None:
    url = BASE_URL + quote_plus(player)
    r = requests.get(url, headers=HEADERS, timeout=30)
    r.raise_for_status()
    data = parse_fields(r.text)
    if data["level"] is None:
        return None
    return {"player": player, **data}

def read_existing_keys_for_today(csv_path: Path, today: str) -> set[tuple[str, str]]:
    keys = set()
    if not csv_path.exists():
        return keys
    with open(csv_path, "r", encoding="utf-8", newline="") as f:
        reader = csv.DictReader(f)
        for row in reader:
            if row.get("date") == today:
                keys.add((row.get("date"), row.get("player")))
    return keys

def main():
    tz = ZoneInfo("America/Mexico_City")
    today = datetime.now(tz).date().isoformat()

    if not PLAYERS_FILE.exists():
        print(f"No existe {PLAYERS_FILE}. Crea el archivo con la lista de jugadores.", file=sys.stderr)
        sys.exit(1)

    DATA_DIR.mkdir(parents=True, exist_ok=True)

    with open(PLAYERS_FILE, "r", encoding="utf-8") as f:
        players = [p.strip() for p in f if p.strip() and not p.strip().startswith("#")]

    to_append = []
    for i, player in enumerate(players):
        try:
            info = fetch_player(player)
            if not info:
                print(f"[WARN] No encontré Level para '{player}'.", file=sys.stderr)
                continue
            print(f"[OK] {info['player']}: Level {info['level']} ({info['vocation']})")
            to_append.append([today, info["player"], info.get("vocation") or "", info["level"]])
        except Exception as e:
            print(f"[ERROR] {player}: {e}", file=sys.stderr)
        if i < len(players) - 1:
            time.sleep(2)

    # Evitar duplicados del mismo día
    existing = read_existing_keys_for_today(CSV_FILE, today)

    new_file = not CSV_FILE.exists()
    with open(CSV_FILE, "a", encoding="utf-8", newline="") as f:
        writer = csv.writer(f)
        if new_file:
            writer.writerow(["date", "player", "vocation", "level"])
        for row in to_append:
            key = (row[0], row[1])  # (date, player)
            if key in existing:
                continue
            writer.writerow(row)

    print(f"Guardado en {CSV_FILE}.")

if __name__ == "__main__":
    main()
