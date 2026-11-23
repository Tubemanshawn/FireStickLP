# FireStickLP: Retro TV for Fire TV Stick

Watch your Fire TV Stick on your Windows PC through an HDMI capture card, in a retro TV frame. It also works as a fast remote and tunes the Fire Stick over ADB, with **no root needed**.

Two apps, never open at the same time:
- **Retro TV (A1.0.0)**, in `RetroTV/`: the full app, covering the TV, remote, auto-debloat, RAM tools, skins and the mini window.
- **FireTvLp (B1.0.0)**, in `FireTvLp/`: just the screen and the remote. Debloat and RAM tools are moving to an iPhone app (in progress, `FireTvLp-iOS/`).

Built and tested on a Fire TV Stick 4K Max (AFTKRT), Fire OS 8.1.8.6.

## Features

**TV**
- Live picture and sound from any USB capture card. Picks the capture card's audio automatically and lets you choose the speakers.
- Retro looks: scanlines, CRT vignette, B&W, warm, plus TV **skins** (70s Wood, 80s Silver, 90s Black, Portable). Look settings are saved.
- **⧉ Pop out** mini window: always on top, same skin, scroll = volume, click = OK, right-click = Back, drag to move.
- Listen on/off and volume (wheel or Vol +/−). This changes the PC's sound, because the Fire Stick's HDMI volume is fixed.
- **🎥 Streamer mode** hides your Fire Stick's IP on screen.
- **📡 PC remote: OFF** leaves the Fire Stick alone (for testing the phone app) while the picture keeps working.

**Remote** (over ADB, about 10–50 ms per press)
- On-screen remote. Holding the arrows, volume or rewind/fast-forward repeats them.
- **Hold OK** sends a long-press, like the real remote (Move / Uninstall options).
- Mouse on the picture: click = OK (hold = long-press), right-click = Back, wheel = volume.
- Keyboard while the window is focused: arrows, Enter, Backspace/Esc, Space.
- **Remote Mode** (Ctrl+Alt+R from anywhere): your keyboard controls the Fire Stick even while another app is in front.
- Type into Fire TV search boxes from the PC. Symbols work.
- **⚙ Fire TV Settings** button.

**Fire Stick tuning**
- **Auto-debloat:** turns off the apps in `debloat-list.txt` every time the app connects, and again after every Fire Stick reboot. Apps Fire OS protects from being turned off are suspended and blocked from running in the background instead.
- **RAM:** limits cached apps to 8, turns animations off, and clears cached apps. The **System** tab shows RAM, swap, uptime and running apps, with a Stop button for apps you installed and a 🧹 Free RAM button.
- **Lighter home screen (optional):** replaces Amazon's home screen with [Projectivy Launcher](https://github.com/spocky/miproja1), using [Home on Fire](https://github.com/toolicious/home-on-fire) to redirect the Home button. A sweeper closes Amazon's home screen (about 150 MB) whenever it isn't on screen.

## What you need

