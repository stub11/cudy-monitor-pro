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
                self.assertIn(kwargs["payload"]["ref"], (
                    "refs/tags/telegram-attempted-v1.2.10",
                    "refs/tags/telegram-announced-v1.2.10"))
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
            self.assertEqual(calls.count("git/refs"), 2)
            self.assertLess(calls.index("git/refs"), calls.index("git/refs", calls.index("git/refs")+1))

    def test_ambiguous_v1_2_13_does_not_send_twice(self):
        with patch.object(publisher, "version_from_source", return_value="1.2.13"), \
             patch.object(publisher, "github_request", return_value=None), \
             patch.object(publisher, "telegram_send") as send:
            self.assertEqual(publisher.main(), 0)
            send.assert_not_called()

    def test_existing_attempt_marker_blocks_send(self):
        def fake_api(path, token, **kwargs):
            if path == "git/ref/tags/telegram-announced-v1.2.10": return None
            if path == "git/ref/tags/telegram-attempted-v1.2.10": return {"ref":"exists"}
            raise AssertionError(path)
        with patch.object(publisher,"version_from_source",return_value="1.2.10"), \
             patch.object(publisher,"github_request",side_effect=fake_api), \
             patch.object(publisher,"telegram_send") as send:
            with self.assertRaisesRegex(publisher.PublisherError,"previous Telegram send"):
                publisher.main()
            send.assert_not_called()

    def test_telegram_full_response_larger_than_4096_bytes(self):
        import json
        from unittest.mock import MagicMock
        result = json.dumps({"ok":True,"result":{"message_id":99,
                "text":"Тест " * 2000}},ensure_ascii=False).encode("utf-8")
        response=MagicMock()
        response.read.return_value=result
        context=MagicMock()
        context.__enter__.return_value=response
        with patch.object(publisher,"urlopen",return_value=context):
            publisher.telegram_send("fake-token","@test-group",87621,
                                    publisher.message("1.2.10"),version="1.2.10")
        self.assertGreater(len(result),4096)

    def test_russian_message_and_buttons(self):
        body = publisher.message("1.2.11")
        self.assertIn("Что нового", body)
        self.assertNotIn("Пакеты OpenWrt и Entware опубликованы", body)
        self.assertNotIn("Сборки прошли автоматические проверки GitHub Actions", body)
        self.assertIn("Исправлено обновление", body)
        self.assertNotIn("Fixes the", body)
        buttons = publisher.telegram_keyboard("1.2.11")["inline_keyboard"]
        self.assertEqual(len(buttons), 2)
        self.assertEqual(len(buttons[0]), 2)
        self.assertEqual(len(buttons[1]), 1)
        self.assertIn("openwrt-v1.2.11", buttons[0][0]["url"])
        self.assertIn("cudy-monitor-v1.2.11", buttons[0][1]["url"])
        self.assertIn("github.com/stub11/cudy-monitor-pro", buttons[1][0]["url"])

    def test_unreviewed_release_requires_real_reviewed_changes(self):
        with self.assertRaisesRegex(publisher.PublisherError, "No reviewed Russian changelog"):
            publisher.message("9.9.9")
        with self.assertRaises(publisher.PublisherError):
            publisher.telegram_keyboard("version/unsafe")

    def test_recent_releases_have_specific_short_highlights(self):
        expected = {
            "1.2.15": "памяти",
            "1.2.16": "KeeneticOS",
            "1.2.17": "Многострочные",
            "1.2.18": "ndmc",
            "1.2.19": "Нет данных",
            "1.2.20": "logread",
        }
        for version, keyword in expected.items():
            with self.subTest(version=version):
                body = publisher.message(version)
                changes = body.split("<b>Что нового:</b>\n", 1)[1].split("\n\n", 1)[0]
                self.assertIn(keyword, changes)
                self.assertLessEqual(len(changes.splitlines()), 3)
                self.assertTrue(all(line.startswith("• ") for line in changes.splitlines()))
                self.assertNotIn("Пакеты OpenWrt и Entware опубликованы", body)
                self.assertNotIn("GitHub Actions", body)
                self.assertNotIn("Доступна новая версия монитора", body)
                self.assertIn("Выберите платформу", body)

    def test_announcement_escapes_reviewed_notes(self):
        with patch.dict(publisher.RELEASE_NOTES_RU, {"9.9.8": ["Исправлено <устройство> & панель"]}):
            result = publisher.changelog("9.9.8")
        self.assertIn("&lt;устройство&gt; &amp;", result)

    def test_telegram_payload_uses_inline_buttons_and_topic(self):
        import json
        from unittest.mock import MagicMock
        response = MagicMock()
        response.read.return_value = b'{"ok":true,"result":{"message_id":42}}'
        context = MagicMock()
        context.__enter__.return_value = response
        with patch.object(publisher, "urlopen", return_value=context) as opener:
            publisher.telegram_send(
                "test-telegram", "@test-group", 87621,
                publisher.message("1.2.11"), version="1.2.11"
            )
        request = opener.call_args.args[0]
        payload = json.loads(request.data)
        self.assertEqual(payload["message_thread_id"], 87621)
        self.assertTrue(payload["disable_notification"])
        self.assertEqual(payload["parse_mode"], "HTML")
        self.assertEqual(len(payload["reply_markup"]["inline_keyboard"]), 2)
        self.assertIn("github.com", payload["reply_markup"]["inline_keyboard"][0][0]["url"])

    def test_missing_actions_secrets_fails_visibly_without_sending(self):
        # Vercel env is not implicitly available in GitHub Actions.
        with patch.dict(os.environ, {"CUDY_TELEGRAM_BOT_TOKEN": "",
                                     "CUDY_TELEGRAM_CHAT_ID": "",
                                     "CUDY_TELEGRAM_TOPIC_ID": ""}), \
             patch.object(publisher, "telegram_send") as send:
            with self.assertRaisesRegex(publisher.PublisherError,
                                        "Missing GitHub Actions secrets"):
                publisher.main()
            send.assert_not_called()

    def test_version_1_2_14_has_reviewed_russian_notes(self):
        msg = publisher.message("1.2.14")
        self.assertIn("отката", msg)
        self.assertIn("openwrt-v1.2.14", publisher.telegram_keyboard("1.2.14")["inline_keyboard"][0][0]["url"])

    def test_version_1_2_13_has_reviewed_russian_notes(self):
        msg = publisher.message("1.2.13")
        self.assertIn("подтверждает завершение обновления", msg)
        self.assertIn("автоматического повторного обновления", msg)
        self.assertIn("openwrt-v1.2.13", publisher.telegram_keyboard("1.2.13")["inline_keyboard"][0][0]["url"])

    def test_version_1_2_12_has_reviewed_russian_notes(self):
        msg = publisher.message("1.2.12")
        self.assertIn("сверяются версии файла", msg)
        self.assertIn("откат", msg)
        self.assertIn("OpenWrt", msg)

    def test_invalid_topic_rejected(self):
        with patch.dict(os.environ, {"CUDY_TELEGRAM_TOPIC_ID": "bad"}):
            with self.assertRaises(publisher.PublisherError):
                publisher.main()


if __name__ == "__main__":
    main()
