#!/usr/bin/env python3
"""Read-only mandatory pre-release review of all open GitHub Issues.

Prints every issue for human review and blocks publishing if an issue is
explicitly marked as a release blocker. PRs are not counted as issues.
The GitHub API must succeed; an API outage must never silently bypass review.
"""
import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request

BLOCKER_LABELS = {"release-blocker", "release:blocker", "blocker", "critical", "security"}
repo = os.environ.get("GITHUB_REPOSITORY", "")
token = os.environ.get("GH_TOKEN", "")
if not repo or not token or "/" not in repo:
    sys.exit("ERROR: repository and GitHub token are required for release issue review")
base = f"https://api.github.com/repos/{repo}/issues"
issues = []
for page in range(1, 101):
    url = base + "?" + urllib.parse.urlencode(
        {"state": "open", "per_page": 100, "page": page}
    )
    req = urllib.request.Request(
        url,
        headers={
            "Authorization": f"Bearer {token}",
            "Accept": "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
            "User-Agent": "Cudy-Monitor-Release-Gate",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=20) as response:
            batch = json.load(response)
    except (urllib.error.URLError, ValueError, OSError) as exc:
        sys.exit(f"ERROR: cannot review issues ({type(exc).__name__}); release blocked")
    if not isinstance(batch, list):
        sys.exit("ERROR: invalid GitHub Issues API response; release blocked")
    issues.extend(issue for issue in batch if "pull_request" not in issue)
    if len(batch) < 100:
        break
else:
    sys.exit("ERROR: issue review exceeded 100 pages; release blocked")

issues.sort(key=lambda x: x["number"])
blockers = []
print(f"Pre-release GitHub Issues review: {len(issues)} open issues")
lines = [
    "### Mandatory pre-release GitHub Issues review",
    f"Reviewed **{len(issues)}** open issues (excluding pull requests).",
    "",
    "| Issue | Labels | Release status |",
    "|---|---|---|",
]
for issue in issues:
    labels = {x["name"].strip().lower() for x in issue.get("labels", [])}
    blocking = bool(labels & BLOCKER_LABELS)
    if blocking:
        blockers.append(issue["number"])
    title = str(issue.get("title", "")).replace("|", "/").replace("\n", " ")
    print(f"#{issue['number']}: {title} [{', '.join(sorted(labels)) or 'no labels'}]" +
          (" — BLOCKS RELEASE" if blocking else " — needs review"))
    lines.append(f"| [#{issue['number']}]({issue['html_url']}) — {title} | "
                 f"{', '.join(sorted(labels)) or 'none'} | "
                 f"{'BLOCKED' if blocking else 'Review'} |")
lines.append("")
if blockers:
    lines.append("**Release BLOCKED**: " + ", ".join(f"#{n}" for n in blockers))
else:
    lines.append("**Release gate passed**: no issues labeled release-blocker/blocker/critical/security.")
lines.append("Unlabeled issues still require human triage before a high-impact release.")
summary = os.environ.get("GITHUB_STEP_SUMMARY")
if summary:
    with open(summary, "a", encoding="utf-8") as out:
        out.write("\n".join(lines) + "\n")
if blockers:
    sys.exit("ERROR: unresolved release-blocking Issues: " + ", ".join(map(str, blockers)))
print("PASS: all open Issues enumerated; no declared release blockers")
