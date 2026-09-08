Experimental PalmDesk desktop installers for testing.

| Download            | Computer                          |
| ------------------- | --------------------------------- |
| `*-mac-arm64.dmg`   | Apple Silicon Mac                 |
| `*-windows-x64.exe` | Windows 10 1903+ / Windows 11 x64 |

Open the DMG and drag PalmDesk into Applications, or run the Windows installer.
Node.js, pnpm, Xcode and Visual Studio are not needed on the user's computer.

- macOS builds have a local ad-hoc signature, not a Developer ID signature, and are not notarized. Gatekeeper may block opening them. Screen Recording and Accessibility permissions are required for remote control.
- Windows installers are unsigned. SmartScreen or organization policies may warn or block installation.
- The macOS package is for Apple Silicon only, built on macOS 15. Intel Macs are not supported by this prerelease. Earlier macOS versions have not been validated.
- The desktop app connects to https://palmdesk.abreto.icu by default. The phone web client and desktop must use the same service. The installer does not include the backend.
- Automatic updates are not included. Download and install a newer release to update.

These builds pass source checks and packaging verification in CI. Real screen capture, input, permission recovery and phone/network behavior still require testing on physical devices.

`SHA256SUMS.txt` contains SHA256 hashes of the two installers.
This prerelease does not resolve the known dependency and license review items in [release prerequisites](https://github.com/Abreto/palmdesk/blob/main/docs/OPEN_SOURCE_READINESS.md).
