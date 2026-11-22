#!/usr/bin/env python3
"""Run one target solution against attacks submitted by the other teams."""

import argparse
import json
import os
import re
import subprocess
import sys

from config import load_config
from runner import run_test

TEST_NAME = re.compile(r"^(\d+)_.+$")


def git(*args):
    return subprocess.check_output(["git", *args], text=True).strip()


def read_revisions(path, target, teams):
    data = {}
    if path:
        with open(path, encoding="utf-8") as f:
            data = json.load(f)
    solution_rev = int(data.get("solution_rev", data.get("solution", 0)) or 0)
    raw_attacks = data.get("attacks_rev", data.get("attacks", {})) or {}
    attacks_rev = {
        str(team): int(raw_attacks.get(str(team), raw_attacks.get(team, 0)) or 0)
        for team in teams
        if str(team) != str(target)
    }
    return solution_rev, attacks_rev


def collect_tests(team_dir, team, max_tests):
    if not os.path.isdir(team_dir):
        return []

    tests = []
    for name in os.listdir(team_dir):
        path = os.path.join(team_dir, name)
        if not os.path.isdir(path):
            continue
        match = TEST_NAME.match(name)
        if not match:
            raise SystemExit(
                f"team{team}: папка теста должна называться 0X_описание, получено: {name}"
            )
        tests.append((int(match.group(1)), name, path))

    tests.sort(key=lambda item: (item[0], item[1]))
    if len(tests) > max_tests:
        raise SystemExit(
            f"team{team}: максимум {max_tests} тестов на защиту, получено {len(tests)}"
        )
    return [(name, path) for _, name, path in tests]


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--solution", required=True, help="скомпилированное решение")
    parser.add_argument("--attacks-dir", default="attacks")
    parser.add_argument("--target", required=True)
    parser.add_argument("--revisions", help="JSON с solution_rev/attacks_rev")
    parser.add_argument("--config", help="путь к config.json (по умолчанию в корне)")
    parser.add_argument("--out", required=True)
    args = parser.parse_args()

    cfg = load_config(args.config)
    teams = cfg["team_ids"]
    args.target = str(args.target)
    if args.target not in teams:
        parser.error(
            f"target {args.target} отсутствует в config.json; команды: {', '.join(teams)}"
        )

    solution_rev, attacks_rev = read_revisions(args.revisions, args.target, teams)
    attackers = []
    total_passed = 0
    total_tests = 0

    for team in teams:
        if str(team) == args.target:
            continue

        team_dir = os.path.join(args.attacks_dir, f"team{team}")
        tests = collect_tests(team_dir, team, cfg["max_tests_per_team"])
        if not tests:
            print(f"team{team}: нет тестов, пропуск", file=sys.stderr)
            continue

        results = []
        passed = 0

        for name, test_dir in tests:
            input_path = os.path.join(test_dir, "input.txt")
            expected_path = os.path.join(test_dir, "expected_output.txt")
            if not (os.path.isfile(input_path) and os.path.isfile(expected_path)):
                raise SystemExit(
                    f"team{team}/{name}: нужны input.txt и expected_output.txt"
                )

            result = run_test(args.solution, test_dir)
            if result.get("skipped"):
                raise SystemExit(f"team{team}/{name}: тест пропущен: {result.get('reason')}")
            result.update(
                {
                    "author": str(team),
                    "name": name,
                    "path": test_dir.replace(os.sep, "/"),
                }
            )
            if result.get("passed"):
                passed += 1
            results.append(result)

        total = len(results)
        total_passed += passed
        total_tests += total
        attackers.append(
            {
                "team": str(team),
                "passed": passed,
                "total": total,
                "failed": total - passed,
                "revision": attacks_rev.get(str(team), 0),
                "tests": results,
            }
        )

    output = {
        "mode": "attack",
        "branch": os.environ.get("GITHUB_REF_NAME") or git("branch", "--show-current"),
        "commit": os.environ.get("GITHUB_SHA") or git("rev-parse", "HEAD"),
        "target": str(args.target),
        "solution_rev": solution_rev,
        "attacks_rev": attacks_rev,
        "attackers": attackers,
        "defense": {
            "passed": total_passed,
            "total": total_tests,
            "ratio": round(total_passed / total_tests, 4) if total_tests else 0.0,
            "held": total_tests > 0 and total_passed == total_tests,
        },
    }

    with open(args.out, "w", encoding="utf-8") as f:
        json.dump(output, f, indent=2, ensure_ascii=False)

    for attacker in attackers:
        print(
            f"team{attacker['team']} attacks team{args.target}: "
            f"{attacker['passed']}/{attacker['total']} passed "
            f"(revision {attacker['revision']})"
        )
    if total_tests:
        print(
            f"team{args.target} defense: {total_passed}/{total_tests} "
            f"({'held' if output['defense']['held'] else 'broken'})"
        )
    else:
        print(f"team{args.target} defense: нет тестов")


if __name__ == "__main__":
    main()
