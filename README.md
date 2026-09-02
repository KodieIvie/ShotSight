# shotSight

shotSight is a mobile-first, local-first target-camera app for long-range shooting. A target-side IP camera and the phone stay on the same isolated range LAN; no cloud, account, subscription, Firebase dependency, telemetry, ad SDK, or internet connection is required for the core flow.

The first preset is the Reolink RLC-520A, but it is treated as a standards-based local camera. Reolink-specific behavior is isolated to a preset and adapter; the app core is built around RTSP, HTTP snapshots, and a local ONVIF Device-service probe.

> Safety boundary: shotSight records and measures target impacts only. It does not control firearms or any firearm-related hardware.

## What is implemented

- React Native + TypeScript mobile scaffold for iOS and Android using an Expo **development build**.
- Vendor-neutral `CameraAdapter` boundary with a generic RTSP adapter and a direct-local RLC-520A adapter. Neither uses the Reolink app, cloud, P2P, or API account.
- Secure Keychain/Keystore credential vault. Camera database rows hold only a credential reference and credential-free endpoint templates; passwords and usernames are not written to SQLite or diagnostics.
- Local SQLite schema/repositories for cameras, sessions, targets, captures, baselines, shots, groups, calibration, and settings. Original image files remain in app document storage; SQLite stores their references.
- Local camera wizard with manual IP/hostname, generic RTSP URLs, credentials, snapshot test, RLC-520A defaults, and a diagnostics page that explicitly treats an unavailable WAN as normal.
- A local ONVIF Device-service probe with safe endpoint validation, HTTP Basic authentication, credential-redacted diagnostics, SOAP fault classification, and no cloud or subnet scan.
- Native VLC-backed RTSP target viewer with RTSP-over-TCP preference, first-frame timing, reconnect backoff, pinch zoom, pan, control hiding, and a landscape/full-screen workflow hook.
- Native high-resolution HTTP snapshot capture. It preserves the returned original bytes, validates its image format/dimensions, generates a separate preview, and records capture metadata locally.
- Sessions, target baseline capture/reset, capture review, manual impact marking, automatic confirmed-shot numbering, an editable cold-bore designation, and flyer exclusion without deletion.
- A target-tool workflow: lock a target ROI, calibrate using a known line or manual pixels-per-inch scale, set POA and desired-zero references, and retain all coordinates at original-image resolution.
- Before/after review with overlay, swipe, and blink modes; named groups with independent membership/exclusions; center-to-center, MOA, MIL, and POI measurement displays.
- An early desktop image-processing harness with exposure normalization, ROI-aware small-translation registration, robust differencing, morphology, connected components, scoring, machine-readable coordinates, and debug images.
- A device-local JPEG analysis adapter: ROI-aware translation registration, exposure/local-contrast normalization, robust differencing, morphology, connected components, confidence scoring, and candidate clustering. It operates on bounded-resolution working frames while preserving original-resolution coordinates.
- Target-specific interpretation strategies: paper holes remain conservative around dark compact changes, while steel paint-chip changes remain reviewable with polarity/irregular-shape evidence. Neither strategy silently confirms a shot.
- Durable local analysis jobs and candidate audit records. Candidates are deduplicated against confirmed shots and existing pending candidates; confirming one atomically creates exactly one next-numbered automatic shot.
- Automatic standard analysis after each non-baseline capture, a review-before-numbering screen, a 3x newest-impact focus view, and an aggressive clean-baseline **Search hard** recovery path.
- Local CSV session-export screen: it writes a timestamped, non-overwriting report in app document storage, covers every target/group/shot in the session, and can hand that saved file to the operating-system share sheet only after an explicit user action.
- Multiple named physical targets per session, each with its own baseline, captures, calibration, POA, groups, candidates, and review workspace while keeping shot numbering session-wide.
- Versioned offline target-system pairing: strict credential-free QR payload parsing, a camera-form prefill path, and radio/battery/camera gateway contracts that honestly report when no target-side gateway is installed.
- 122 automated domain/harness/schema/repository/protocol tests for calibration, coordinate-space safety, transforms, numbering/deduplication, target isolation, atomic candidate confirmation, baseline reset integrity, ONVIF SOAP handling, offline pairing and camera-URL safety, session relationships, measurements, range playback, zeroing math, CSV safety, and both desktop/device-local image pipelines.

