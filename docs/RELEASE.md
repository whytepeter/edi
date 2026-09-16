# Releasing Edi for other Macs

`pnpm --filter @edi/desktop release` builds Edi the way someone else downloads it:

- signed with a Developer ID certificate,
- with hardened runtime on,
- notarized by Apple, with the ticket stapled,
- as a `.dmg` and a `.zip` in `apps/desktop/release/` (Apple silicon).

It checks the certificate and credentials before the slow native builds. At the end it verifies what a downloaded copy will meet: `codesign`, Gatekeeper (`spctl`) and the stapled ticket.

`pnpm --filter @edi/desktop package` stays the quick local build. It is unsigned (ad-hoc), only for this Mac, and a Mac that downloads it will refuse to open it.

## One-time setup (the owner)

1. **Join the Apple Developer Program** at developer.apple.com (paid, yearly). "Apple Development" certificates, which Xcode creates for free, only run on your own Macs. Apple will not notarize them.
2. **Create a Developer ID Application certificate.** In Xcode, open Settings → Accounts → your team → Manage Certificates → + → *Developer ID Application*. It lands in your login keychain. Check with:

   ```sh
   security find-identity -v -p codesigning
   ```

   It should list `"Developer ID Application: <Name> (<TEAM ID>)"`.
3. **Create an App Store Connect API key** for notarization. In App Store Connect, open Users and Access → Integrations → App Store Connect API → Team Keys → +, with the *Developer* role.
   - Download the `.p8` file. Apple lets you download it only once.
   - Note the **Key ID** and the **Issuer ID**.
4. **Put the credentials in your shell, never in the repo.** For example, in `~/.edi-release.env`, loaded with `source ~/.edi-release.env` before a release:

   ```sh
   export APPLE_API_KEY="$HOME/.appstoreconnect/AuthKey_XXXXXXXXXX.p8"
   export APPLE_API_KEY_ID="XXXXXXXXXX"
   export APPLE_API_ISSUER="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
   ```

   Two other credential groups also work, but the API key is the recommended one:
   - `APPLE_ID` + `APPLE_APP_SPECIFIC_PASSWORD` + `APPLE_TEAM_ID`
   - `APPLE_KEYCHAIN` + `APPLE_KEYCHAIN_PROFILE`

   With several Developer ID certificates, `CSC_NAME` picks one. On CI, `CSC_LINK` and `CSC_KEY_PASSWORD` import the certificate, and `CSC_NAME` names it.

## Releasing

```sh
source ~/.edi-release.env
pnpm --filter @edi/desktop release
```

Notarization usually takes a few minutes, occasionally longer. Before sharing a build, test the `.dmg` on a Mac that has never run Edi:
- it opens without a "can't be verified" warning,
- it asks for the microphone, Screen Recording, Calendar and Reminders when first needed.

## What is signed, and why

Every executable in the bundle is signed with the same identity and hardened runtime:
- Electron and its helpers,
- `onnxruntime-node`,
- `koffi`,
- the screen helper,
- `edi-hotkey`,
- `whisper-server` and `whisper-cli`,
- `espeak-ng`.

Entitlements live in `apps/desktop/signing/entitlements.mac.plist`. It is kept outside `build/`, which holds only generated files and may be deleted.

| Entitlement | Why |
| --- | --- |
| `cs.allow-jit`, `cs.allow-unsigned-executable-memory` | Electron's JavaScript engine compiles code as it runs. |
| `device.audio-input` | Hold ⌥ Space to talk. |
| `personal-information.calendars` | Calendar and Reminders through EventKit. |

Library validation stays on: everything Edi loads is signed by the same team. Add an entitlement only when a feature needs it, and note it here.
