#!/usr/bin/env python3
"""Count solution and attack revisions on the current battle branch."""

import argparse
import json
import subprocess


TEAMS = (1, 2, 3, 4, 5)


def git(*args):
    return subprocess.check_output(["git", *args], text=True).strip()


def count_commits(base, path):
    try:
        out = git("rev-list", "--count", f"{base}..HEAD", "--", path)
    except subprocess.CalledProcessError:
        return 0
    return int(out or 0)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--target", required=True, type=int, choices=TEAMS)
    parser.add_argument("--out", required=True)
    args = parser.parse_args()

    try:
        base = git("merge-base", "HEAD", "origin/main")
    except subprocess.CalledProcessError:
        base = git("rev-parse", "origin/main")

    revisions = {
        "base": base,
        "head": git("rev-parse", "HEAD"),
        "solution_rev": count_commits(base, "solution.cpp"),
        "attacks_rev": {
            str(team): count_commits(base, f"attacks/team{team}")
            for team in TEAMS
            if team != args.target
        },
    }

    with open(args.out, "w", encoding="utf-8") as f:
        json.dump(revisions, f, indent=2, ensure_ascii=False)

    print(
        "revisions: solution={solution_rev}, ".format(**revisions)
        + ", ".join(f"team{k}={v}" for k, v in revisions["attacks_rev"].items())
    )


if __name__ == "__main__":
    main()
