"""Load the single root configuration used by scripts, workflows, and the site."""

import json
import os
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DEFAULT_PATH = ROOT / "config.json"


def _team(item, index):
    if isinstance(item, dict):
        team_id = item.get("id", item.get("team", index + 1))
        label = item.get("group", item.get("label", team_id))
    else:
        team_id = item
        label = item
    if team_id is None or str(team_id).strip() == "":
        raise ValueError(f"teams[{index}]: id is required")
    return {"id": str(team_id), "label": str(label)}


def load_config(path=None):
    source = Path(path or os.environ.get("OAIP_CONFIG") or DEFAULT_PATH)
    try:
        with source.open(encoding="utf-8") as f:
            raw = json.load(f)
    except FileNotFoundError as exc:
        raise SystemExit(f"config not found: {source}") from exc
    except json.JSONDecodeError as exc:
        raise SystemExit(f"invalid config {source}: {exc}") from exc

    teams = [_team(item, index) for index, item in enumerate(raw.get("teams") or [])]
    if len(teams) < 2:
        raise SystemExit("config: at least two teams are required")

    ids = [team["id"] for team in teams]
    if len(set(ids)) != len(ids):
        raise SystemExit("config: team ids must be unique")

    raw_scoring = raw.get("scoring") or {}
    scoring = {}
    for key, default in (("defense", 50), ("attack", 30), ("speed", 20)):
        try:
            scoring[key] = int(raw_scoring.get(key, default))
        except (TypeError, ValueError) as exc:
            raise SystemExit(f"config: scoring.{key} must be an integer") from exc
        if scoring[key] < 0:
            raise SystemExit(f"config: scoring.{key} must be non-negative")

    try:
        max_tests = int(raw.get("max_tests_per_team", 5))
    except (TypeError, ValueError) as exc:
        raise SystemExit("config: max_tests_per_team must be an integer") from exc
    if max_tests < 1:
        raise SystemExit("config: max_tests_per_team must be positive")

    repository = str(raw.get("repository") or "").strip()

    return {
        "title": str(raw.get("title") or "OAIP Battles"),
        "repository": repository,
        "teams": teams,
        "team_ids": tuple(ids),
        "team_labels": {team["id"]: team["label"] for team in teams},
        "max_tests_per_team": max_tests,
        "scoring": scoring,
    }
