package dev.cm.monitor.cloudstand;

import android.app.Activity;
import android.app.Instrumentation;
import android.os.Build;
import android.os.Bundle;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import java.nio.charset.StandardCharsets;
import java.security.KeyPair;
import java.security.KeyPairGenerator;
import java.security.KeyStore;
import java.security.MessageDigest;
import java.security.Signature;
import java.security.spec.ECGenParameterSpec;
import java.util.UUID;
import javax.crypto.KeyAgreement;

public final class KeystoreProbe extends Instrumentation {
    @Override public void onCreate(Bundle arguments) {
        super.onCreate(arguments);
        start();
    }

    @Override public void onStart() {
        Bundle result = new Bundle();
        if (Build.VERSION.SDK_INT < 31) {
            result.putString("stream", "SKIP: Android 12 or newer is required for Keystore ECDH.\n");
            finish(Activity.RESULT_CANCELED, result);
            return;
        }
        try {
            verifyKeystore();
            result.putString("stream", "PASS: Keystore ECDH and ECDSA round-trips.\n");
            finish(Activity.RESULT_OK, result);
        } catch (Exception failure) {
            result.putString("stream", "FAIL: " + failure.getClass().getSimpleName() + "\n");
            finish(Activity.RESULT_CANCELED, result);
        }
    }

    private static void verifyKeystore() throws Exception {
        String alias = "aurora-cloud-probe-" + UUID.randomUUID();
        String signingAlias = alias + "-sign";
        KeyStore store = KeyStore.getInstance("AndroidKeyStore");
        store.load(null);
        try {
            var generator = KeyPairGenerator.getInstance("EC", "AndroidKeyStore");
            generator.initialize(parameters(alias, KeyProperties.PURPOSE_AGREE_KEY).build());
            KeyPair device = generator.generateKeyPair();
            generator.initialize(parameters(signingAlias, KeyProperties.PURPOSE_SIGN)
                .setDigests(KeyProperties.DIGEST_SHA256).build());
            KeyPair signing = generator.generateKeyPair();
            if (device.getPrivate().getEncoded() != null || signing.getPrivate().getEncoded() != null) {
                throw new IllegalStateException("Keystore key is exportable");
            }

            var peerGenerator = KeyPairGenerator.getInstance("EC");
            peerGenerator.initialize(new ECGenParameterSpec("secp256r1"));
            KeyPair peer = peerGenerator.generateKeyPair();
            var deviceAgreement = KeyAgreement.getInstance("ECDH", "AndroidKeyStore");
            deviceAgreement.init(device.getPrivate());
            deviceAgreement.doPhase(peer.getPublic(), true);
            var peerAgreement = KeyAgreement.getInstance("ECDH");
            peerAgreement.init(peer.getPrivate());
            peerAgreement.doPhase(device.getPublic(), true);
            if (!MessageDigest.isEqual(deviceAgreement.generateSecret(), peerAgreement.generateSecret())) {
                throw new IllegalStateException("ECDH outputs differ");
            }

            byte[] challenge = alias.getBytes(StandardCharsets.UTF_8);
            var signer = Signature.getInstance("SHA256withECDSA");
            signer.initSign(signing.getPrivate());
            signer.update(challenge);
            byte[] signature = signer.sign();
            var verifier = Signature.getInstance("SHA256withECDSA");
            verifier.initVerify(signing.getPublic());
            verifier.update(challenge);
            if (!verifier.verify(signature)) throw new IllegalStateException("Invalid signature");
        } finally {
            try { store.deleteEntry(alias); }
            finally { store.deleteEntry(signingAlias); }
        }
    }

    private static KeyGenParameterSpec.Builder parameters(String alias, int purpose) {
        return new KeyGenParameterSpec.Builder(alias, purpose)
            .setAlgorithmParameterSpec(new ECGenParameterSpec("secp256r1"));
    }
}
