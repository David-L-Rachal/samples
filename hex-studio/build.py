#!/usr/bin/env python3
"""Build the standalone Hex Studio page using only Python standard libraries."""
from pathlib import Path
import re

root = Path(__file__).resolve().parent
css = (root / 'styles/background.css').read_text() + '\n' + (root / 'styles/glass.css').read_text()
html = '''<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="dark light">
<title>Hex Studio · Free Animated Background Generator</title>
<meta name="description" content="Create an animated honeycomb background. Choose a color profile, customize your palette, and download a ready-to-use background for your website.">
<style>__CSS__</style>
<style>
body.hs-body {min-height:100vh;margin:0;padding:0 32px 90px}
.studio-header {max-width:1180px;margin:auto;padding:30px 0;display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid var(--hs-brd-soft)}
.studio-brand {display:flex;align-items:center;gap:10px;font-size:15px;font-weight:700;letter-spacing:.1em;color:var(--hs-text)}
.studio-brand svg {width:26px;height:29px;stroke:var(--hs-blue-lt);fill:none;stroke-width:1.6}
.studio-header small {color:var(--hs-text-dim);font-size:11px;letter-spacing:.14em;text-transform:uppercase}
.studio {max-width:980px;margin:68px auto 0}
.eyebrow {display:flex;align-items:center;gap:10px;text-transform:uppercase;letter-spacing:.18em;color:var(--hs-text-dim);font-size:11px;font-weight:600}
.eyebrow:before {content:"";height:1px;width:26px;background:var(--hs-blue-lt)}
h1 {font-size:clamp(38px,5vw,64px);line-height:1.07;letter-spacing:-.055em;margin:20px 0;color:var(--hs-text);font-weight:650}
.intro {font-size:15px;line-height:1.8;color:var(--hs-text-dim);max-width:510px;margin:0}
.studio-grid {display:grid;grid-template-columns:1.3fr 1fr;gap:32px;margin-top:40px;align-items:stretch}
.profile-grid {display:grid;gap:12px}
.profile-card {display:flex;align-items:center;gap:18px;width:100%;text-align:left;padding:21px 22px;background:var(--hs-tint);border:1px solid var(--hs-brd-soft);border-radius:16px;color:var(--hs-text);cursor:pointer;font:inherit;backdrop-filter:blur(16px)}
.profile-card[aria-pressed=true] {border-color:var(--hs-blue-lt);box-shadow:0 0 0 1px var(--hs-blue-lt)}
.profile-card:focus-visible {outline:2px solid var(--hs-blue-lt);outline-offset:4px}
.profile-preview {width:76px;height:62px;border:1px solid #ffffff2a;border-radius:10px;display:flex;align-items:center;justify-content:center;flex-shrink:0;overflow:hidden}
.profile-preview svg {width:84px;height:65px;fill:none;stroke-width:1.4}
.profile-card b {display:block;font-size:14px;font-weight:600;margin-bottom:5px}
.profile-card small {display:block;font-size:11px;color:var(--hs-text-dim)}
.selected-dot {margin-left:auto;width:7px;height:7px;border-radius:50%;border:1px solid var(--hs-text-faint);flex-shrink:0}
.profile-card[aria-pressed=true] .selected-dot {background:var(--hs-blue-lt);border-color:var(--hs-blue-lt);box-shadow:0 0 14px var(--hs-blue-glow)}
.sample {padding:26px!important;display:flex;flex-direction:column;justify-content:space-between}
.sample-tag {font-size:10px;letter-spacing:.15em;color:var(--hs-text-faint);text-transform:uppercase;margin:0 0 20px}
.sample h2 {font-size:22px;letter-spacing:-.03em;line-height:1.3;margin:0 0 8px;color:var(--hs-text)}
.sample p {font-size:12px;line-height:1.7;color:var(--hs-text-dim);margin:0 0 22px}
.sample-foot {display:flex;align-items:center;justify-content:space-between;gap:12px;padding-top:18px;border-top:1px solid var(--hs-brd-soft);color:var(--hs-text-faint);font-size:10px}
.palette-line {display:flex;gap:5px}
.palette-line i {width:14px;height:14px;border-radius:50%;border:1px solid var(--hs-brd)}
.studio-note {margin:24px 0 0;font-size:11px;color:var(--hs-text-faint);line-height:1.7}
.download-panel {margin-top:24px;padding:24px!important}
.download-panel h2 {margin:0 0 7px;color:var(--hs-text);font-size:19px;letter-spacing:-.025em}
.download-panel p {margin:0;color:var(--hs-text-dim);font-size:12px;line-height:1.8}
.download-actions {display:flex;flex-wrap:wrap;gap:10px;margin:18px 0}
.download-actions .hs-btn {min-height:44px;font-size:12px}
.embed-usage {padding:14px 16px;border:1px solid var(--hs-brd-soft);background:var(--hs-glass-2);border-radius:10px;overflow:auto;color:var(--hs-text-dim);font-size:11px;line-height:1.7}
.embed-usage code {display:block;margin-top:5px;color:var(--hs-text);font:12px/1.7 ui-monospace,SFMono-Regular,Consolas,monospace;white-space:nowrap}
.download-panel .file-status {min-height:20px;margin-top:10px;font-size:11px;color:var(--hs-text-dim)}
@media(max-width:720px) {.studio-grid {grid-template-columns:1fr;gap:20px}.studio {margin-top:38px}.sample {min-height:250px}.studio-header small {display:none}body.hs-body {padding:0 18px 90px}.studio-header {padding:22px 0}.profile-card {padding:15px}.intro {font-size:14px}}
@media(max-width:420px) {.download-actions {flex-direction:column}.download-actions .hs-btn {width:100%}.download-panel {padding:19px!important}}
</style>
</head>
<body class="hs-body">
<header class="studio-header">
 <div class="studio-brand"><svg viewBox="0 0 28 32" aria-hidden="true"><path d="M14 2 26 9v14l-12 7L2 23V9Z"/><path d="m2 9 12 7 12-7M14 16v14"/></svg> HEX STUDIO</div>
 <small>Free animated background generator</small>
</header>
<main class="studio">
 <div class="eyebrow">Free animated background generator</div>
 <h1>Your space,<br>your palette.</h1>
 <p class="intro">Choose a profile, make the colors yours, and download an animated honeycomb background for your website.</p>
 <div class="studio-grid">
  <div class="profile-grid" role="group" aria-label="Choose a color profile">
   <button type="button" class="profile-card" data-profile="original" aria-pressed="true">
    <span class="profile-preview" style="background:radial-gradient(ellipse at center,#0d3050,#010a12)"><svg viewBox="0 0 100 70"><path stroke="#6ec4ff" d="m16 10 16 9v18l-16 9L0 37V19Zm33 19 16 9v18l-16 9-16-9V38Z"/><path stroke="#3ddc84" d="m49-9 16 9v18l-16 9-16-9V0Z"/><path stroke="#ff5a60" d="m82 10 16 9v18l-16 9-16-9V19Z"/></svg></span>
    <span><b>Classic</b><small>Navy · Blue · Green · Red</small></span><span class="selected-dot"></span>
   </button>
   <button type="button" class="profile-card" data-profile="carbon" aria-pressed="false">
    <span class="profile-preview" style="background:radial-gradient(ellipse at center,#343434,#050505)"><svg viewBox="0 0 100 70"><path stroke="#c9c9c9" d="m16 10 16 9v18l-16 9L0 37V19Zm33 19 16 9v18l-16 9-16-9V38Z"/><path stroke="#f5f5f5" d="m49-9 16 9v18l-16 9-16-9V0Z"/><path stroke="#ff4545" d="m82 10 16 9v18l-16 9-16-9V19Z"/></svg></span>
    <span><b>Carbon</b><small>Black · Red · Silver</small></span><span class="selected-dot"></span>
   </button>
   <button type="button" class="profile-card" data-profile="nimbus" aria-pressed="false">
    <span class="profile-preview" style="background:linear-gradient(#ffffff,#dce8f1)"><svg viewBox="0 0 100 70"><path stroke="#78cafa" d="m16 10 16 9v18l-16 9L0 37V19Zm33 19 16 9v18l-16 9-16-9V38Z"/><path stroke="#ffffff" d="m49-9 16 9v18l-16 9-16-9V0Z"/><path stroke="#aebecd" d="m82 10 16 9v18l-16 9-16-9V19Z"/></svg></span>
    <span><b>Nimbus</b><small>Ice Blue · White · Silver</small></span><span class="selected-dot"></span>
   </button>
  </div>
  <section class="hs-panel sample" aria-label="Example app panel">
   <div>
    <div class="sample-tag">Live interface preview</div>
    <div class="hs-rule" style="margin-bottom:20px"></div>
    <h2 id="active-name">Classic</h2>
    <p>Softly drifting hexagons, ambient pulses, and a glow that follows your cursor.</p>
    <button type="button" class="hs-btn hs-btn-primary" id="customize">Customize colors <span aria-hidden="true">↗</span></button>
   </div>
   <div class="sample-foot"><span id="appearance">DARK APPEARANCE</span><div class="palette-line" aria-hidden="true"><i></i><i></i><i></i></div></div>
  </section>
 </div>
 <section class="hs-panel download-panel" aria-labelledby="download-title">
  <h2 id="download-title">Take your palette with you.</h2>
  <p>Download a ready-to-use background, or save a profile to keep editing later.</p>
  <div class="download-actions">
   <button type="button" class="hs-btn hs-btn-primary" id="download-background">Download background (.js)</button>
   <button type="button" class="hs-btn" id="export-profile">Export profile (.json)</button>
   <button type="button" class="hs-btn" id="import-profile">Import profile</button>
   <input type="file" id="profile-file" accept=".json,application/json" aria-label="Choose a profile JSON file" hidden>
  </div>
  <div class="embed-usage">Upload the downloaded file beside your page, then add this before &lt;/body&gt;:
   <code>&lt;script src="hex-background.js"&gt;&lt;/script&gt;</code>
  </div>
  <p class="file-status" id="file-status" role="status" aria-live="polite"></p>
 </section>
 <p class="studio-note">No account needed. Profiles stay in your browser until you export them. Files are generated on your device.<br>Move your cursor over the background to see the glow.</p>
</main>
__BACKGROUND_SCRIPT__
<script>
(function () {
 var colors = {original:['#6ec4ff','#3ddc84','#ff5a60'],carbon:['#c9c9c9','#ff4545','#f5f5f5'],nimbus:['#78cafa','#f8fcff','#aebecd']};
 function sync() {
  var profile = HexStudio.getProfile();
  document.querySelectorAll('[data-profile]').forEach(function(button) { button.setAttribute('aria-pressed', String(button.dataset.profile === profile.theme)); });
  var theme = HexStudio.getThemes().find(function (theme) { return theme.id === profile.theme; });
  document.getElementById('active-name').textContent = theme ? theme.label.split(' / ')[0] : 'Your custom profile';
  document.getElementById('appearance').textContent = profile.mode.toUpperCase() + ' APPEARANCE';
  document.querySelectorAll('.palette-line i').forEach(function (dot, i) { dot.style.background = (profile.colors || colors[profile.theme])[i]; });
 }
 document.querySelectorAll('[data-profile]').forEach(function (button) { button.addEventListener('click', function () { HexStudio.setTheme(button.dataset.profile); }); });
 document.getElementById('customize').addEventListener('click', function () { HexStudio.openPicker(); });
 var fileStatus = document.getElementById('file-status');
 var fileInput = document.getElementById('profile-file');
 document.getElementById('export-profile').addEventListener('click', function () {
  try { HexStudio.downloadProfile(); fileStatus.textContent = 'Profile file prepared. Check your browser downloads.'; }
  catch (error) { fileStatus.textContent = 'Could not export the profile. Please try again.'; }
 });
 document.getElementById('download-background').addEventListener('click', function () {
  try { HexStudio.downloadBackground(); fileStatus.textContent = 'Background file prepared. Upload it and add the script shown below.'; }
  catch (error) { fileStatus.textContent = 'Could not download the background. Please try again.'; }
 });
 document.getElementById('import-profile').addEventListener('click', function () { fileInput.value = ''; fileInput.click(); });
 fileInput.addEventListener('change', function () {
  var file = fileInput.files && fileInput.files[0];
  if (!file) return;
  if (file.size > 65536) { fileStatus.textContent = 'Choose an Hex Studio profile JSON file smaller than 64 KB.'; return; }
  var reader = new FileReader();
  reader.onload = function () {
   try { HexStudio.importProfile(reader.result); fileStatus.textContent = 'Profile imported. You can keep editing or download your background.'; }
   catch (error) { fileStatus.textContent = 'That file is not a valid Hex Studio profile. Your current palette is unchanged.'; }
  };
  reader.onerror = function () { fileStatus.textContent = 'The profile file could not be read. Please try again.'; };
  reader.readAsText(file);
 });
 window.addEventListener('hexstudio:change', sync); sync();
})();
</script>
</body></html>
'''
html = html.replace('__CSS__', css)
attributes = 'data-mode="dark" data-frame="0" data-stripe="1" data-storage-key="hexstudio.preview.v1"'
external_script = '<script src="hex-studio.js" ' + attributes + '></script>'
(root / 'preview.html').write_text(html.replace('__BACKGROUND_SCRIPT__', external_script), encoding='utf-8')

# Escape script end tags inside JavaScript strings/comments before embedding.
# Everything needed by index.html is inline, including the CSS and icons.
js = (root / 'hex-studio.js').read_text(encoding='utf-8')
safe_js = re.sub(r'</script', lambda match: '<\\/script', js, flags=re.IGNORECASE)
inline_script = '<script ' + attributes + '>\n' + safe_js + '\n</script>'
(root / 'index.html').write_text(html.replace('__BACKGROUND_SCRIPT__', inline_script), encoding='utf-8')
