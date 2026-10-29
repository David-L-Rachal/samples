# Hex Studio

A free, browser-based animated honeycomb background generator. Pick Classic,
Carbon, or Nimbus, customize the background and three hex colors, and download
a background script for your website.

- Live color preview, cursor glow, drifting hexagons, and ambient pulses.
- Export a palette as JSON and import it later, including on another device.
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

## Use a downloaded background

Upload the generated `hex-background.js` alongside your page, then add this
before `</body>`:

```html
<script src="hex-background.js"></script>
```

Adjust the path if you put the file in another folder. Opaque page sections
cover the background; leave some transparent space to make it visible.

The generated script keeps the chosen palette and does not display the editor
or load preferences from browser storage.

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
HexStudio.downloadProfile();
HexStudio.importProfile(savedJson);
HexStudio.downloadBackground();
```

Listen for `hexstudio:change` on `window` to receive the active profile in
`event.detail`.
