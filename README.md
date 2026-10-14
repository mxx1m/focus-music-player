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
2. **Add file → Upload files**, then drag in the files themselves (not the folder).
3. **Settings → Pages**: Source `Deploy from a branch`, Branch `main`, Folder `/ (root)`, Save.
4. After a minute or two the app runs at `https://<your-name>.github.io/focus-player/`.

Check: `https://<your-name>.github.io/focus-player/manifest.webmanifest` should open directly. If it does, the paths are right.

## iPhone

1. Open the address in Safari, then **Share → Add to Home Screen**.
2. Start it from the Home Screen icon and add your tracks there. The Home Screen app keeps its own storage, separate from Safari and from the Claude version, so its library starts empty.
3. In the tone panel, **When the screen locks** decides how the tone behaves:
   - **Keep playing:** survives a locked screen; the tone loops every 5 minutes with a short gap.
   - **Gapless:** no gaps, but the tone stops while the screen is locked or you are in another app.
4. Lock the screen during playback once to confirm music and tone continue.

## Mac

Open the address in Safari or Chrome. The tone is generated live, so there are no gaps. In Safari you can also use **File → Add to Dock** to get it as its own app.

## Updating

Replace `index.html` in the repository. The app loads the new version on its next launch and falls back to the saved copy only when offline. After bigger changes, raise the number in the line `const CACHE = 'focus-player-v1'` in `sw.js`.

Your tracks survive updates: they are stored in the browser's database, not in the offline cache.
