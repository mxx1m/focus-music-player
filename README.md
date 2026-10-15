# Focus Player

Your own tracks layered with binaural or isochronic tones. Runs entirely in the browser; tracks never leave your device.

## Files

All at the repository root, not in a subfolder:

```
index.html
manifest.webmanifest
sw.js
icon-180.png
icon-192.png
icon-512.png
icon-512-maskable.png
README.md   (documentation only)
```

## Setup

1. Create a repository, for example `focus-player`.
2. **Add file > Upload files**, then drag in the files themselves (not the folder).
3. **Settings > Pages**: Source `Deploy from a branch`, Branch `main`, Folder `/ (root)`, Save.
4. After a minute or two the app runs at `https://<your-name>.github.io/focus-player/`.

Check: `https://<your-name>.github.io/focus-player/manifest.webmanifest` should open directly. If it does, the paths are right.

## Using it

- **With music / Tone only:** the switch under the title. Tone only plays the tone without a track; picking a track in the Library turns music back on and continues where it left off.
- **Focus timer:** Off, 25, 50 or 90 minutes. It counts down while playing, pauses with playback, and fades everything out over the last 10 seconds.
- **Lock screen, Control Center, media keys, headphones:** play and pause always apply to music and tone together.
- **Hearing safety:** the tone peaks at -12 dB below full scale, is turned down automatically above a 150 Hz carrier, fades in over 2 seconds and fades out on pause.

## iPhone

1. Open the address in Safari, then **Share > Add to Home Screen**.
2. Start it from the Home Screen icon and add your tracks there. The Home Screen app keeps its own storage, separate from Safari and from the Claude version.
3. The side buttons set the music volume (iOS doesn't let web apps change it). The Tone slider sets the tone relative to the music.
4. For a system-wide limit: **Settings > Sounds & Haptics > Headphone Safety > Reduce Loud Audio**.

## Mac

Open the address in Safari or Chrome. In Safari you can also use **File > Add to Dock** to get it as its own app.

## Updating

Replace `index.html` (and `sw.js` when it changes) in the repository. The app loads the new version on its next launch; on a weak signal it opens the saved copy after 3 seconds and picks up the new version on a later launch. After bigger changes, raise the number in the line `const CACHE = 'focus-player-v2'` in `sw.js`.

Your tracks and settings survive updates: they are stored in the browser's database, not in the offline cache.
