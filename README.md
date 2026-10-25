# Focus Player

Focus music with binaural or isochronic tones, and your podcasts. Runs entirely in the browser; your files never leave your device.

## Files

All at the repository root, not in a subfolder:

```
index.html
styles.css
app.js
db.js
tone.js
reorder.js
sw.js
manifest.webmanifest
icon-180.png
icon-192.png
icon-512.png
icon-512-maskable.png
README.md   (documentation only)
```

## Tabs

- **Focus:** your focus music with the tone generator and focus timer. Tap the track title to pick a track from your library.
  - The button right of "next" sets what happens at the end of a group: **Loop the group**, **Continue to the next group** (in your library order, wrapping around), or **Loop this track** (shows a small "1").
  - Shuffle mixes the order within the current group.
  - **With music / Tone only** switches the music off and on; the track continues where it left off.
- **Podcasts:** one episode at a time. Tap the title to pick an episode.
  - Each episode remembers where you stopped. At its end it stops and is marked played; playing it again starts from the beginning.
  - Skip back 15 s and forward 30 s (also on the lock screen), speed 0.8× to 2×, and a sleep timer.
- **Library:** your files in two sections, Music and Podcasts.

Only one thing plays at a time: starting a podcast pauses the focus session, and the other way round. Both remember their place.

## Library

- Files are grouped by label. Files without a label are in **Ungrouped**.
- Tap a group's name to fold it. Tap **+** on a group to add files straight into it.
- **Edit** mode:
  - Drag **≡** to reorder groups and files. Drop a file on another group to give it that label.
  - Rename a label by editing its name. Deleting a label moves its files to Ungrouped.
  - Tap files to select them, then **Label**, **Move to Podcasts / Music**, **Mark played** (podcasts) or **Delete**.
  - **New label** creates an empty group you can fill later.

## Setup (first time)

1. Create a repository, for example `focus-player`.
2. **Add file > Upload files**, then drag in the files themselves (not the folder).
3. **Settings > Pages**: Source `Deploy from a branch`, Branch `main`, Folder `/ (root)`, Save.
4. After a minute or two the app runs at `https://<your-name>.github.io/focus-player/`.

## Updating

Upload the changed files; files with the same name are replaced. The app loads the new version on its next launch. On a weak signal it opens the saved copy after 3 seconds and picks up the new version on a later launch. After bigger changes, raise the number in the line `const CACHE = 'focus-player-v3'` in `sw.js`.

Your files, labels, order and podcast positions survive updates: they are stored in the browser's database, not in the offline cache.

## iPhone

- Open the address in Safari, then **Share > Add to Home Screen**. The Home Screen app keeps its own storage, separate from Safari.
- The side buttons set the volume (iOS doesn't let web apps change it). On Focus, the Tone slider sets the tone relative to the music.
- For a system-wide limit: **Settings > Sounds & Haptics > Headphone Safety > Reduce Loud Audio**.

## Mac

Open the address in Safari or Chrome. In Safari you can also use **File > Add to Dock** to get it as its own app.

## Hearing safety

The tone peaks at -12 dB below full scale, is turned down automatically above a 150 Hz carrier, fades in over 2 seconds and fades out on pause. Podcasts never get a tone.
