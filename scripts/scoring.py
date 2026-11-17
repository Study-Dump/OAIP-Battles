"""Build the attack scoreboard from the latest run of every target branch."""

from statistics import mean

TEAMS = (1, 2, 3, 4, 5)
OTHER_TEAMS = {
    str(team): tuple(str(other) for other in TEAMS if other != team)
    for team in TEAMS
}
DEFENSE_WEIGHT = 50
ATTACK_WEIGHT = 30
SPEED_WEIGHT = 20


def latest_by_target(history):
    latest = {}
    for entry in history.get("attacks", []):
        target = str(entry.get("target", ""))
        if target not in OTHER_TEAMS:
            continue
        current = latest.get(target)
        if current is None or entry.get("timestamp", "") >= current.get("timestamp", ""):
            latest[target] = entry
    return latest


def attacker_record(entry, team):
    if not entry:
        return None
    return next(
        (
            attacker
            for attacker in entry.get("attackers") or []
            if str(attacker.get("team")) == str(team)
        ),
        None,
    )


def average_time(entry):
    tests = [
        test
        for attacker in (entry or {}).get("attackers") or []
        for test in attacker.get("tests") or []
        if isinstance(test.get("time_sec"), (int, float))
    ]
    return mean(test["time_sec"] for test in tests) if tests else None


def score_key(team):
    return (
        team["score"],
        team["defense_quality"],
        team["attack_quality"],
        team["speed_quality"],
        -team["solution_rev"],
        -team["attack_revs"],
        -int(team["team"]),
    )


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
            "defense_quality": 0.0,
            "defense_coverage": 0.0,
            "solution_rev": 0,
            "attack_points": 0,
            "attack_total": 0,
            "attack_ratio": 0.0,
            "attack_quality": 0.0,
            "attack_coverage": 0.0,
            "attack_revs": 0,
            "avg_time": None,
            "speed_quality": 0.0,
            "score": 0.0,
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
        stats["avg_time"] = average_time(entry)

        ratios = []
        for opponent in OTHER_TEAMS[target]:
            record = next(
                (attacker for attacker in summary["attackers"] if attacker["team"] == opponent),
                None,
            )
            if record and record["total"]:
                ratios.append(record["passed"] / record["total"])
            else:
                ratios.append(0.0)
        stats["defense_quality"] = mean(ratios)
        stats["defense_coverage"] = sum(
            1 for opponent in OTHER_TEAMS[target]
            if any(
                attacker["team"] == opponent and attacker["total"]
                for attacker in summary["attackers"]
            )
        ) / len(OTHER_TEAMS[target])

        for attacker in summary["attackers"]:
            team = attacker["team"]
            if team not in team_stats:
                continue
            team_stats[team]["attack_points"] += attacker["failed"]
            team_stats[team]["attack_total"] += attacker["total"]
            team_stats[team]["attack_revs"] += attacker["revision"]

    avg_times = [
        stats["avg_time"]
        for stats in team_stats.values()
        if stats["avg_time"] is not None and stats["avg_time"] > 0
    ]
    fastest = min(avg_times) if avg_times else None

    for team in TEAMS:
        stats = team_stats[str(team)]
        attack_ratios = []
        for target in OTHER_TEAMS[str(team)]:
            record = attacker_record(latest.get(target), team)
            if record and record.get("total"):
                attack_ratios.append(
                    int(record.get("failed", 0)) / int(record["total"])
                )
            else:
                attack_ratios.append(0.0)
        stats["attack_quality"] = mean(attack_ratios)
        stats["attack_coverage"] = sum(
            1 for target in OTHER_TEAMS[str(team)]
            if (attacker_record(latest.get(target), team) or {}).get("total")
        ) / len(OTHER_TEAMS[str(team)])

        avg = stats["avg_time"]
        stats["speed_quality"] = min(1.0, fastest / avg) if avg and fastest else 0.0
        stats["score"] = round(
            DEFENSE_WEIGHT * stats["defense_quality"]
            + ATTACK_WEIGHT * stats["attack_quality"]
            + SPEED_WEIGHT * stats["speed_quality"],
            2,
        )

    teams = []
    for team in TEAMS:
        stats = team_stats[str(team)]
        defense_points = stats["defense"]["passed"]
        teams.append(
            {
                **stats,
                "defense_points": defense_points,
                "total_points": defense_points + stats["attack_points"],
                "attack_ratio": round(
                    stats["attack_points"] / stats["attack_total"], 4
                ) if stats["attack_total"] else 0.0,
                "defense_quality": round(stats["defense_quality"], 4),
                "defense_coverage": round(stats["defense_coverage"], 4),
                "attack_quality": round(stats["attack_quality"], 4),
                "attack_coverage": round(stats["attack_coverage"], 4),
                "avg_time": round(stats["avg_time"], 4) if stats["avg_time"] is not None else None,
                "speed_quality": round(stats["speed_quality"], 4),
            }
        )

    complete = len(latest) == len(TEAMS)
    winner = None
    if complete:
        ranked = sorted(teams, key=score_key, reverse=True)
        if len(ranked) > 1 and score_key(ranked[0]) != score_key(ranked[1]):
            winner = ranked[0]["team"]

    timestamps = [entry.get("timestamp") for entry in latest.values() if entry.get("timestamp")]
    return {
        "mode": "attack",
        "complete": complete,
        "updated": max(timestamps) if timestamps else None,
        "targets": targets,
        "teams": teams,
        "winner": winner,
        "scoring": {
            "defense_weight": DEFENSE_WEIGHT,
            "attack_weight": ATTACK_WEIGHT,
            "speed_weight": SPEED_WEIGHT,
        },
    }