- Windows 10 or 11
- A Fire TV Stick on the same network as your PC
- A USB HDMI capture card (only needed for the picture; the remote and tuning work without one)
- [Node.js](https://nodejs.org) (any recent version)
- Google's [Android Platform Tools](https://developer.android.com/tools/releases/platform-tools) (adb), unzipped into a `platform-tools` folder here. `scripts\FireStick-Scan-v2.bat` downloads them for you.

## Setup

1. **On the Fire Stick**
   1. Settings → My Fire TV → About → click your device name 7 times to unlock **Developer Options**.
   2. Settings → My Fire TV → Developer Options → turn on **ADB Debugging**.
   3. Note the IP address: Settings → My Fire TV → About → Network.
2. **On the PC**
   1. Download or clone this repo.
   2. Get adb: run `scripts\FireStick-Scan-v2.bat`, or unzip Platform Tools into `platform-tools\`.
   3. Run `RetroTV\Setup-and-Run.bat`. The first run installs Electron (1–2 minutes).
   4. On the TV, tick **Always allow from this computer** and press **OK**.
   5. In the app, type the Fire Stick's IP under **Fire Stick address** and press **Connect**.
3. Click the TV picture once to start the capture card.

**Standalone exe:** after the first run, run `npm run build` in `RetroTV` to make `RetroTV-app\Retro TV.exe`, and the same in `FireTvLp` to make `FireTvLp-app\FireTvLp.exe`. Each folder runs on its own (no Node needed); make a desktop shortcut to the exe. FireTvLp reuses the Electron that Retro TV's setup unpacked.

## iPhone app (FireTvLp for iPhone, in progress)

`FireTvLp-iOS/` is a phone app that replaces the Fire TV remote app: remote, RAM usage and debloat, over Wi-Fi ADB. iPhones can't run adb, so the app speaks the ADB protocol itself.

1. Every push that changes `FireTvLp-iOS/` builds it on GitHub (**Actions** tab → **Build iPhone app** → latest run → **Artifacts** → `FireTvLp-ipa`).
2. Unzip the download to get `FireTvLp.ipa` and install it with [Sideloadly](https://sideloadly.io) using your Apple ID. A free Apple ID needs a re-install every 7 days.
3. In the app: Setup → type the Fire Stick IP → Connect → on the TV tick **Always allow** and press **Allow**.

Set **📡 PC remote: OFF** in the PC app while using the phone.

## Debloat list

`debloat-list.txt` has one Android package name per line. The app and the scripts in `scripts\` share this list.

**Heads up:** the list in this repo turns off Alexa and the voice button, Amazon's telemetry, ads, promos and "experiments", placeholder apps, the Silk browser, Amazon Kids and the forced-update prompts. Fire OS updates are also blocked, because the updater gets suspended. Edit the list before your first run if you want to keep any of these.

Never add these packages, or things break: `com.amazon.firebat` (Prime Video), `com.amazon.tv.launcher`, `com.amazon.firehomestarter`, `com.amazon.tv.devicecontrol`, `com.amazon.tv.inputpreference.service`, `com.amazon.venezia` (Appstore), `com.amazon.device.messaging`, `com.amazon.whisperjoin.*`, `com.amazon.whisperlink.core.android`.

**To undo**, remove lines from the list, then run `scripts\FireStick-UNDO.bat`. It turns every app on the list back on and reboots the Fire Stick. `scripts\FireStick-RESTORE.bat` also reinstalls removed apps.

## Lighter home screen (optional)

1. Install **Projectivy Launcher** (Appstore or its official release) and **Home on Fire** ([releases](https://github.com/toolicious/home-on-fire/releases)). Then grant Home on Fire its permission:
   `adb shell pm grant io.github.toolicious.homeonfire android.permission.WRITE_SECURE_SETTINGS`
2. In Home on Fire: turn on **Accessibility service** and **Replace Home button**, and pick Projectivy as the target. In Projectivy, turn **Override current launcher** OFF.
3. In Retro TV: System tab → **Lighter home screen: ON**.

Long-press Home on the real remote to reach Amazon's home when you need it.

## Troubleshooting

| Problem | Fix |
|---|---|
| "… is already open. Close it first" | Retro TV and FireTvLp share the Fire Stick connection, so only one runs at a time. |
| Remote stops responding, adb commands hang | On the Fire Stick: Developer Options → turn ADB Debugging **off, wait 5 s, on**. Only run one copy of the app. |
| `npm start` fails, `electron.exe` missing | Run `Setup-and-Run.bat`. It unpacks Electron itself (newer Node versions break Electron's own installer). |
| Home on the real remote opens Amazon's home | Normal for 15 s after you use the PC remote. The remote helper pauses the redirect while in use. |
| Home redirect never works | Check `adb shell dumpsys accessibility`: "Bound services" should list Home on Fire. |
| First remote press after a while is slow | The remote helper sleeps after 2 minutes of disuse to save Fire Stick RAM. The first press wakes it. |

## How it works (for the curious)

- **Fast remote:** uses Android's built-in `monkey` in server mode. `input keyevent` takes about 0.9 s per press on Fire OS because it starts Java every time. Once a client connects, monkey opens a UI Automation link, and that disables all accessibility services, which kills the Home redirect. So the app keeps monkey running but unconnected, connects on a key press, and closes it after 15 s idle.
- **Cached-app limit:** on Android 11 it has to be set with `device_config put activity_manager max_cached_processes`. The global setting alone is ignored.
- **Code layout:** `RetroTV/main.js` handles the window and wiring; `RetroTV/src/` holds one file per job (adb, remote, device, debloat, ram, launcher, system, hotkeys, settings, state).

## Folder layout

```
debloat-list.txt     apps to turn off (shared by the app and scripts)
fire-ip.txt          your Fire Stick's IP (created by the app; not committed)
RetroTV/             Retro TV A (Electron)
  main.js, preload.js, renderer.html, renderer.js, pip.html/js, skins.css
  build.js           makes the standalone RetroTV-app\ folder
FireTvLp/            FireTvLp B: screen + remote only (Electron)
  src/               app logic, one file per job
  Setup-and-Run.bat  install + run
scripts/             standalone helpers: UNDO, RESTORE, State-Check, Memory-Check, Scan
platform-tools/      Google's adb (not included; download separately)
```

## Your Fire Stick's address

The app saves the address you enter and also writes it to `fire-ip.txt` in this folder. The helper scripts in `scripts\` read the IP from that file, or ask for it if the file is missing. `fire-ip.txt` is never committed.

## License

[MIT](LICENSE). Projectivy Launcher, Home on Fire and Google's Platform Tools are separate projects under their own licenses and are not included here.

## Version history

- **A1.0.0 update**: standalone exe, mini window with scroll volume, PC volume control, skins, saved look, streamer mode, PC remote on/off, one-app lock.
- **B1.0.0**: FireTvLp, screen + remote only.
- **1.0.0**: first release. TV view, fast remote with hold-OK long-press, auto-debloat, RAM tools, lighter home screen support, System tab.
- **Planned for 2.0**: deeper RAM trimming (target under 50% used).
