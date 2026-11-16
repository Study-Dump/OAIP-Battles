#!/usr/bin/env python3
"""Run one target solution against attacks submitted by all other teams."""

import argparse
import json
import os
import re
import subprocess
import sys

from runner import run_test

TEAMS = (1, 2, 3, 4, 5)
TEST_NAME = re.compile(r"^\d{2}_.+")
MAX_TESTS_PER_TEAM = 5


def git(*args):
    return subprocess.check_output(["git", *args], text=True).strip()


def read_revisions(path, target):
    data = {}
    if path:
        with open(path, encoding="utf-8") as f:
            data = json.load(f)
    solution_rev = int(data.get("solution_rev", data.get("solution", 0)) or 0)
    raw_attacks = data.get("attacks_rev", data.get("attacks", {})) or {}
    attacks_rev = {
        str(team): int(raw_attacks.get(str(team), raw_attacks.get(team, 0)) or 0)
        for team in TEAMS
        if team != target
    }
    return solution_rev, attacks_rev


def collect_tests(team_dir, team):
    if not os.path.isdir(team_dir):
        raise SystemExit(f"team{team}: папка атак не найдена: {team_dir}")

    tests = []
    for name in sorted(os.listdir(team_dir)):
        path = os.path.join(team_dir, name)
        if not os.path.isdir(path):
            continue
        if not TEST_NAME.match(name):
            raise SystemExit(
                f"team{team}: папка теста должна называться 0X_описание, получено: {name}"
            )
        tests.append((name, path))

    if not tests:
        raise SystemExit(f"team{team}: нет ни одного теста")
    if len(tests) > MAX_TESTS_PER_TEAM:
        raise SystemExit(
            f"team{team}: максимум {MAX_TESTS_PER_TEAM} тестов, найдено {len(tests)}"
        )
    return tests


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--solution", required=True, help="скомпилированное решение")
    parser.add_argument("--attacks-dir", default="attacks")
    parser.add_argument("--target", required=True, type=int, choices=TEAMS)
    parser.add_argument("--revisions", help="JSON с solution_rev/attacks_rev")
    parser.add_argument("--out", required=True)
    args = parser.parse_args()

    solution_rev, attacks_rev = read_revisions(args.revisions, args.target)
    attackers = []
    total_passed = 0
    total_tests = 0

    for team in TEAMS:
        if team == args.target:
            if os.path.isdir(os.path.join(args.attacks_dir, f"team{team}")):
                print(f"warning: attacks/team{team} ignored (self-attack)", file=sys.stderr)
            continue

        team_dir = os.path.join(args.attacks_dir, f"team{team}")
        tests = collect_tests(team_dir, team)
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
    print(
        f"team{args.target} defense: {total_passed}/{total_tests} "
        f"({'held' if output['defense']['held'] else 'broken'})"
    )


if __name__ == "__main__":
    main()
