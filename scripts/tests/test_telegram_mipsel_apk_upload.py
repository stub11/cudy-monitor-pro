import importlib.util
from hashlib import sha256
from io import BytesIO
from pathlib import Path
from unittest import TestCase, main
from unittest.mock import patch, MagicMock
from zipfile import ZipFile
import json
import sys

path = Path(__file__).resolve().parents[1] / "telegram_mipsel_apk_upload.py"
sys.path.insert(0, str(path.parent))
spec = importlib.util.spec_from_file_location("telegram_mipsel_apk_upload", path)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


def fixture():
    apk = b"\x7fELF32 MIPS TEST ONLY" * 1000
    digest = sha256(apk).hexdigest()
    build = "\n".join((
        "source_commit=" + module.SOURCE_SHA, "candidate_version=1.2.26",
        "channel=testing", "architecture=mipsel_24kc", "target=ramips/mt7621",
        "not_a_stable_release=true", "",
    )).encode()
    buf = BytesIO()
    with ZipFile(buf, "w") as zipfile:
        zipfile.writestr(module.APK, apk)
        zipfile.writestr("SHA256SUMS", f"{digest}  {module.APK}\n")
        zipfile.writestr("BUILD-INFO.txt", build)
    zipdata = buf.getvalue()
    run = {"id":module.RUN_ID, "status":"completed","conclusion":"success",
           "head_branch":"main","head_sha":module.SOURCE_SHA}
    meta = {"id":module.ARTIFACT_ID,"name":module.ARTIFACT,"expired":False,
            "digest":"sha256:"+sha256(zipdata).hexdigest(),
            "workflow_run":{"head_sha":module.SOURCE_SHA}}
    return apk, zipdata, run, meta


class MipselDocumentTests(TestCase):
    def test_validates_both_checksums_and_target(self):
        apk, zipdata, run, meta=fixture()
        data,digest=module.verify_artifact(run,meta,zipdata)
        self.assertEqual(data,apk)
        self.assertEqual(digest,sha256(apk).hexdigest())

    def test_rejects_bad_sha_or_wrong_source(self):
        apk,z,run,meta=fixture()
        for key,value in (("digest","sha256:"+"0"*64),("expired",True),
                          ("name","cudy-openwrt-arm64")):
            bad=dict(meta);bad[key]=value
            with self.assertRaises(module.PublisherError):
                module.verify_artifact(run,bad,z)
        run["head_branch"]="test"
        with self.assertRaises(module.PublisherError):
            module.verify_artifact(run,meta,z)

    def test_file_delivery_is_actual_document_to_topic(self):
        apk,_,_,_=fixture()
        result=MagicMock()
        result.read.return_value=b'{"ok":true,"result":{"message_id":94899,"message_thread_id":87621}}'
        cm=MagicMock();cm.__enter__.return_value=result
        with patch.object(module,"urlopen",return_value=cm) as call:
            msg=module.send_document("dummy",apk,sha256(apk).hexdigest())
        self.assertEqual(msg,94899)
        req=call.call_args.args[0]
        self.assertIn("/sendDocument",req.full_url)
        self.assertIn(b'filename="'+module.APK.encode()+b'"',req.data)
        self.assertIn(b'name="message_thread_id"\r\n\r\n87621',req.data)
        self.assertIn(apk,req.data)
        self.assertIn(b"OTA",req.data)
        self.assertIn(b"application/octet-stream",req.data)

    def test_previously_attempted_delivery_is_never_retried(self):
        calls=[]
        def github(path, token, **kwargs):
            calls.append(path)
            if path.startswith("git/ref/tags/"+module.ANNOUNCED):return None
            if path.startswith("git/ref/tags/"+module.ATTEMPT):return {"ref":"exists"}
            raise AssertionError("Should stop before downloads")
        with patch.dict("os.environ",{
            "GH_TOKEN":"fake","CUDY_TELEGRAM_BOT_TOKEN":"fake",
            "CUDY_TELEGRAM_CHAT_ID":module.GROUP,
            "CUDY_TELEGRAM_TOPIC_ID":str(module.TOPIC),
        }),patch.object(module,"github_request",side_effect=github),patch.object(module,"send_document") as send:
            self.assertEqual(module.main(),0)
            send.assert_not_called()
        self.assertEqual(len(calls),2)

    def test_wrong_topic_blocks_all_calls(self):
        with patch.dict("os.environ",{
            "GH_TOKEN":"fake","CUDY_TELEGRAM_BOT_TOKEN":"fake",
            "CUDY_TELEGRAM_CHAT_ID":module.GROUP,
            "CUDY_TELEGRAM_TOPIC_ID":"1234",
        }),patch.object(module,"github_request") as gh:
            with self.assertRaises(module.PublisherError):
                module.main()
            gh.assert_not_called()


if __name__ == "__main__":
    main()
