plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.compose")
}
android {
    namespace = "dev.cm.monitor"
    compileSdk = 36
    defaultConfig {
        applicationId = "dev.cm.monitor"
        minSdk = 26
        targetSdk = 35
        versionCode = 8
        versionName = "0.1.7"
    }
    // Stable signing is opt-in; the keystore is never committed or uploaded.
    // GitHub Actions provisions CM_SIGNING_STORE_FILE from its encrypted secrets.
    val signingStore = System.getenv("CM_SIGNING_STORE_FILE")
    val signingStorePassword = System.getenv("CM_SIGNING_STORE_PASSWORD")
    val signingKeyPassword = System.getenv("CM_SIGNING_KEY_PASSWORD")
    val configured = listOf(signingStore, signingStorePassword, signingKeyPassword).count { !it.isNullOrBlank() }
    require(configured == 0 || configured == 3) { "Incomplete CM signing configuration" }
    if (configured == 3) {
        signingConfigs {
            create("cmStable") {
                storeFile = file(signingStore!!)
                storePassword = signingStorePassword!!
                keyAlias = "cm"
                keyPassword = signingKeyPassword!!
            }
        }
        buildTypes {
            getByName("debug") {
                signingConfig = signingConfigs.getByName("cmStable")
            }
        }
    }
    buildFeatures { compose = true }
    packaging {
        resources {
            pickFirsts += setOf("META-INF/LICENSE.md", "META-INF/NOTICE.md")
        }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}
dependencies {
    implementation(platform("androidx.compose:compose-bom:2026.03.00"))
    implementation("androidx.compose.material3:material3")
    implementation("androidx.activity:activity-compose:1.11.0")
    implementation("androidx.core:core:1.17.0")
    implementation("com.hierynomus:sshj:0.41.2")
    implementation("org.bouncycastle:bcprov-jdk18on:1.86")
    implementation("org.bouncycastle:bcutil-jdk18on:1.86")
    implementation("org.bouncycastle:bcpkix-jdk18on:1.86")
    testImplementation("junit:junit:4.13.2")
}
