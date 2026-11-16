"""Build the attack scoreboard from the latest run of every target branch."""

TEAMS = (1, 2, 3, 4, 5)


def latest_by_target(history):
    latest = {}
    for entry in history.get("attacks", []):
        target = str(entry.get("target", ""))
        if target not in {str(team) for team in TEAMS}:
            continue
        current = latest.get(target)
        if current is None or entry.get("timestamp", "") >= current.get("timestamp", ""):
            latest[target] = entry
    return latest


def build_scoreboard(history):
    latest = latest_by_target(history)
    targets = []
    team_stats = {
        str(team): {
            "team": str(team),
            "defense": {
                "passed": 0,
                "total": 0,
                "ratio": 0.0,
                "held": False,
            },
            "solution_rev": 0,
            "attack_points": 0,
            "attack_total": 0,
            "attack_ratio": 0.0,
            "attack_revs": 0,
        }
        for team in TEAMS
    }

    for target in sorted(latest, key=int):
        entry = latest[target]
        defense = entry.get("defense") or {}
        attackers = entry.get("attackers") or []
        summary = {
            "target": target,
            "branch": entry.get("branch", f"attack-{target}"),
            "id": entry.get("id"),
            "commit": entry.get("commit"),
            "timestamp": entry.get("timestamp"),
            "solution_rev": int(entry.get("solution_rev", 0) or 0),
            "attacks_rev": {
                str(team): int((entry.get("attacks_rev") or {}).get(str(team), 0) or 0)
                for team in TEAMS
                if str(team) != target
            },
            "defense": {
                "passed": int(defense.get("passed", 0) or 0),
                "total": int(defense.get("total", 0) or 0),
                "ratio": float(defense.get("ratio", 0.0) or 0.0),
                "held": bool(defense.get("held")),
            },
            "attackers": [
                {
                    "team": str(attacker.get("team")),
                    "passed": int(attacker.get("passed", 0) or 0),
                    "total": int(attacker.get("total", 0) or 0),
                    "failed": int(attacker.get("failed", 0) or 0),
                    "revision": int(attacker.get("revision", 0) or 0),
                }
                for attacker in attackers
            ],
        }
        targets.append(summary)

        stats = team_stats[target]
        stats["defense"] = summary["defense"]
        stats["solution_rev"] = summary["solution_rev"]

        for attacker in summary["attackers"]:
            team = attacker["team"]
            if team not in team_stats:
                continue
            team_stats[team]["attack_points"] += attacker["failed"]
            team_stats[team]["attack_total"] += attacker["total"]
            team_stats[team]["attack_revs"] += attacker["revision"]

    teams = []
    for team in TEAMS:
        stats = team_stats[str(team)]
        defense = stats["defense"]
        defense_points = defense["passed"]
        total_points = defense_points + stats["attack_points"]
        attack_total = stats["attack_total"]
        teams.append(
            {
                **stats,
                "defense_points": defense_points,
                "total_points": total_points,
                "attack_ratio": round(
                    stats["attack_points"] / attack_total, 4
                ) if attack_total else 0.0,
            }
        )

    complete = len(latest) == len(TEAMS)
    winner = None
    if complete:
        ranked = sorted(
            teams,
            key=lambda item: (
                item["total_points"],
                item["defense"]["held"],
                -item["solution_rev"],
                item["attack_revs"],
            ),
            reverse=True,
        )
        if len(ranked) > 1:
            first = ranked[0]
            second = ranked[1]
            first_key = (
                first["total_points"],
                first["defense"]["held"],
                -first["solution_rev"],
                first["attack_revs"],
            )
            second_key = (
                second["total_points"],
                second["defense"]["held"],
                -second["solution_rev"],
                second["attack_revs"],
            )
            if first_key != second_key:
                winner = first["team"]

    timestamps = [entry.get("timestamp") for entry in latest.values() if entry.get("timestamp")]
    return {
        "mode": "attack",
        "complete": complete,
        "updated": max(timestamps) if timestamps else None,
        "targets": targets,
        "teams": teams,
        "winner": winner,
    }
