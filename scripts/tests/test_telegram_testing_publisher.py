import importlib.util
from pathlib import Path
from unittest import TestCase, main
from unittest.mock import patch
import json

path=Path(__file__).resolve().parents[1]/"telegram_testing_publisher.py"
spec=importlib.util.spec_from_file_location("telegram_testing_publisher",path)
import sys
sys.path.insert(0,str(path.parent))
publisher=importlib.util.module_from_spec(spec)
spec.loader.exec_module(publisher)


def candidate():
    return {
      "id":43838225019,
      "name":"Build isolated OpenWrt candidate APK 1.2.26 (no release)",
      "status":"completed","conclusion":"success","head_branch":"main",
      "head_sha":"a"*40
    }


def artifact():
    return {"artifacts":[{
      "name":"cudy-openwrt-candidate-1.2.26-arm64-not-released",
      "expired":False,"size_in_bytes":375038,
      "digest":"sha256:"+"a"*64
    }]}


def release():
    return {
      "tag_name":"cudy-monitor-openwrt-v1.2.27",
      "prerelease":True,"draft":False,
      "assets":[{"name":"cudy-monitor-pro-1.2.27-r1.apk",
                 "state":"uploaded","size":350000,"digest":"sha256:"+"a"*64}]
    }


class TestingPublisherTests(TestCase):
    def test_candidate_fails_closed_without_verified_main_artifact(self):
        self.assertTrue(publisher.eligible_candidate(candidate(),artifact()))
        for field,value in [("head_branch","test"),("conclusion","failure"),("head_sha","bad")]:
            r=candidate();r[field]=value
            self.assertFalse(publisher.eligible_candidate(r,artifact()))
        for field,value in [("expired",True),("digest","not verified"),
                            ("size_in_bytes",0),("name","other")]:
            a=artifact();a["artifacts"][0][field]=value
            self.assertFalse(publisher.eligible_candidate(candidate(),a))
        self.assertFalse(publisher.eligible_candidate({},artifact()))

    def test_mipsel_target_specific_verified_notice(self):
        run={"id":44068567009,"name":"Build OpenWrt MIPSEL mt7621 QA APK 1.2.27 (no release)",
             "status":"completed","conclusion":"success","head_branch":"main","head_sha":"a"*40}
        artifact={"artifacts":[{"name":publisher.MIPSEL_CANDIDATE_NAME,
                                "expired":False,"size_in_bytes":360000,
                                "digest":"sha256:"+"a"*64}]}
        self.assertTrue(publisher.eligible_mipsel_candidate(run,artifact))
        notice,keyboard=publisher.mipsel_candidate_message(run)
        for word in ("mipsel_24kc","ramips/mt7621","OpenWrt 25.12+","SHA256SUMS",
                     "OTA пока запрещён","apk add --allow-untrusted"):
            self.assertIn(word,notice)
        self.assertNotIn("--apply-testing",notice)
        self.assertIn("/actions/runs/44068567009",keyboard["inline_keyboard"][0][0]["url"])
        self.assertLess(len(notice),2100)
        for key,value in (("head_branch","test"),("conclusion","failure"),("head_sha","bad")):
            bad=dict(run);bad[key]=value
            self.assertFalse(publisher.eligible_mipsel_candidate(bad,artifact))
        for key,value in (("name","arm64"),("digest","wrong"),("expired",True)):
            bad={"artifacts":[dict(artifact["artifacts"][0])]}
            bad["artifacts"][0][key]=value
            self.assertFalse(publisher.eligible_mipsel_candidate(run,bad))

    def test_prerelease_requires_uploaded_verified_openwrt_asset(self):
        self.assertTrue(publisher.eligible_prerelease(release()))
        for attr,val in [("prerelease",False),("draft",True),
                         ("tag_name","cudy-monitor-v1.2.27"),
                         ("tag_name","cudy-monitor-openwrt-v1.2.25")]:
            data=release();data[attr]=val
            self.assertFalse(publisher.eligible_prerelease(data))
        for attr,val in [("digest","sha256:missing"),("state","new"),
                         ("size",1),("name","cudy-monitor-pro-1.2.26-r1.apk")]:
            data=release();data["assets"][0][attr]=val
            self.assertFalse(publisher.eligible_prerelease(data))

    def test_candidate_text_is_explicit_and_short(self):
        msg,keyboard=publisher.candidate_message(candidate())
        for part in ["1.2.26","OpenWrt 25.12+","Не стабильный релиз",
                     "основной домашний роутер","SHA256SUMS","/cudy_problem",
                     "apk add --allow-untrusted","пока не тестируем"]:
            self.assertIn(part,msg)
        self.assertIn("actions/runs/43838225019",
                      keyboard["inline_keyboard"][0][0]["url"])
        self.assertNotIn("telegram",str(keyboard).lower())
        self.assertLess(len(msg),2100)

    def test_prerelease_text_and_links(self):
        msg,keyboard=publisher.prerelease_message(release())
        self.assertIn("--check-testing",msg)
        self.assertIn("--apply-testing --confirm-testing",msg)
        self.assertIn("OpenWrt 25.12+",msg)
        self.assertIn("/cudy_problem",msg)
        self.assertIn("openwrt-v1.2.27",
                      keyboard["inline_keyboard"][0][0]["url"])
        self.assertLess(len(msg),2100)

    def test_telegram_payload_stays_in_exact_monitor_topic(self):
        from unittest.mock import MagicMock
        response=MagicMock()
        response.read.return_value=b'{"ok":true,"result":{"message_id":57,"message_thread_id":87621}}'
        ctx=MagicMock();ctx.__enter__.return_value=response
        with patch.object(publisher,"urlopen",return_value=ctx) as opener:
            message_id=publisher.telegram_send("fake-token",publisher.GROUP_ID,87621,"test",{})
        self.assertEqual(message_id,57)
        sent=json.loads(opener.call_args.args[0].data)
        self.assertEqual(sent["chat_id"],"-1003834368989")
        self.assertEqual(sent["message_thread_id"],87621)
        self.assertTrue(sent["disable_notification"])
        self.assertEqual(sent["parse_mode"],"HTML")

    def test_idempotency_attempt_tag_before_send(self):
        calls=[]
        def api(path, token, **kw):
            calls.append((path,kw.get("payload",{}).get("ref")))
            if path.startswith("git/ref/tags/"):return None
            if path=="git/ref/heads/main":return {"object":{"sha":"b"*40}}
            if path=="git/refs":return {"ref":kw["payload"]["ref"]}
            raise AssertionError(path)
        with patch.object(publisher,"github_request",side_effect=api), \
             patch.object(publisher,"telegram_send",return_value=42) as send:
            self.assertTrue(publisher.mark_once("candidate-126-123","gh","bot","message",{}))
            send.assert_called_once()
        self.assertIn(("git/refs","refs/tags/telegram-testing-attempted-candidate-126-123"),calls)
        self.assertIn(("git/refs","refs/tags/telegram-testing-announced-candidate-126-123"),calls)

    def test_ambiguous_previous_attempt_does_not_duplicate(self):
        def api(path,token,**kw):
            if path.endswith("telegram-testing-announced-candidate-126-123"):return None
            if path.endswith("telegram-testing-attempted-candidate-126-123"):
                return {"ref":"exists"}
            raise AssertionError(path)
        with patch.object(publisher,"github_request",side_effect=api), \
             patch.object(publisher,"telegram_send") as send:
            self.assertFalse(publisher.mark_once("candidate-126-123","gh","bot","msg",{}))
            send.assert_not_called()

    def test_no_secrets_or_wrong_topic_fails_early(self):
        env={"GH_TOKEN":"gh","CUDY_TELEGRAM_BOT_TOKEN":"bot",
             "CUDY_TELEGRAM_CHAT_ID":"-1003834368989",
             "CUDY_TELEGRAM_TOPIC_ID":"87622"}
        with patch.dict("os.environ",env),patch.object(publisher,"github_request") as gh:
            with self.assertRaisesRegex(publisher.PublisherError,"mismatched"):
                publisher.main()
            gh.assert_not_called()


if __name__=="__main__":
    main()
