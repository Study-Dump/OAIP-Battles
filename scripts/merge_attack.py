#!/usr/bin/env python3
"""Append one attack run to history and refresh the scoreboard."""

import argparse
import json
import os
from datetime import datetime, timezone

from scoring import build_scoreboard


def load_json(path, fallback):
    try:
        with open(path, encoding="utf-8") as f:
            data = json.load(f)
        if isinstance(data, dict):
            return data
    except (FileNotFoundError, json.JSONDecodeError):
        pass
    return fallback


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--result", required=True)
    parser.add_argument("--history", default="site/history.json")
    parser.add_argument("--scoreboard", default="site/scoreboard.json")
    args = parser.parse_args()

    with open(args.result, encoding="utf-8") as f:
        entry = json.load(f)

    target = str(entry.get("target", ""))
    commit = entry.get("commit", "")
    if target not in {"1", "2", "3", "4", "5"} or not commit:
        raise SystemExit("invalid attack result")

    now = datetime.now(timezone.utc)
    entry.setdefault("branch", f"attack-{target}")
    entry["id"] = f"attack-{target}-{commit[:7]}"
    entry["timestamp"] = now.isoformat()

    history = load_json(args.history, {"attacks": []})
    if not isinstance(history.get("attacks"), list):
        history = {"attacks": []}

    replaced = False
    for index, old in enumerate(history["attacks"]):
        if old.get("id") == entry["id"]:
            history["attacks"][index] = entry
            replaced = True
            break
    if not replaced:
        history["attacks"].append(entry)

    scoreboard = build_scoreboard(history)

    os.makedirs(os.path.dirname(args.history) or ".", exist_ok=True)
    with open(args.history, "w", encoding="utf-8") as f:
        json.dump(history, f, indent=2, ensure_ascii=False)
    with open(args.scoreboard, "w", encoding="utf-8") as f:
        json.dump(scoreboard, f, indent=2, ensure_ascii=False)

    defense = entry.get("defense", {})
    print(
        f"attack-{target}: {defense.get('passed', 0)}/{defense.get('total', 0)} "
        f"({'held' if defense.get('held') else 'broken'}), "
        f"solution_rev={entry.get('solution_rev', 0)}"
    )
    print(f"scoreboard: complete={scoreboard['complete']} winner={scoreboard['winner']}")


if __name__ == "__main__":
    main()
