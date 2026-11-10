import importlib.util
import os
from pathlib import Path
from unittest import TestCase, main
from unittest.mock import patch

path = Path(__file__).resolve().parents[1] / "telegram_release_publisher.py"
spec = importlib.util.spec_from_file_location("publisher", path)
publisher = importlib.util.module_from_spec(spec)
spec.loader.exec_module(publisher)


def release(tag, asset):
    return {
        "tag_name": tag, "draft": False, "published_at": "2026-11-10T00:00:00Z",
        "assets": [{"name": asset, "state": "uploaded", "size": 200000,
                    "digest": "sha256:" + "a" * 64}],
    }


class PublisherTests(TestCase):
    def setUp(self):
        self.version = "1.2.10"
        self.apk = release("cudy-monitor-openwrt-v1.2.10", "cudy-monitor-pro-1.2.10-r1.apk")
        self.ipk = release("cudy-monitor-v1.2.10", "cudy-monitor-pro_1.2.10-1_aarch64-3.10.ipk")
        env = patch.dict(os.environ, {
            "GH_TOKEN": "test-github", "CUDY_TELEGRAM_BOT_TOKEN": "test-telegram",
            "CUDY_TELEGRAM_CHAT_ID": "@test-group", "CUDY_TELEGRAM_TOPIC_ID": "87621"
        })
        env.start()
        self.addCleanup(env.stop)

    def test_checksum_asset_exact(self):
        self.assertTrue(publisher.validated_release(self.apk, self.apk["tag_name"],
                                                     "cudy-monitor-pro-1.2.10-r1.apk"))
        self.assertFalse(publisher.validated_release(self.apk, self.apk["tag_name"], "other.apk"))
        invalid = dict(self.apk)
        invalid["assets"] = [{**self.apk["assets"][0], "digest": ""}]
        self.assertFalse(publisher.validated_release(invalid, self.apk["tag_name"],
                                                      "cudy-monitor-pro-1.2.10-r1.apk"))

    def test_deduplication_skips_publish(self):
        with patch.object(publisher, "version_from_source", return_value=self.version), \
             patch.object(publisher, "github_request", return_value={"ref": "tag"}), \
             patch.object(publisher, "telegram_send") as send:
            self.assertEqual(publisher.main(), 0)
            send.assert_not_called()

    def test_missing_release_skips(self):
        def fake_api(path, token, **kwargs):
            if path.startswith("git/ref/tags/"): return None
            if "openwrt" in path: return self.apk
            return None
        with patch.object(publisher, "version_from_source", return_value=self.version), \
             patch.object(publisher, "github_request", side_effect=fake_api), \
             patch.object(publisher, "telegram_send") as send:
            self.assertEqual(publisher.main(), 0)
            send.assert_not_called()

    def test_posts_then_sets_marker(self):
        calls = []
        def api(path, token, **kwargs):
            calls.append(path)
            if path.startswith("git/ref/tags/"): return None
            if path == "releases/tags/cudy-monitor-openwrt-v1.2.10": return self.apk
            if path == "releases/tags/cudy-monitor-v1.2.10": return self.ipk
            if path == "git/ref/heads/main": return {"object": {"sha": "f" * 40}}
            if path == "git/refs":
                self.assertEqual(kwargs["payload"]["ref"], "refs/tags/telegram-announced-v1.2.10")
                return {"ref": kwargs["payload"]["ref"]}
            raise AssertionError(path)
        with patch.object(publisher, "version_from_source", return_value=self.version), \
             patch.object(publisher, "github_request", side_effect=api), \
             patch.object(publisher, "telegram_send") as send:
            self.assertEqual(publisher.main(), 0)
            send.assert_called_once()
            self.assertEqual(send.call_args.args[2], 87621)
            self.assertIn("1.2.10", send.call_args.args[3])
            self.assertEqual(calls[-1], "git/refs")

    def test_invalid_topic_rejected(self):
        with patch.dict(os.environ, {"CUDY_TELEGRAM_TOPIC_ID": "bad"}):
            with self.assertRaises(publisher.PublisherError):
                publisher.main()


if __name__ == "__main__":
    main()
