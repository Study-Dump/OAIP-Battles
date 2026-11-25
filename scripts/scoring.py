"""Build the attack scoreboard from every battle in history."""

from statistics import mean

try:
    from config import load_config
except ImportError:
    from scripts.config import load_config


def latest_by_target(history, other_teams):
    latest = {}
    for entry in history.get("attacks", []):
        target = str(entry.get("target", ""))
        if target not in other_teams:
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


def input_lines(test):
    value = test.get("input_lines")
    if isinstance(value, (int, float)):
        return max(0, int(value))
    return len(str(test.get("input") or "").splitlines())


def defense_samples(entry):
    return [
        (test["time_sec"], input_lines(test))
        for attacker in (entry or {}).get("attackers") or []
        for test in attacker.get("tests") or []
        if isinstance(test.get("time_sec"), (int, float))
    ]


def score_key(team):
    return (
        team["score"],
        team["defense_quality"],
        team["attack_quality"],
        team["speed_quality"],
        -team["solution_rev"],
        -team["attack_revs"],
        -int(team.get("order", 0)),
    )


def build_scoreboard(history, config=None):
    cfg = config or load_config()
    teams = cfg["team_ids"]
    weights = cfg["scoring"]
    other_teams = {
        str(team): tuple(str(other) for other in teams if str(other) != str(team))
        for team in teams
    }
    order = {str(team): index for index, team in enumerate(teams)}
    latest = latest_by_target(history, other_teams)
    targets = []
    team_stats = {
        str(team): {
            "team": str(team),
            "order": index,
            "defense": {
                "passed": 0,
                "total": 0,
                "ratio": 0.0,
                "held": False,
            },
            "defense_quality": 0.0,
            "defense_coverage": 0.0,
            "defense_passed": 0,
            "defense_total": 0,
            "defense_attempts": {},
            "solution_rev": 0,
            "attack_points": 0,
            "attack_total": 0,
            "attack_ratio": 0.0,
            "attack_quality": 0.0,
            "attack_coverage": 0.0,
            "attack_attempts": {},
            "attack_revs": 0,
            "avg_time": None,
            "time_per_line": None,
            "speed_quality": 0.0,
            "score": 0.0,
        }
        for index, team in enumerate(teams)
    }

    for entry in sorted(
        history.get("attacks", []),
        key=lambda entry: (entry.get("timestamp", ""), entry.get("id", "")),
    ):
        target = str(entry.get("target", ""))
        if target not in other_teams:
            continue
        defense = entry.get("defense") or {}
        solution_rev = int(entry.get("solution_rev", 0) or 0)
        stats = team_stats[target]
        passed = int(defense.get("passed", 0) or 0)
        total = int(defense.get("total", 0) or 0)
        stats["defense_passed"] += passed
        stats["defense_total"] += total
        attempts = stats["defense_attempts"].setdefault(
            solution_rev, {"revision": solution_rev, "passed": 0, "total": 0}
        )
        attempts["passed"] += passed
        attempts["total"] += total

        for attacker in entry.get("attackers") or []:
            team = str(attacker.get("team"))
            if team not in team_stats:
                continue
            failed = int(attacker.get("failed", 0) or 0)
            tests = int(attacker.get("total", 0) or 0)
            revision = int(attacker.get("revision", 0) or 0)
            team_stats[team]["attack_points"] += failed
            team_stats[team]["attack_total"] += tests
            key = (target, revision)
            attempt = team_stats[team]["attack_attempts"].setdefault(
                key,
                {"target": target, "revision": revision, "failed": 0, "total": 0},
            )
            attempt["failed"] += failed
            attempt["total"] += tests

        team_stats[target].setdefault("_defense_samples", []).extend(defense_samples(entry))

    fastest = None
    for stats in team_stats.values():
        samples = stats.pop("_defense_samples", [])
        times = [time_sec for time_sec, _ in samples]
        total_time = sum(times)
        total_lines = sum(lines for _, lines in samples)
        stats["avg_time"] = mean(times) if times else None
        stats["time_per_line"] = (
            total_time / max(1, total_lines) if samples and total_time > 0 else None
        )
        if stats["time_per_line"] is not None and (
            fastest is None or stats["time_per_line"] < fastest
        ):
            fastest = stats["time_per_line"]

    for target in sorted(latest, key=lambda item: order.get(item, len(order))):
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
                for team in teams
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

    for team in teams:
        stats = team_stats[str(team)]
        stats["defense"] = {
            "passed": int((latest.get(str(team)) or {}).get("defense", {}).get("passed", 0) or 0),
            "total": int((latest.get(str(team)) or {}).get("defense", {}).get("total", 0) or 0),
            "ratio": float((latest.get(str(team)) or {}).get("defense", {}).get("ratio", 0.0) or 0.0),
            "held": bool((latest.get(str(team)) or {}).get("defense", {}).get("held")),
        }
        stats["solution_rev"] = int((latest.get(str(team)) or {}).get("solution_rev", 0) or 0)
        stats["attack_revs"] = sum(
            int(attacker.get("revision", 0) or 0)
            for entry in latest.values()
            for attacker in entry.get("attackers") or []
            if str(attacker.get("team")) == str(team)
        )
        stats["defense_attempts"] = [
            stats["defense_attempts"][revision]
            for revision in sorted(stats["defense_attempts"])
        ]
        stats["attack_attempts"] = [
            stats["attack_attempts"][key]
            for key in sorted(stats["attack_attempts"])
        ]
        stats["defense_quality"] = (
            stats["defense_passed"] / stats["defense_total"]
            if stats["defense_total"]
            else 0.0
        )
        stats["attack_quality"] = (
            stats["attack_points"] / stats["attack_total"]
            if stats["attack_total"]
            else 0.0
        )
        stats["defense_coverage"] = sum(
            1
            for opponent in other_teams[str(team)]
            if any(
                attacker.get("team") == opponent and attacker.get("total")
                for entry in history.get("attacks", [])
                if str(entry.get("target", "")) == str(team)
                for attacker in entry.get("attackers") or []
            )
        ) / len(other_teams[str(team)])
        stats["attack_coverage"] = sum(
            1
            for target in other_teams[str(team)]
            if any(
                attacker_record(entry, team)
                and (attacker_record(entry, team) or {}).get("total")
                for entry in history.get("attacks", [])
                if str(entry.get("target", "")) == target
            )
        ) / len(other_teams[str(team)])
        stats["attack_ratio"] = (
            stats["attack_points"] / stats["attack_total"]
            if stats["attack_total"]
            else 0.0
        )
        per_line = stats["time_per_line"]
        stats["speed_quality"] = (
            min(1.0, fastest / per_line) if per_line and fastest else 0.0
        )
        stats["score"] = round(
            weights["defense"] * stats["defense_quality"]
            + weights["attack"] * stats["attack_quality"]
            + weights["speed"] * stats["speed_quality"],
            2,
        )

    ranked_teams = []
    for team in teams:
        stats = team_stats[str(team)]
        ranked_teams.append(
            {
                **stats,
                "defense_points": stats["defense_passed"],
                "total_points": stats["defense_passed"] + stats["attack_points"],
                "defense_quality": round(stats["defense_quality"], 4),
                "defense_coverage": round(stats["defense_coverage"], 4),
                "attack_quality": round(stats["attack_quality"], 4),
                "attack_coverage": round(stats["attack_coverage"], 4),
                "attack_ratio": round(stats["attack_ratio"], 4),
                "avg_time": round(stats["avg_time"], 4) if stats["avg_time"] is not None else None,
                "time_per_line": (
                    round(stats["time_per_line"], 8)
                    if stats["time_per_line"] is not None
                    else None
                ),
                "speed_quality": round(stats["speed_quality"], 4),
                "defense_attempts": [
                    {
                        **attempt,
                        "ratio": round(attempt["passed"] / attempt["total"], 4)
                        if attempt["total"]
                        else 0.0,
                    }
                    for attempt in stats["defense_attempts"]
                ],
                "attack_attempts": [
                    {
                        **attempt,
                        "ratio": round(attempt["failed"] / attempt["total"], 4)
                        if attempt["total"]
                        else 0.0,
                    }
                    for attempt in stats["attack_attempts"]
                ],
            }
        )

    complete = len(latest) == len(teams)
    winner = None
    if complete:
        ranked = sorted(ranked_teams, key=score_key, reverse=True)
        if len(ranked) > 1 and score_key(ranked[0]) != score_key(ranked[1]):
            winner = ranked[0]["team"]

    timestamps = [entry.get("timestamp") for entry in latest.values() if entry.get("timestamp")]
    return {
        "mode": "attack",
        "complete": complete,
        "updated": max(timestamps) if timestamps else None,
        "targets": targets,
        "teams": ranked_teams,
        "winner": winner,
        "scoring": {
            "defense_weight": weights["defense"],
            "attack_weight": weights["attack"],
            "speed_weight": weights["speed"],
        },
    }
