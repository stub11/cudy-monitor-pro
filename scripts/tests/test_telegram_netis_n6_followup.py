import importlib.util
import json
import os
from pathlib import Path
from unittest import TestCase, main
from unittest.mock import MagicMock, patch

import sys
path = Path(__file__).resolve().parents[1] / "telegram_netis_n6_followup.py"
sys.path.insert(0, str(path.parent))
spec = importlib.util.spec_from_file_location("telegram_netis_n6_followup", path)
n6 = importlib.util.module_from_spec(spec)
spec.loader.exec_module(n6)

class NetisTesterFollowupTests(TestCase):
    def test_message_has_safe_targeted_questions(self):
        for term in ("Netis N6", "cat /etc/openwrt_release", "apk --print-arch",
                     "top", "free", "ip -s link", "10 минут", "OTA", "Issue #139"):
            self.assertIn(term, n6.MESSAGE)
        self.assertLess(len(n6.MESSAGE), 3000)

    def test_actual_reply_to_document_in_monitor_topic(self):
        fake = MagicMock()
        fake.read.return_value = json.dumps({"ok": True, "result": {
            "message_id": 96543, "message_thread_id": 87621,
            "reply_to_message": {"message_id": 96253}
        }}).encode()
        ctx = MagicMock()
        ctx.__enter__.return_value = fake
        with patch.object(n6, "urlopen", return_value=ctx) as url:
            self.assertEqual(n6.send("fake"), 96543)
            req = url.call_args.args[0]
            payload = json.loads(req.data)
            self.assertEqual(payload["chat_id"], "-1003834368989")
            self.assertEqual(payload["message_thread_id"], 87621)
            self.assertEqual(payload["reply_parameters"], {
                "message_id": 96253, "allow_sending_without_reply": False
            })
            self.assertIn("/sendMessage", req.full_url)

    def test_existing_attempt_does_not_send_again(self):
        def github(path, token, **kwargs):
            if path.endswith(n6.SENT): return None
            if path.endswith(n6.ATTEMPT): return {"ref": "exists"}
            raise AssertionError("No further calls expected")
        with patch.dict(os.environ, {
            "GH_TOKEN": "fake", "CUDY_TELEGRAM_BOT_TOKEN": "fake",
            "CUDY_TELEGRAM_CHAT_ID": n6.CHAT_ID,
            "CUDY_TELEGRAM_TOPIC_ID": str(n6.TOPIC_ID),
        }), patch.object(n6, "github_request", side_effect=github), \
             patch.object(n6, "send") as send:
            self.assertEqual(n6.main(), 0)
            send.assert_not_called()

    def test_wrong_topic_rejects_without_external_calls(self):
        with patch.dict(os.environ, {
            "GH_TOKEN": "fake", "CUDY_TELEGRAM_BOT_TOKEN": "fake",
            "CUDY_TELEGRAM_CHAT_ID": n6.CHAT_ID,
            "CUDY_TELEGRAM_TOPIC_ID": "1",
        }), patch.object(n6, "github_request") as gh:
            with self.assertRaises(n6.PublisherError):
                n6.main()
            gh.assert_not_called()

if __name__ == "__main__":
    main()
