#!/usr/bin/env python3
"""Count revisions made after the first battle of a target branch."""

import argparse
import json
import subprocess

from config import load_config


def git(*args):
    return subprocess.check_output(["git", *args], text=True).strip()


def count_commits(base, path):
    if not base:
        return 0
    try:
        out = git("rev-list", "--count", f"{base}..HEAD", "--", path)
    except subprocess.CalledProcessError:
        return 0
    return int(out or 0)


def first_battle_commit(target):
    try:
        raw = git("show", "origin/main:site/history.json")
        history = json.loads(raw)
    except (subprocess.CalledProcessError, json.JSONDecodeError):
        return None

    entries = [
        entry
        for entry in history.get("attacks", [])
        if str(entry.get("target", "")) == str(target) and entry.get("commit")
    ]
    if not entries:
        return None

    first = min(
        entries,
        key=lambda entry: (entry.get("timestamp", ""), entry.get("id", "")),
    )
    return first["commit"]


def has_tests(commit, team):
    path = f"attacks/team{team}"
    try:
        out = git("ls-tree", "-r", "--name-only", commit, "--", path)
    except subprocess.CalledProcessError:
        return False
    return any(line.endswith("/input.txt") for line in out.splitlines())


def first_addition(base, team):
    path = f"attacks/team{team}"
    try:
        out = git(
            "log",
            "--reverse",
            "--diff-filter=A",
            "--format=%H",
            f"{base}..HEAD",
            "--",
            path,
        )
    except subprocess.CalledProcessError:
        return None
    lines = out.splitlines()
    return lines[0] if lines else None


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--target", required=True)
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

    base = first_battle_commit(args.target)
    solution_rev = count_commits(base, "solution.cpp")
    attacks_rev = {}

    for team in teams:
        if str(team) == args.target:
            continue
        if not base:
            team_base = None
        elif has_tests(base, team):
            team_base = base
        else:
            team_base = first_addition(base, team)
        attacks_rev[str(team)] = count_commits(team_base, f"attacks/team{team}")

    revisions = {
        "base": base,
        "head": git("rev-parse", "HEAD"),
        "solution_rev": solution_rev,
        "attacks_rev": attacks_rev,
    }

    with open(args.out, "w", encoding="utf-8") as f:
        json.dump(revisions, f, indent=2, ensure_ascii=False)

    print(
        "revisions: solution={solution_rev}, ".format(**revisions)
        + ", ".join(f"team{k}={v}" for k, v in revisions["attacks_rev"].items())
    )


if __name__ == "__main__":
    main()
