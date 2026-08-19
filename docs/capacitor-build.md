# StarGo — Build nativo con Capacitor

StarGo se despliega como PWA en Vercel (SSR + estático) y como app nativa
(Android/iOS) via Capacitor. Este documento describe cómo generar los builds
nativos.

## Prerrequisitos

### Generales
- Node.js ≥ 22.18
- Bun (para scripts) o npm
- Cuenta de Firebase con proyecto configurado (para FCM)

### Android
- Android Studio (última versión estable)
- JDK 17+
- SDK de Android (API 34+)
- Keystore de firma para release (ver abajo)

### iOS
- macOS con Xcode 15+
- Cuenta de Apple Developer Program
- Certificado de distribución + Provisioning Profile
- O: App Store Connect para TestFlight

## Variables de entorno

Copia `.env.capacitor.example` a `.env.capacitor` y completa:

```
PUBLIC_API_BASE_URL=https://stargo.vercel.app
PUBLIC_SUPABASE_URL=https://TU-PROYECTO.supabase.co
PUBLIC_SUPABASE_ANON_KEY=eyJ...
```

## Build de Android

### 1. Configurar Firebase (FCM)

1. Crear proyecto en [Firebase Console](https://console.firebase.google.com/)
2. Agregar app Android con package name `com.stargo.app`
3. Descargar `google-services.json` y copiarlo a `android/app/google-services.json`
4. En Firebase Console → Project Settings → Cloud Messaging:
   - Habilitar Cloud Messaging API (v1)
   - Copiar el Server Key o configurar Service Account

### 2. Generar el build

```bash
# Build estático + sync con Android
bun run cap:sync

# Abrir en Android Studio
bun run cap:android
```

### 3. Keystore de firma (release)

Generar un keystore (solo una vez):

```bash
keytool -genkey -v -keystore stargo-release.keystore \
  -alias stargo -keyalg RSA -keysize 2048 -validity 10000
```

**NUNCA** commitear el keystore al repositorio. Guardarlo en:
- CI/CD: como secret (GitHub Actions, Vercel, etc.)
- Local: en un directorio fuera del repo, protegido con permisos

Configurar en `android/app/build.gradle`:

```gradle
android {
    signingConfigs {
        release {
            storeFile file('/ruta/segura/stargo-release.keystore')
            storePassword System.getenv('KEYSTORE_PASSWORD') ?: ''
            keyAlias 'stargo'
            keyPassword System.getenv('KEY_PASSWORD') ?: ''
        }
    }
    buildTypes {
        release {
            signingConfig signingConfigs.release
        }
    }
}
```

### 4. Generar APK / AAB

```bash
cd android
./gradlew assembleRelease      # APK (para sideloading / testing)
./gradlew bundleRelease        # AAB (para Google Play Store)
```

Output:
- APK: `android/app/build/outputs/apk/release/app-release.apk`
- AAB: `android/app/build/outputs/bundle/release/app-release.aab`

## Build de iOS

### 1. Configurar APNs + Firebase

1. En [Apple Developer Portal](https://developer.apple.com/account/resources/identifiers/list):
   - Crear App ID con bundle identifier `com.stargo.app`
   - Habilitar Push Notifications
   - Generar Key de APNs (`.p8`) o Certificado de Push

2. En [Firebase Console](https://console.firebase.google.com/):
   - Agregar app iOS con bundle ID `com.stargo.app`
   - Subir el certificado APNs en Project Settings → Cloud Messaging
   - Descargar `GoogleService-Info.plist` y copiarlo a `ios/App/App/`

### 2. Generar el build

```bash
# Build estático + sync con iOS
bun run cap:sync

# Abrir en Xcode
bun run cap:ios
```

### 3. Firma en Xcode

1. Abrir `ios/App/App.xcworkspace` en Xcode
2. Seleccionar target `App`
3. En Signing & Capabilities:
   - Seleccionar Team (cuenta de Developer)
   - Bundle Identifier: `com.stargo.app`
   - Provisioning Profile: seleccionar el correcto

### 4. Archive para distribute

1. En Xcode: Product → Archive
2. En Organizer: Distribute App → Ad Hoc / App Store / TestFlight
3. Exportar el `.ipa`

**Para Testing (Ad Hoc):**
- Necesitas UDIDs de los dispositivos registrados en Apple Developer
- El Provisioning Profile debe incluir esos dispositivos

**Para App Store:**
- Subir vía App Store Connect o `xcrun altool`
- Apple revisa la app antes de publicar

## Variables de Firebase en Supabase

Las Edge Functions necesitan acceso a FCM. Agregar como secrets en
Supabase Dashboard → Edge Functions → send-push → Secrets:

```
FCM_SERVER_KEY=<legacy server key de Firebase>
```

O (recomendado, más seguro):

```
FIREBASE_SERVICE_ACCOUNT=<JSON de la service account>
FIREBASE_PROJECT_ID=<ID del proyecto Firebase>
```

Para obtener la service account:
1. Firebase Console → Project Settings → Service accounts
2. Generate new private key
3. Copiar el contenido JSON completo como secret

## Desarrollo local (Android)

```bash
# Build + sync + abrir emulador
bun run cap:run:android

# O abrir Android Studio directamente
bun run cap:android
```

## Desarrollo local (iOS)

```bash
# Build + sync + abrir en simulador
bun run cap:run:ios

# O abrir Xcode directamente
bun run cap:ios
```

## Notas importantes

- **CORS**: Las API routes en Vercel necesitan permitir requests desde
  `capacitor://localhost` (Android) y `capacitor://localhost` (iOS).
  Configurar en `vercel.json` o en la configuración de CORS de cada endpoint.

- **Service Worker**: El SW de la PWA NO se registra en Capacitor (el WebView
  nativo maneja el push). El código en `+layout.svelte` ya verifica `import.meta.env.PROD`
  antes de registrar.

- **Supabase Realtime**: Funciona igual en Capacitor (WebSocket nativo del
  WebView). No requiere cambios adicionales.

- **Base URL de la API**: En Capacitor, las rutas relativas `/api/...` no
  resuelven (origin = capacitor://localhost). Se usa `PUBLIC_API_BASE_URL`
  para resolverlas a la URL de Vercel. Ver `src/lib/api.ts`.

## Checklist de release

- [ ] Firebase project configured (FCM)
- [ ] `google-services.json` in `android/app/`
- [ ] `GoogleService-Info.plist` in `ios/App/App/`
- [ ] `.env.capacitor` configured with correct API URL
- [ ] Keystore for Android release signing (stored securely)
- [ ] Apple Developer certificate + provisioning profile for iOS
- [ ] FCM secrets configured in Supabase Edge Functions
- [ ] Database migration `fase20_push_nativo_capacitor.sql` executed
- [ ] Test push notification received on both Android and iOS
