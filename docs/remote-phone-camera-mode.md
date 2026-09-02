# Remote Phone Camera Mode

ShotSight treats Remote Phone Camera Mode as an additive product direction, not a replacement for the existing IP camera and Reolink workflow.

## Product Goal

Use the same ShotSight app in two roles:

- Viewer / Controller: the phone at the firing line, running the normal ShotSight target workflow.
- Target Camera: a second phone near the target, remotely controlled by the viewer.

When the viewer taps Check Target, the target phone must capture a real high-resolution still photo, not a screenshot from preview video. That image should enter the same capture, registration, analysis, shot review, measurement, zeroing, history, overlay, and export pipeline used by IP-camera captures.

## Source Model

The analysis pipeline should not care whether an image came from:

- IP camera / Reolink / RTSP
- Remote phone
- Imported image
- Future ShotSight hardware

The domain-level source contract is `CameraSource` in `src/domain/cameraSource.ts`. Implementations advertise capabilities such as live preview, high-resolution still capture, zoom, focus, exposure, torch, battery status, and network status. This avoids forcing every source to support every control.

Current source types are:

- `ip-camera`
- `remote-phone`
- `imported-image`
- `shotsight-hardware`

Existing `Capture` records still persist through the current session database. The first compatibility bridge is source metadata on `CameraCaptureMetadata`; a later persistence migration should make captures fully source-independent by replacing the required `camera_profile_id` assumption with nullable camera/source identity fields.

## Local Mock First

Before backend infrastructure, the app includes an in-memory mock remote-phone service:

- Target Camera mode can start a local mock session.
- The target side generates a short pairing code and QR payload string.
- Viewer mode can pair with that code in the same app runtime.
- Viewer commands currently model `requestPreview`, `requestCapture`, `ping`, and `disconnect`.
- Mock captures receive IDs, sequence numbers, byte-size estimates, and queued status.

This is intentionally not production transport. It gives us a safe UI and domain model to iterate against while preserving the local IP-camera build.

## Data Flow

Remote phone photo mode should flow like this:

```text
Viewer taps Check Target
-> RemoteCommandService sends requestCapture
-> Target phone acknowledges the command
-> Target phone captures a full-resolution still
-> Capture is stored in a rolling local target-phone queue
-> ImageTransferService uploads or relays the image
-> Viewer confirms receipt
-> Viewer stores the image as a ShotSight Capture
-> Existing registration and impact analysis runs
-> New impact candidates enter the normal review workflow
```

Every remote capture should carry:

- capture ID
- session ID
- source type
- source device ID
- timestamp
- sequence number
- transfer status
- local file URI
- preview URI when available
- original resolution
- metadata

## Transport Direction

The remote-phone path cannot assume direct LAN connectivity. Phones may be on separate cellular networks behind carrier NAT, so the architecture should support:

- signaling over a secure backend channel
- WebRTC for live preview when practical
- STUN/TURN for peer connection setup and relay fallback
- HTTPS or resumable object upload for high-resolution still transfer
- short-lived temporary storage, if object transfer is used

Photo Mode should be the default because it is data-efficient and matches the range workflow. Live View should be optional and adaptive.

## Backend Services To Evaluate

Do not build backend infrastructure until the local mock flow proves the product interaction. When ready, evaluate:

- PairingService: creates expiring pairing codes and anonymous session tokens.
- SignalingService: carries viewer/target presence and WebRTC negotiation.
- RemoteCommandService: sends commands and receives acknowledgements.
- ImageTransferService: moves high-resolution stills with retry/resume semantics.
- LiveVideoTransport: handles optional preview streaming.

The production backend must prevent public camera endpoints, expire pairing codes, encrypt transport, revoke paired devices, and delete or expire temporary cloud objects by default.

## Native Work Still Required

Remote Phone Camera Mode will eventually require native camera access, likely through an Expo-compatible camera module. Add `NSCameraUsageDescription` and the native camera dependency only when high-resolution target-phone capture is implemented. Until then, the iOS build remains focused on the current dev-client, VLC, local-network, and IP-camera needs.

The existing local-network permissions for IP-camera development remain in `app.json`. Do not add Bonjour service declarations or multicast entitlements for remote phone mode. ONVIF WS-Discovery or other multicast discovery remains a separate future decision.
