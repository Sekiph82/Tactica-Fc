# TACTICA FC iOS Release Prerequisites

## Prepared in this repository

The Capacitor iOS project lives under `ios/App` and uses the shared React application in `dist/tactica-manager`. `@capacitor/ios` is pinned with the other Capacitor packages. The iOS app icon and launch splash assets use the supplied TACTICA FC Black Metal 1024×1024 logo. On Windows, `npm run build` and `npm exec -- cap sync ios` prepare the web assets and synchronize plugins into the native project. These steps check the shared web application and project wiring only; Windows cannot compile or launch the native iOS target.

## Required native environment

- A Mac running macOS with Xcode and Xcode Command Line Tools. The current Capacitor 8 setup guide specifies Node.js 22+ and Xcode 26.0+; check the linked Capacitor guide again before starting a release because its minimum tool versions can change.
- Open the native project with `npm exec -- cap open ios`, then select an iOS simulator or a paired physical iPhone in Xcode.
- For a physical-device run, configure an Apple development team and the matching bundle identifier under Xcode's Signing & Capabilities. Pair/register the device and let Xcode create or select a development provisioning profile.
- For TestFlight or App Store distribution, use an Apple Developer Program team with the required distribution signing assets and provisioning configuration. Archive and export through Xcode, then validate the exported build on a real device.

## Acceptance still required

Native completion requires a Mac/Xcode build, a simulator launch, and an owner-visible physical-device check covering startup, career selection, tactics/lineup, transfers, training, a full selected-club match viewer, and save/reload. Do not mark iOS runtime or release complete from the Windows web build or Capacitor sync alone.

## References

- [Capacitor iOS documentation](https://capacitorjs.com/docs/ios)
- [Capacitor environment setup](https://capacitorjs.com/docs/getting-started/environment-setup)
- [Apple: Run an app on a simulated or physical device](https://developer.apple.com/documentation/Xcode/running-your-app-on-simulated-or-physical-devices)
- [Apple: Prepare an app for distribution](https://developer.apple.com/documentation/xcode/preparing-your-app-for-distribution)
