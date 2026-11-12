#!/usr/bin/env python3
"""Offline tests for release gate: no GitHub requests are made."""
import contextlib
import io
import json
import os
import runpy
import unittest
from unittest.mock import patch

SCRIPT = "scripts/release-issue-gate.py"

class FakeResponse:
    def __init__(self, items):
        self.items = items
    def __enter__(self):
        return self
    def __exit__(self, *_):
        return False

def example_issue(number, labels=(), is_pr=False):
    d = {"number": number, "title": "Example issue", "html_url": f"https://github.com/stub11/cudy-monitor-pro/issues/{number}",
         "labels": [{"name": name} for name in labels]}
    if is_pr:
        d["pull_request"] = {"url": "example"}
    return d

class ReleaseIssueGateTests(unittest.TestCase):
    def run_gate(self, pages=None, fail=False):
        batches = iter(pages or [])
        def fake_urlopen(req, timeout=None):
            if fail:
                raise OSError("API unavailable")
            try:
                items = next(batches)
            except StopIteration:
                raise AssertionError("Unexpected extra page")
            fake = FakeResponse(items)
            return fake
        output = io.StringIO()
        def fake_json_load(response):
            return response.items
        env = {"GITHUB_REPOSITORY": "stub11/cudy-monitor-pro", "GH_TOKEN": "test-only"}
        with patch.dict(os.environ, env), patch("urllib.request.urlopen", side_effect=fake_urlopen), \
             patch("json.load", side_effect=fake_json_load), contextlib.redirect_stdout(output), contextlib.redirect_stderr(output):
            try:
                runpy.run_path(SCRIPT, run_name="__main__")
            except SystemExit as exc:
                return str(exc), output.getvalue()
        return "", output.getvalue()

    def test_open_issues_reviewed_without_blocking(self):
        failure, out = self.run_gate([[example_issue(85), example_issue(7, is_pr=True)]])
        self.assertEqual(failure, "")
        self.assertIn("1 open issues", out)
        self.assertIn("#85:", out)
        self.assertNotIn("#7:", out)

    def test_declared_blocker_fails_closed(self):
        failure, out = self.run_gate([[example_issue(79, ["release-blocker"])]])
        self.assertIn("79", failure)
        self.assertIn("BLOCKS RELEASE", out)

    def test_api_failure_blocks_publication(self):
        failure, _ = self.run_gate(fail=True)
        self.assertIn("cannot review issues", failure)

    def test_paginates_and_excludes_pull_requests(self):
        batch = [example_issue(i, is_pr=(i < 99)) for i in range(1, 101)]
        failure, out = self.run_gate([batch, [example_issue(101)]])
        self.assertEqual(failure, "")
        self.assertIn("3 open issues", out)

if __name__ == "__main__":
    unittest.main()
