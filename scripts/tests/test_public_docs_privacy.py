#!/usr/bin/env python3
"""Regression tests for public Markdown privacy guard (no real secrets)."""
import pathlib
import shutil
import subprocess
import tempfile
import unittest

GUARD = pathlib.Path(__file__).resolve().parents[1] / "public_release_guard.py"


class PublicDocsPrivacyTests(unittest.TestCase):
    def check_case(self, files, expect_success):
        with tempfile.TemporaryDirectory(prefix="cudy-privacy-test-") as temp:
            root = pathlib.Path(temp)
            (root / "scripts").mkdir()
            shutil.copyfile(GUARD, root / "scripts" / "public_release_guard.py")
            for name, body in files.items():
                dest = root / name
                dest.parent.mkdir(parents=True, exist_ok=True)
                dest.write_text(body, encoding="utf-8")
            subprocess.run(["git", "init", "-q", str(root)], check=True,
                           stdout=subprocess.DEVNULL)
            subprocess.run(["git", "-C", str(root), "add", "."], check=True,
                           stdout=subprocess.DEVNULL)
            result = subprocess.run(["python3", str(root / "scripts" /
                                      "public_release_guard.py")],
                                    stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                    text=True, check=False)
            self.assertEqual(result.returncode == 0, expect_success,
                             f"Unexpected privacy result; stderr: {result.stderr[:250]}")
            # A privacy-check failure must never echo the matched guide contents.
            if not expect_success:
                self.assertNotIn("EXAMPLE_INTERNAL_TEXT", result.stderr)

    def test_rejects_telegram_guide(self):
        self.check_case({"docs/private-guide.md": "Telegram webhook EXAMPLE_INTERNAL_TEXT"}, False)

    def test_rejects_redis_guide(self):
        self.check_case({"bot/ops.md": "Upstash Redis setup EXAMPLE_INTERNAL_TEXT"}, False)

    def test_rejects_cyrillic_release_announcement(self):
        self.check_case({"docs/announcement.md": "автоматические анонсы релизов EXAMPLE_INTERNAL_TEXT"}, False)

    def test_allows_router_readme(self):
        self.check_case({"README.md": "Мониторинг RAM, CPU и WAN"}, True)

    def test_does_not_block_runtime_code(self):
        self.check_case({"bot/api/webhook.js": "// Telegram webhook runtime source code"}, True)


if __name__ == "__main__":
    unittest.main()
