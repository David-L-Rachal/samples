# Hex Studio

A free, browser-based animated honeycomb background generator. Pick Classic,
Carbon, or Nimbus, customize the background and three hex colors, and download
a background script for your website.

- Live color preview, cursor glow, drifting hexagons, and ambient pulses.
- Set hex size, movement speed, and cloud, lightning, or water effects.
- Export colors and motion settings as JSON and import them later, including
  on another device.
- Download a configured `hex-background.js` with its styles included.
- Local browser preferences, reduced-motion support, and hidden-tab pausing.
- No accounts, external libraries, database, or build dependencies.

## Use or host the tool

Open `index.html` in a browser, or upload it to a folder on your website.
It includes the styles, icons, and JavaScript in one file.

To preview over HTTP:

```sh
python3 -m http.server 8080
```

Then open `http://localhost:8080/`.

Select **Customize colors** or **Theme** to edit the palette. Use **Export
profile (.json)** to save a combination and **Import profile** to load it again.
Files are generated and read on your device.

The **Movement & atmosphere** section exposes the same live settings on the
main page:

- **Hex size** sets the cell radius from 12 to 160 pixels.
- **Movement speed** ranges from 0× to 3×; 0× pauses animation.
- **Cloud haze** moves softly behind the honeycomb.
- **Lightning pulse** softly blooms and fades through a branching blue-white
  glow. Its slow, smooth pulse has no sharp flashes or re-strikes.
- **Water ripples** keeps the grid anchored and ripples its contours.
- **None** leaves the honeycomb's ambient pulses and cursor glow.

System reduced-motion preferences pause animation, and motion stops while
the tab is hidden. The page shows when the system setting pauses motion.
Exported profiles and downloaded backgrounds retain the chosen size, speed,
and effect along with the palette.

## Use a downloaded background

Upload the generated `hex-background.js` alongside your page, then add this
before `</body>`:

```html
<script src="hex-background.js"></script>
```

Adjust the path if you put the file in another folder. Opaque page sections
cover the background; leave some transparent space to make it visible.

The generated script keeps the chosen palette, size, speed, and atmosphere
effect. It does not display the editor or load preferences from browser storage.

## Edit and rebuild

`hex-studio.js` contains the renderer, palette editor, and file export/import.
`styles/` contains the page's background and interface styles. `build.py`
contains the page template and generates the standalone page plus a development
preview that loads `hex-studio.js` separately.

```sh
python3 build.py
node tests/hex-studio.test.cjs
```

Python and Node use their standard libraries only. Run the build after editing
the source so the standalone `index.html` includes your changes.

The checks cover saved palettes, file round trips and validation, keyboard
controls, the Customize click sequence, motion lifecycle, and generated scripts.

## JavaScript API

The editor exposes `window.HexStudio`:

```js
HexStudio.setTheme('carbon');
HexStudio.setTheme('nimbus', {mode: 'dark'});
HexStudio.setColors({
  background: '#08121f',
  colors: ['#a8dfff', '#ffffff', '#bac8d6']
});
HexStudio.setSize(56);        // Cell radius in pixels, 12–160.
HexStudio.setSpeed(0.6);      // 0–3; 0 pauses animation.
HexStudio.setEffect('water'); // 'clouds', 'lightning', 'water', or 'none'.
HexStudio.getProfile();      // Includes size, speed, and effect.
HexStudio.downloadProfile();
HexStudio.importProfile(savedJson);
HexStudio.downloadBackground();
```

Listen for `hexstudio:change` on `window` to receive the active profile in
`event.detail`.