Milestones 3 through 5 are wired into the local workflow. Detection remains deliberately conservative: candidates never become shots without explicit confirmation. The current adapter accepts saved JPEG captures and corrects small translations only. Perspective/affine/homography registration, a native compute backend, and real-range acceptance thresholds remain the next validation gate.

The export report is deliberately metadata-and-results only: it includes session, target, baseline, calibration, shot, flyer/cold-bore, and group-membership fields, but excludes camera endpoints, credentials, and original image URIs/bytes. Text cells are escaped and formula-looking user text is made literal before the file is written.

## Why React Native + TypeScript

This repository uses React Native + TypeScript with Expo prebuild/development builds. It fits the existing Node/JavaScript tooling and keeps the product cross-platform while allowing native camera dependencies. RTSP is not something a browser/PWA can reliably provide on iOS and Android, so the live viewer uses `react-native-vlc-media-player` behind its own UI boundary.

Expo Go cannot load that custom native RTSP module. Use a development build; Expo describes this as the route for native libraries and production-style builds in its [development-build guide](https://docs.expo.dev/develop/development-builds/introduction/).

The application is a native-mobile product. `npm run web` is useful only for basic UI iteration; it is not a supported RTSP-camera runtime.

## Architecture

```text
App / navigation / range UI
        │
        ├── src/application      orchestration and local app state
        ├── src/domain           pure models, math, transforms, analysis contracts
        ├── src/infrastructure
        │     ├── camera         generic + RLC-520A local adapters and URL redaction
        │     ├── capture        native HTTP still probe/capture and preview creation
        │     ├── remotePhone    local mock pairing/command scaffold for phone-as-camera mode
        │     ├── database       SQLite migrations and repositories
        │     └── security       Keychain/Keystore credential vault
        └── src/ui               mobile screens, controls, and RTSP target viewer

tools/image-harness             desktop-only before/after processing CLI
test_assets                     real target-image fixture convention
```

The important boundary is `CameraAdapter`: screens do not know Reolink URL patterns. An adapter returns candidate local RTSP/snapshot endpoints, and the app uses redacted versions for diagnostics. Authenticated URLs exist only in memory at the playback/capture boundary.

Remote Phone Camera Mode is documented in [docs/remote-phone-camera-mode.md](docs/remote-phone-camera-mode.md). It introduces a broader `CameraSource` contract for IP cameras, remote phones, imported images, and future ShotSight hardware while keeping the current Reolink/IP-camera path intact.

The ONVIF probe and future radio/battery gateway live behind separate infrastructure boundaries. They receive credential-safe local configuration from the application layer and return sanitized status, so neither vendor cloud APIs nor target-hardware details leak into range screens.

## Setup

Prerequisites: Node 22+, npm, and the native toolchain for the platform you will build. Use Android Studio/SDK for Android. Use macOS + Xcode for local iOS device builds.

```powershell
npm install
npm run typecheck
npm test
```

Build an Android development client connected to an emulator or physical Android device:

```powershell
npm run android
npm start
```

### Local iPhone development without paid Apple membership

For early iPhone testing, use a MacBook, Xcode, a connected personal iPhone, and your free Apple ID Personal Team. Do not use EAS cloud signing for this workflow. Expo documents [local development builds](https://docs.expo.dev/develop/development-builds/introduction/) as the route for installing a development build on an iPhone without a paid Apple Developer Program account, and Apple documents that [Xcode can install apps on your personal device](https://developer.apple.com/help/account/membership/program-enrollment/) without paid enrollment.

On the Mac:

```bash
git clone https://github.com/KodieIvie/ShotSight.git
cd ShotSight
npm install
npm run typecheck
npm test
```

Install Xcode from the Mac App Store, open it once, accept licenses, and install any requested components. React Native 0.86 requires Xcode 16.1 or newer; Xcode 15.4 fails during `pod install` with `Please upgrade XCode`. Xcode 16.1 also requires macOS Sonoma 14.5 or newer, so update macOS first if the App Store keeps Xcode pinned to 15.4. For iOS 26.x devices, prefer the current macOS/Xcode pair Apple lists for that iOS version. After installing or updating Xcode, make sure macOS is using the full Xcode toolchain:

```bash
sudo xcode-select --switch /Applications/Xcode.app/Contents/Developer
sudo xcodebuild -license accept
xcodebuild -version
```

In Xcode, add your Apple ID under **Xcode -> Settings -> Accounts** so Xcode can use your Personal Team for signing.

If CocoaPods is missing, install it before building:

```bash
sudo gem install cocoapods
```

or, if you use Homebrew:

```bash
brew install cocoapods
```

If CocoaPods warns that the terminal is not using UTF-8, export a UTF-8 locale before running iOS commands:

```bash
export LANG=en_US.UTF-8
```

Connect the iPhone by USB, trust the Mac on the phone, and enable Developer Mode if iOS prompts for it. Then run:

```bash
npm run ios:device
```

That command runs `expo run:ios --device`. Expo will generate the native `ios/` project if needed, install Pods, build with Xcode, and install the development client on the connected phone.

On the first free Personal Team install, iOS may require you to manually trust the developer before the app will launch. If the app installs but the Mac reports that the profile has not been explicitly trusted, open the iPhone's **Settings -> General -> VPN & Device Management**, select the **Developer App** entry for your Apple ID or Personal Team, and tap **Trust**. Keep the iPhone online for this trust verification step.

If Expo shows `Build Succeeded` but installation ends with `ApplicationVerificationFailed`, check `.expo/xcodebuild.log` for `errSecInternalComponent` or unsigned embedded frameworks. This usually means macOS denied one of CocoaPods' parallel `codesign` calls access to the Apple Development private key. In **Keychain Access**, find the private key under the `Apple Development` certificate, update its access control to allow `/usr/bin/codesign` or choose **Always Allow** when prompted, then rebuild with pod framework signing serialized:

```bash
xcrun xctrace list devices

xcodebuild clean build \
  -workspace ios/shotSight.xcworkspace \
  -configuration Debug \
  -scheme shotSight \
  -destination 'id=<your-connected-iphone-id>' \
  COCOAPODS_PARALLEL_CODE_SIGN=false \
  COMPILER_INDEX_STORE_ENABLE=NO

npm run ios:device
```

If automatic signing fails, or Expo reports `No code signing certificates are available to use`, open the generated workspace manually:

```bash
open ios/*.xcworkspace
```

In Xcode:

1. Select the ShotSight app target.
2. Open **Signing & Capabilities**.
3. Enable **Automatically manage signing**.
4. Set **Team** to your Personal Team.
5. Keep the bundle identifier from `app.json` unless Xcode says it is unavailable for your Personal Team. If that happens, use a unique local identifier such as `com.kodieivie.shotsight.dev` for the local generated project only.
6. Select your connected iPhone as the run destination and press **Run**.

The generated `ios/` and `android/` folders are intentionally ignored by git. Keep native configuration reproducible through `app.json`, `package.json`, `package-lock.json`, and Expo config plugins. If a native package or iOS permission is added later, update those source config files, then regenerate with `npx expo prebuild`.

Daily iPhone development loop:

```bash
npm start
```

Open the installed shotSight development client on the iPhone and connect it to the Metro server shown in the terminal. Rebuild with `npm run ios:device` after changing native dependencies, `app.json`, Expo plugins, iOS permissions, or the bundle identifier.

Expo Go is not a supported runtime for this app. The RTSP viewer uses a custom native VLC-backed module, and the local camera workflow depends on native behavior that Expo Go cannot load.

### Useful commands

```text
npm run typecheck    # strict TypeScript validation
npm test             # domain + image-harness tests
npm run harness -- --help
npm run doctor       # Expo dependency/config diagnostic
npm run prebuild     # generate native projects when needed
npm run ios:device   # build/install on a connected iPhone from macOS
```

## Isolated-LAN camera workflow

1. Power the camera and wireless bridge; connect the phone to the firing-line AP on that same isolated LAN.
2. Ignore the phone’s “No internet” warning. It is expected and is never treated as a camera failure by shotSight.
3. In shotSight, add the camera’s local IP, credentials, and either select **RLC-520A** or enter credential-free generic RTSP/snapshot URLs.
4. Run the high-resolution snapshot test, save the profile, then open **Camera -> Diagnostics** to optionally probe the local ONVIF Device service and **Target** to validate RTSP playback.
5. Start a session, capture a clean baseline, then capture observations as shots are fired.

For the RLC-520A preset, shotSight tries the local patterns documented by Reolink:

- Preview RTSP: `rtsp://<ip>:554/Preview_01_sub`
- Main RTSP: `rtsp://<ip>:554/Preview_01_main`
- Native JPEG `Snap` endpoint candidates for full-resolution capture

Reolink’s own guidance says RTSP/ONVIF may need to be enabled and HTTP/HTTPS must be enabled for JPEG snapshot access. Check **Network → Advanced → Server Settings** on the camera/NVR if a test fails: [RTSP URLs](https://support.reolink.com/articles/360007010473-How-to-Live-View-Reolink-Cameras-via-VLC-Media-Player/), [JPEG Snap endpoint](https://support.reolink.com/articles/360007011233-How-to-Capture-Live-JPEG-Image-of-Reolink-Cameras-via-Web-Browsers/), and [port settings](https://support.reolink.com/articles/900000621783-How-to-Configure-Reolink-Ports-Settings/).

Start with H.264 and RTSP-over-TCP across the bridge. Exact endpoint availability, authentication behavior, codec configuration, and snapshot dimensions are firmware-specific, so validate against the physical camera before relying on a match day.

## High-resolution capture behavior

Capture source priority is deliberately quality-first:

1. A configured/direct native camera HTTP snapshot (the RLC-520A preset supplies local `Snap` candidates).
2. A future main-stream frame extractor behind the same still-capture interface.

The app never uses a phone screen screenshot. It validates downloaded image bytes, retains the immutable original, and creates a disposable smaller preview for mobile rendering.

The first RLC-520A path uses native snapshots. A generic RTSP profile without an HTTP snapshot endpoint can view RTSP, but cannot yet make a compliant high-resolution capture—the main-stream-frame fallback needs real-device validation with the chosen native backend and is intentionally not substituted with a low-resolution preview capture.

## Milestone 2 range workflow

After setting a baseline and taking at least one later capture:

1. Open **Target → Tools** to lock the paper/steel face, calibrate a known line or a trusted pixels-per-inch scale, and set POA/desired zero.
2. Use **Target → Compare** for opacity overlay, drag-to-swipe, or blink review of the clean baseline against the newest capture.
3. In **Shots**, create groups such as `Load A`, `Load B`, or `Cold Bore`. A shot may be in multiple groups; a flyer can be excluded globally or per group without deleting it.
4. Open a group after calibration to see its included count, center-to-center size, MOA, and MIL. The POA / POI tool shows the average impact offset and the equal-and-opposite MOA correction.

These review tools preserve originals. The current mobile detector uses the locked ROI for bounded local translation registration; it does not alter the source image or claim perspective correction.

## Milestone 3 impact workflow

1. Capture a clean baseline, lock the target ROI if useful, then take a later capture. A normal later capture launches a local **standard** analysis pass automatically.
2. If candidates are found, shotSight opens **Review impacts**, centers its 3x focus view on the strongest/newest candidate, and shows confidence breakdowns. Confirming creates the next shot number; rejecting preserves the audit record without deleting any existing shot.
3. Use **Detect** to retry the standard scan, or **Search hard** to compare aggressively against the clean baseline at higher sensitivity when a subtle hit was missed.
4. Analysis jobs, candidate provenance, and registration confidence stay in SQLite. Candidate/shot locations are retained in the clean-baseline coordinate space for deduplication and measurements, while review markers are mapped back onto the captured image.

The analysis adapter reads only local `file://` or `content://` JPEG snapshots. It bounds processing to a 1280-pixel long edge to reduce memory pressure, then maps result coordinates back to original resolution. It does not upload pixels, silently create shots, or replace originals.

## Milestone 4 range-review workflow

1. In **Target -> Tools**, open **Zeroing assistant** after calibration and a POA or desired-zero reference are set. It excludes flyers and historical-baseline shots, then converts the current average POI offset into rounded 1/4 MOA, 1/8 MOA, 0.1 MIL, or custom clicks. The direction shown means the direction the point of impact should move; confirm the convention against the optic before firing a confirmation group.
2. Open **Shot playback** to replay confirmed impacts in shot-number order on the current clean baseline. It has named-group filters, a heatmap, optional shot numbers, and a visual-only include-excluded toggle. Resetting a target starts a fresh timeline and clears its ROI, calibration, POA, and desired-zero references, so old target geometry cannot be overlaid or measured on the replacement target.
3. In **Settings**, choose whether a successful automatic analysis opens the newest-impact focus view. With it off, the capture remains on the live target while the pending candidates stay ready for review.
4. In **Sessions**, choose **Export active** to create a data-only CSV in app-owned local storage. **Save & share** writes the file first and then opens the operating-system share sheet; it is the only action that can expose that report outside the device.
5. A manual mark on an observation is enabled only after **Detect** or **Search hard** has stored its registration to the clean baseline. This prevents an unregistered screen tap from becoming a misleading playback, measurement, or zeroing coordinate.

## Milestone 5 target-system workflow

1. In an active range session, use **Target -> Targets** to add or switch physical targets such as `Load A`, `Cold Bore`, or `Steel rack`. A switch changes the whole on-screen workspace to that target's captures, baseline, setup, groups, candidates, and measurements. Shot numbers remain session-wide and immutable.
2. Select **steel** when creating a steel target. The local detector then uses the steel paint-chip interpretation strategy; bright paint removal and irregular chips remain candidates for review, never automatic shots.
3. Open **Camera -> Diagnostics -> Probe local ONVIF** for a saved, ONVIF-enabled camera. The probe asks only the configured local Device-service endpoint for standard device information and capabilities. It does not scan a subnet, use a vendor cloud, save credentials, or configure media streams.
4. Open **Camera -> Target system setup** to paste a versioned `shotsight:pair:v1:` QR payload. The parser rejects credential-bearing or unknown fields, retains only local endpoint/radio metadata, and can prefill the camera form. Enter camera credentials separately; they remain in Keychain/Keystore.
5. The target-system status card is a safe hardware boundary. In this build, no radio/battery gateway is attached, so it correctly reports unavailable/not-probed rather than inventing a connection. A real gateway can implement the same contract later.

## Image-processing harness

Put private fixture pairs under `test_assets/` following [test_assets/README.md](test_assets/README.md). The files are not uploaded anywhere.

```powershell
npm run harness -- `
  test_assets/paper-overcast-100yd/baseline.jpg `
  test_assets/paper-overcast-100yd/shot1.jpg `
  --debug-dir .local/paper-overcast-100yd `
  --json .local/paper-overcast-100yd/result.json
```

The CLI prints JSON with candidate coordinates, confidence, registration offset/confidence, thresholds, and component count. The optional debug directory contains `registered.png`, `difference.png`, and `mask.png`. See [tools/image-harness/README.md](tools/image-harness/README.md) for parameter details.

Today’s harness registration is intentionally bounded to small translation, now scored within an optional target ROI. Perspective/affine/homography correction will replace that stage once a real target fixture set establishes acceptance thresholds.

## Current limitations / hardware acceptance gate

This code has passed unit/type checks but has not been validated against your physical RLC-520A, wireless bridge, Android device, or iPhone. Before calling camera support production-ready, validate:

- exact camera firmware, H.264 main/sub configuration, enabled ports, correct and incorrect credentials;
- original snapshot dimensions (the desired RLC-520A configuration is typically 2560 × 1920), MIME type, and retained file;
- preview first-frame time, 30-minute stability, bridge loss/recovery, camera reboot, app background/foreground, and rotation;
- isolated Wi-Fi with cellular still enabled and no WAN/DNS;
- HTTP vs HTTPS/self-signed camera behavior;
- both Android and iOS local-network permission prompts;
- Android and iOS development-build CSV save/share behavior (the share sheet is intentionally a post-save, explicit action);
- real before/after pairs under paper, steel, shadow, wind, and lighting changes.
- ONVIF Device-service behavior on the selected camera/firmware, enabled port, correct/incorrect credentials, HTTP versus HTTPS, and its authentication scheme; this first probe supports HTTP Basic, not Digest or WS-Security;
- target isolation with multiple real target faces in one session, including session-wide shot numbering and independent baseline/calibration reset behavior;
- a representative set of steel before/after pairs with paint colors, fresh hits, rust, splash, glare, and shadow changes;
- a real target-side radio/battery gateway only after one is implemented against the published local gateway contract; the current no-hardware result is expected.

Also validate the current detector against repeatable saved JPEG fixture pairs before trusting it at distance. It is a local, translation-only first implementation; a low registration confidence, large camera move, non-JPEG source, or severe perspective change should be treated as a cue to use manual review/marking rather than a reliable miss.

`react-native-vlc-media-player` is intentionally excluded from Expo Doctor’s React Native Directory metadata warning because it is the selected native RTSP backend, not because it has been proven on every current architecture. The real-device matrix above is the compatibility gate; keep the playback boundary swappable until it passes.

Not yet implemented: native WS-Discovery/multicast subnet discovery, ONVIF Media-profile/stream configuration, HTTP Digest or WS-Security ONVIF authentication, a native QR scanner permission flow, a physical radio/battery gateway implementation, a generic main-stream-frame fallback, a native OpenCV-quality affine/homography registration backend, automatic **shot** confirmation (intentionally kept manual), saved optic/turret profiles, multiple target ROIs, and annotated-image/PDF reports. The boundaries are intentionally ready for these additions without coupling the app to Reolink cloud APIs.

## Roadmap

1. **Connectivity hardening:** hardware bakeoff, reconnect/latency stability, snapshot capability cache, and real-device acceptance of the built local ONVIF Device-service probe.
2. **Measurement workflow (built):** lock target/ROI, calibration, before/after modes, manual group selection, group measurements, POA/POI, and a clear path to zeroing display.
3. **Flagship detection (built; hardware validation pending):** local paper-first analysis, confidence/deduplication, confirm/reject UI, auto-center newest shot, and an aggressive “where did it go?” search mode. Replace the bounded translation adapter with native affine/homography registration after fixture and device acceptance testing.
4. **Range polish (built; device validation pending):** named groups, cold-bore and flyer controls, zeroing-click guidance, shot-sequence playback, heatmaps, an auto-focus preference, outdoor-first controls, and private local CSV export.
5. **Commercial-system foundation (built; hardware validation pending):** multiple independently baselined targets, target-scoped workflows, steel interpretation, a local ONVIF Device-service probe, strict versioned offline QR pairing, and radio/battery gateway contracts. Next are a native scanner, WS-Discovery, actual hardware gateway integration, richer reports, multiple ROIs, and affine/homography correction.

The built detection path now includes a paper/steel interpretation choice; its real-world accuracy and thresholds still require saved fixture and range validation.

## Security and privacy notes

- Passwords and usernames are held in platform secure storage; SQLite holds only an opaque credential reference.
- Stored camera endpoint templates reject embedded user-info and common secret query parameters.
- Diagnostics and errors use URL/secret redaction. Do not paste authenticated RTSP URLs into bug reports.
- Snapshot query credentials needed by some Reolink firmware are materialized only for the outbound local request, never persisted or displayed.
- Images remain local. A CSV export does not include image bytes or source URIs; it stays in app document storage until the shooter explicitly opens the operating-system share sheet and chooses a destination.
