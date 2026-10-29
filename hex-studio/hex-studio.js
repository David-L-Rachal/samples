/* hex-studio.js — animated honeycomb with saved color profiles.
 * Self-contained palette controls and background exports; no external libraries.
 *
 * Presets: original, carbon (black/red/silver), nimbus (blue/white/silver).
 * A fixed Theme button lets visitors choose a preset or their own colors.
 * Preferences are local to this browser and shared across this site's pages.
 *
 * Existing options: data-mode="dark|light|off", data-frame="1|0",
 * data-stripe="1|0", data-motion="drift|still", data-size="42", ?nohex=1.
 * New options: data-theme="original|carbon|nimbus", data-controls="1|0",
 * data-remember="1|0", data-storage-key="hexstudio.profile.v1".
 * Saved choices take precedence over defaults when data-remember="1".
 *
 * API: HexStudio.setTheme('carbon'); HexStudio.setTheme('nimbus', {mode:'dark'});
 * HexStudio.setColors({background:'#08090c', colors:['#c9c9c9','#ff4545','#fff']});
 * HexStudio.getProfile(); HexStudio.setMotion('still'); HexStudio.reset();
 * HexStudio.openPicker(); HexStudio.closePicker(); HexStudio.getThemes();
 * HexStudio.downloadProfile(); HexStudio.importProfile(json); HexStudio.downloadBackground();
 * Dispatches hexstudio:change on window with the active profile in event.detail.
 */
(function hexStudioRuntime(embedded) {
    'use strict';

    if (window.HexStudio) return;
    var tag = document.currentScript;
    function opt(name, fallback) {
        var value = tag && tag.getAttribute('data-' + name);
        return value === null || value === '' || value === false ? fallback : value;
    }
    var initialMode = opt('mode', embedded && embedded.profile ? embedded.profile.mode : 'dark');
    if (initialMode === 'off' || new URLSearchParams(location.search).get('nohex') === '1') return;

    var root = document.documentElement;
    var remember = opt('remember', embedded ? '0' : '1') !== '0';
    var storageKey = opt('storage-key', 'hexstudio.profile.v1');
    var storageOK = true;
    var radius = Math.max(12, Math.min(160, parseFloat(opt('size', embedded && embedded.size || '42')) || 42));
    var media = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
    var themes = {
        original: {
            label: 'Classic', mode: 'dark',
            dark: {colors: ['#6ec4ff', '#3ddc84', '#ff5a60'], background: '#010a12', glow: '#0d3050', middle: '#061a2c', accent: '#185fa5', bright: '#3b8fd6'},
            light: {colors: ['#608cb9', '#4a9664', '#be5a5f'], background: '#e6edf5', glow: '#ffffff', middle: '#eef3f8', accent: '#185fa5', bright: '#185fa5'}
        },
        carbon: {
            label: 'Carbon / Red / Silver', mode: 'dark',
            dark: {colors: ['#c9c9c9', '#ff4545', '#f5f5f5'], background: '#050505', glow: '#343434', middle: '#161616', accent: '#c92128', bright: '#ff6669'},
            light: {colors: ['#8a929d', '#e22a2a', '#c9c9c9'], background: '#e4e4e6', glow: '#ffffff', middle: '#f2f2f4', accent: '#b21d25', bright: '#b21d25'}
        },
        nimbus: {
            label: 'Nimbus Blue / White / Silver', mode: 'light',
            dark: {colors: ['#78cafa', '#f8fcff', '#b8c7d6'], background: '#061321', glow: '#1b4664', middle: '#102b40', accent: '#2477ae', bright: '#a2dcff'},
            light: {colors: ['#78cafa', '#f8fcff', '#aebecd'], background: '#dce8f1', glow: '#ffffff', middle: '#edf7fd', accent: '#216995', bright: '#216995'}
        }
    };
    function clone(value) { return JSON.parse(JSON.stringify(value)); }
    function hex(value) {
        if (typeof value !== 'string') return null;
        if (/^#[0-9a-f]{3}$/i.test(value)) value = '#' + value.slice(1).split('').map(function (c) { return c + c; }).join('');
        return /^#[0-9a-f]{6}$/i.test(value) ? value.toLowerCase() : null;
    }
    function rgb(value) {
        return [parseInt(value.slice(1, 3), 16), parseInt(value.slice(3, 5), 16), parseInt(value.slice(5, 7), 16)];
    }
    function rgba(value, alpha) { return 'rgba(' + rgb(value).join(',') + ',' + alpha + ')'; }
    function luminance(value) {
        var v = rgb(value).map(function (c) { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); });
        return v[0] * 0.2126 + v[1] * 0.7152 + v[2] * 0.0722;
    }
    function validProfile(value) {
        if (!value || value.version !== 1 || ['dark', 'light'].indexOf(value.mode) < 0 || ['drift', 'still'].indexOf(value.motion) < 0) return null;
        if (value.theme === 'custom') {
            if (!hex(value.background) || !Array.isArray(value.colors) || value.colors.length !== 3 || !value.colors.every(hex)) return null;
            return {version: 1, theme: 'custom', mode: luminance(hex(value.background)) > 0.179 ? 'light' : 'dark', motion: value.motion, background: hex(value.background), colors: value.colors.map(hex)};
        }
        if (!Object.prototype.hasOwnProperty.call(themes, value.theme)) return null;
        return {version: 1, theme: value.theme, mode: value.mode, motion: value.motion};
    }
    var themeOption = opt('theme', 'original');
    if (!Object.prototype.hasOwnProperty.call(themes, themeOption)) themeOption = 'original';
    var defaults = {
        version: 1, theme: themeOption,
        mode: tag && tag.hasAttribute('data-mode') ? (initialMode === 'light' ? 'light' : 'dark') : themes[themeOption].mode,
        motion: opt('motion', 'drift') === 'still' ? 'still' : 'drift'
    };
    if (embedded && validProfile(embedded.profile)) defaults = validProfile(embedded.profile);
    var profile = clone(defaults);
    if (remember) {
        try { profile = validProfile(JSON.parse(window.localStorage.getItem(storageKey))) || profile; }
        catch (error) { storageOK = false; }
    }

    var spec, palette, canvas, context, vignette, stripe, picker, panel, toggle, status, fileStatus;
    var controls = {}, presetButtons = [], width = 0, height = 0, cells = [];
    var dx = radius * 1.5, dy = Math.sqrt(3) * radius, offset = 0;
    var mouseX = -9999, mouseY = -9999, raf = null, lastTime = null, pulseTime = 0;
    var started = false;

    function getSpec() {
        if (profile.theme !== 'custom') return clone(themes[profile.theme][profile.mode]);
        var light = profile.mode === 'light';
        return {colors: profile.colors.slice(), background: profile.background,
            glow: light ? profile.background : rgba(profile.colors[0], 0.16),
            middle: profile.background, accent: light ? '#245f83' : profile.colors[1],
            bright: light ? '#245f83' : profile.colors[0]};
    }
    function persist() {
        if (!remember) return;
        try { window.localStorage.setItem(storageKey, JSON.stringify(profile)); storageOK = true; }
        catch (error) { storageOK = false; }
    }
    function changed() {
        if (fileStatus) fileStatus.textContent = '';
        apply();
        persist();
        syncControls();
        window.dispatchEvent(new CustomEvent('hexstudio:change', {detail: clone(profile)}));
    }
    function apply() {
        spec = getSpec();
        palette = [spec.colors[0], spec.colors[0], spec.colors[0], spec.colors[1], spec.colors[2]].map(rgb);
        root.classList.add('hs-hex');
        root.classList.toggle('hs-hex-dark', profile.mode === 'dark');
        root.classList.toggle('hs-hex-light', profile.mode === 'light');
        root.setAttribute('data-hex-theme', profile.theme);
        var custom = profile.theme === 'custom';
        var background = custom
            ? 'radial-gradient(85% 75% at 50% 38%,' + spec.glow + ',transparent 80%),' + spec.background
            : profile.mode === 'light'
                ? 'linear-gradient(180deg,' + spec.glow + ' 0%,' + spec.middle + ' 55%,' + spec.background + ' 100%)'
                : 'radial-gradient(85% 75% at 50% 38%,' + spec.glow + ' 0%,' + spec.middle + ' 42%,' + spec.background + ' 80%)';
        root.style.setProperty('--hexstudio-background', background);
        root.style.setProperty('--hexstudio-vignette', 'radial-gradient(70% 70% at 50% 45%,transparent 30%,' + rgba(spec.background, profile.mode === 'light' ? 0.35 : 0.85) + ' 100%)');
        root.style.setProperty('--hexstudio-stripe', 'linear-gradient(90deg,' + spec.colors[1] + ',' + spec.colors[0] + ',' + spec.colors[2] + ')');
        root.style.setProperty('--hexstudio-accent', spec.bright);
        root.style.setProperty('--hexstudio-primary', spec.accent);
        root.style.setProperty('--hexstudio-button-text', luminance(spec.accent) > 0.179 ? '#08121c' : '#ffffff');
        // Existing glass surfaces/text follow the background. Status colors keep their meaning.
        var tokens = {};
        if (profile.theme !== 'original' || profile.mode === 'light') {
            var light = profile.mode === 'light', ink = light ? '#203c50' : '#edf4fa';
            tokens = {
                'blue': spec.accent, 'blue-lt': spec.bright, 'blue-glow': rgba(spec.accent, 0.18),
                'tint': light ? 'rgba(255,255,255,.86)' : rgba(spec.background, 0.76),
                'tint-2': light ? 'rgba(248,252,255,.85)' : rgba(spec.background, 0.6),
                'glass': light ? 'rgba(255,255,255,.72)' : 'rgba(255,255,255,.075)',
                'glass-2': light ? 'rgba(235,244,250,.7)' : 'rgba(255,255,255,.05)',
                'glass-hi': light ? 'rgba(217,234,245,.9)' : 'rgba(255,255,255,.12)',
                'brd': rgba(ink, light ? 0.2 : 0.16), 'brd-soft': rgba(ink, light ? 0.12 : 0.09),
                'text': ink, 'text-dim': rgba(ink, light ? 0.8 : 0.72), 'text-faint': rgba(ink, light ? 0.67 : 0.5),
                'shadow': light ? '0 24px 70px rgba(38,78,108,.14)' : '0 30px 70px rgba(0,0,0,.55)',
                'shadow-sm': light ? '0 10px 26px rgba(38,78,108,.12)' : '0 12px 30px rgba(0,0,0,.4)'
            };
        }
        ['blue','blue-lt','blue-glow','tint','tint-2','glass','glass-2','glass-hi','brd','brd-soft','text','text-dim','text-faint','shadow','shadow-sm'].forEach(function (key) {
            if (tokens[key]) root.style.setProperty('--hs-' + key, tokens[key]);
            else root.style.removeProperty('--hs-' + key);
        });
        root.classList.toggle('hs-hex-still', !moving());
        for (var i = 0; i < cells.length; i++) cells[i].color = palette[cells[i].colorIndex];
        if (started) { draw(0); animate(); syncControls(); }
    }

    function injectStyles() {
        var style = document.createElement('style');
        if (tag && tag.nonce) style.nonce = tag.nonce;
        style.setAttribute('data-hexstudio-styles', '');
        style.textContent = `
html.hs-hex {min-height:100%}
html.hs-hex body {background:transparent!important}
.hs-hexbg,.hs-hexvig {position:fixed;inset:0;width:100%;height:100%;z-index:-1;pointer-events:none}
html.hs-hex {background:var(--hexstudio-background) fixed}
html.hs-hex .hs-hexvig {background:var(--hexstudio-vignette)}
html.hs-hex .hs-hexstripe {position:fixed;left:0;right:0;top:0;height:3px;z-index:1030;background:var(--hexstudio-stripe);background-size:200% 100%;animation:hs-hex-slide 8s linear infinite}
@keyframes hs-hex-slide {to{background-position:200% 0}}
html.hs-hex-still .hs-hexstripe {animation:none}
html.hs-hex-light body.hs-body {color-scheme:light}
html.hs-hex-light .hs-panel {background-image:none}
html.hs-hex-light .hs-side {background:var(--hs-tint)}
html.hs-hex-light .hs-side-item.is-active {background:var(--hs-blue-glow);color:var(--hs-blue)}
html.hs-hex-light .hs-side-item::after {background:var(--hs-tint)}
html.hs-hex-light .hs-select option {background:#f2f7fb;color:var(--hs-text)}
html.hs-hex-light .hs-field > input:-webkit-autofill { -webkit-text-fill-color:var(--hs-text);box-shadow:0 0 0 1000px #edf5fb inset}
html.hs-hex-light .hs-check input {border-color:var(--hs-brd)}
html.hs-hex-light .hs-alert-err,html.hs-hex-light .hs-pill-bad {color:#a61b28}
html.hs-hex-light .hs-alert-ok,html.hs-hex-light .hs-pill-ok {color:#17663c}
html.hs-hex-light .hs-alert-info,html.hs-hex-light .hs-pill-info {color:#215f91}
html.hs-hex-light .hs-pill-warn {color:#795012}
html.hs-hex .hs-rule {background:var(--hexstudio-stripe)}
html.hs-hex:not([data-hex-theme="original"]) .hs-btn-primary,html.hs-hex-light .hs-btn-primary {background:var(--hexstudio-primary);color:var(--hexstudio-button-text);box-shadow:0 10px 26px var(--hs-blue-glow)}
.hexstudio-picker,.hexstudio-picker * {box-sizing:border-box}
.hexstudio-picker {position:fixed;right:max(18px,env(safe-area-inset-right));bottom:max(18px,env(safe-area-inset-bottom));z-index:1040;font:14px/1.5 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#ecf1f8;color-scheme:dark;letter-spacing:normal;text-align:left}
.hexstudio-picker button,.hexstudio-picker input {font:inherit}
.hexstudio-picker button {cursor:pointer}
.hexstudio-picker button:focus-visible,.hexstudio-picker input:focus-visible {outline:2px solid #9bd8ff;outline-offset:3px}
.hexstudio-toggle {display:flex;align-items:center;gap:9px;margin-left:auto;min-height:44px;border:1px solid #465363;border-radius:999px;padding:10px 16px;color:#f4f7fb;background:#14202e;box-shadow:0 6px 24px #0003}
.hexstudio-toggle svg {width:18px;height:18px;fill:none;stroke:currentColor;stroke-width:1.5}
.hexstudio-panel {position:absolute;right:0;bottom:58px;width:330px;max-width:calc(100vw - 24px);max-height:calc(100dvh - 100px);overflow-y:auto;overscroll-behavior:contain;border:1px solid #465363;border-radius:20px;background:#101a28;box-shadow:0 18px 70px #0006;padding:20px}
.hexstudio-panel[hidden] {display:none!important}
.hexstudio-head {display:flex;justify-content:space-between;align-items:center;gap:12px;margin-bottom:3px}
.hexstudio-head h2 {font-size:17px;font-weight:650;color:#f4f7fb;margin:0}
.hexstudio-close {display:grid;place-items:center;width:32px;height:32px;border:0;border-radius:8px;background:#ffffff0a;color:#dce6f2;font-size:22px!important}
.hexstudio-help {margin:0 0 16px;font-size:12px;color:#a6b5c8}
.hexstudio-presets {display:grid;gap:8px}
.hexstudio-preset {display:flex;align-items:center;gap:12px;width:100%;min-height:52px;padding:11px 12px;border:1px solid #344255;border-radius:12px;text-align:left;background:#172334;color:#e7eef7;font-size:12px!important}
.hexstudio-preset[aria-pressed="true"] {border-color:#a2dcff;background:#20364c;box-shadow:inset 0 0 0 1px #a2dcff}
.hexstudio-swatches {display:flex;flex-shrink:0}
.hexstudio-swatch {width:15px;height:15px;border-radius:50%;border:1px solid #ffffff3d;box-shadow:0 0 0 2px #172334}
.hexstudio-swatch+.hexstudio-swatch {margin-left:-3px}
.hexstudio-custom {border:0;border-top:1px solid #344255;padding:15px 0 0;margin:18px 0 0;min-width:0}
.hexstudio-custom legend {padding:0 8px 0 0;color:#a6b5c8;font-size:11px;font-weight:650;letter-spacing:.08em;text-transform:uppercase}
.hexstudio-colors {display:grid;grid-template-columns:repeat(4,1fr);gap:8px}
.hexstudio-color {display:flex;flex-direction:column;gap:7px;color:#becbdb;font-size:10px;text-align:center}
.hexstudio-color input {display:block;width:100%;height:34px;padding:2px;border:1px solid #465363;border-radius:8px;background:#172334;cursor:pointer}
.hexstudio-motion {display:flex;align-items:center;gap:9px;margin:17px 0 0;font-size:12px;color:#d4dfec}
.hexstudio-motion input {width:16px;height:16px;margin:0;accent-color:#8acfff}
.hexstudio-status {margin:13px 0 0;font-size:11px;color:#a6b5c8;min-height:17px}
.hexstudio-files {display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:16px}
.hexstudio-filebtn {min-height:40px;border:1px solid #465363;border-radius:10px;padding:8px;background:#1c2d40;color:#e7eef7;font-size:11px!important}
.hexstudio-background {grid-column:1/-1;background:#c5e7fc;color:#112a3f;border-color:#c5e7fc;font-weight:650!important}
.hexstudio-file-status {font-size:11px;color:#c0d6ef;line-height:1.5;margin:8px 0 0;overflow-wrap:anywhere}
.hexstudio-file-status:empty {display:none}
.hexstudio-reset {border:0;border-bottom:1px solid #62758e;background:none;color:#c0d6ef;padding:0;margin-top:8px;font-size:11px!important}
@media(max-width:420px) {.hexstudio-picker {right:12px;bottom:max(12px,env(safe-area-inset-bottom))}.hexstudio-panel {width:310px;padding:16px}}
@media(prefers-reduced-motion:reduce) {html.hs-hex .hs-hexstripe {animation:none}}
@media print {.hexstudio-picker,html.hs-hex .hs-hexstripe {display:none!important}}
`;
        (document.head || root).appendChild(style);
    }
    function moving() { return profile.motion !== 'still' && !(media && media.matches); }
    function hexPath(x, y) {
        context.beginPath();
        for (var i = 0; i < 6; i++) {
            var angle = Math.PI / 3 * i;
            var px = x + (radius - 3) * Math.cos(angle), py = y + (radius - 3) * Math.sin(angle);
            if (i) context.lineTo(px, py); else context.moveTo(px, py);
        }
        context.closePath();
    }
    function build() {
        if (!context) return;
        var dpr = Math.min(window.devicePixelRatio || 1, 2);
        width = window.innerWidth; height = window.innerHeight;
        canvas.width = Math.round(width * dpr); canvas.height = Math.round(height * dpr);
        context.setTransform(dpr, 0, 0, dpr, 0, 0);
        cells = [];
        var cols = Math.ceil(width / dx) + 3, rows = Math.ceil(height / dy) + 3;
        for (var c = -1; c < cols; c++) {
            for (var r = -1; r < rows; r++) {
                var index = (Math.random() * palette.length) | 0;
                cells.push({x: c * dx, y: r * dy + (c % 2 ? dy / 2 : 0), lit: 0, colorIndex: index, color: palette[index]});
            }
        }
        draw(0);
    }
    function draw(elapsed) {
        if (!context) return;
        context.clearRect(0, 0, width, height);
        context.lineWidth = 1;
        var dark = profile.mode === 'dark', active = moving();
        for (var i = 0; i < cells.length; i++) {
            var cell = cells[i], y = cell.y - offset, x = cell.x;
            if (y < -dy || y > height + dy) continue;
            var distance = Math.hypot(x - mouseX, y - mouseY);
            var near = active && distance < 190 ? 1 - distance / 190 : 0;
            var lit = active ? cell.lit : 0;
            var alpha = (dark ? 0.10 : 0.16) + near * (dark ? 0.50 : 0.34) + lit * (dark ? 0.60 : 0.30);
            context.strokeStyle = 'rgba(' + cell.color.join(',') + ',' + Math.min(1, alpha).toFixed(3) + ')';
            hexPath(x, y); context.stroke();
            if (lit > 0.02 || near > 0.35) {
                var fill = lit * (dark ? 0.10 : 0.05) + near * (dark ? 0.06 : 0.03);
                context.fillStyle = 'rgba(' + cell.color.join(',') + ',' + fill.toFixed(3) + ')'; context.fill();
            }
            cell.lit = Math.max(0, cell.lit - elapsed * 0.00072);
        }
    }
    function tick(time) {
        raf = null;
        if (!moving() || document.hidden || !context) return;
        var elapsed = lastTime === null ? 0 : Math.min(time - lastTime, 50);
        lastTime = time;
        offset = (offset + elapsed * 0.0084) % dy;
        pulseTime += elapsed;
        if (pulseTime >= 280) {
            pulseTime %= 280;
            for (var i = 0; i < 4; i++) {
                var cell = cells[(Math.random() * cells.length) | 0];
                if (cell && cell.lit <= 0) cell.lit = 1;
            }
        }
        draw(elapsed);
        raf = window.requestAnimationFrame(tick);
    }
    function animate() {
        if (raf !== null) window.cancelAnimationFrame(raf);
        raf = null; lastTime = null;
        root.classList.toggle('hs-hex-still', !moving());
        if (moving() && !document.hidden && context) raf = window.requestAnimationFrame(tick);
    }
    function element(name, className, text) {
        var el = document.createElement(name);
        if (className) el.className = className;
        if (text) el.textContent = text;
        return el;
    }
    function button(className, text) {
        var el = element('button', className, text); el.type = 'button'; return el;
    }
    function showPicker(show, focus) {
        if (!panel) return;
        panel.hidden = !show;
        toggle.setAttribute('aria-expanded', String(show));
        if (focus) (show ? presetButtons[0] : toggle).focus({preventScroll: true});
    }
    function createPicker() {
        picker = element('div', 'hexstudio-picker');
        toggle = button('hexstudio-toggle');
        // Static icon markup only; all profile/user values use DOM properties.
        toggle.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 3 8 4.5v9L12 21l-8-4.5v-9Z"/><path d="m4 7.5 8 4.5 8-4.5M12 12v9"/></svg><span>Theme</span>';
        toggle.setAttribute('aria-controls', 'hexstudio-theme-panel');
        toggle.setAttribute('aria-expanded', 'false');
        toggle.addEventListener('click', function () { showPicker(panel.hidden, panel.hidden); });
        panel = element('section', 'hexstudio-panel'); panel.id = 'hexstudio-theme-panel'; panel.hidden = true;
        panel.setAttribute('aria-labelledby', 'hexstudio-theme-title');
        var head = element('div', 'hexstudio-head');
        var heading = element('h2', '', 'Make it yours'); heading.id = 'hexstudio-theme-title';
        var close = button('hexstudio-close', '×'); close.setAttribute('aria-label', 'Close theme settings');
        close.addEventListener('click', function () { showPicker(false, true); });
        head.appendChild(heading); head.appendChild(close); panel.appendChild(head);
        panel.appendChild(element('p', 'hexstudio-help', 'Choose a profile or pick your own colors.'));
        var presets = element('div', 'hexstudio-presets'); presets.setAttribute('role', 'group'); presets.setAttribute('aria-label', 'Theme profiles');
        Object.keys(themes).forEach(function (id) {
            var preset = button('hexstudio-preset'); preset.setAttribute('data-theme', id);
            var swatches = element('span', 'hexstudio-swatches'); swatches.setAttribute('aria-hidden', 'true');
            themes[id][themes[id].mode].colors.forEach(function (color) {
                var swatch = element('span', 'hexstudio-swatch'); swatch.style.background = color; swatches.appendChild(swatch);
            });
            preset.appendChild(swatches); preset.appendChild(element('span', '', themes[id].label));
            preset.addEventListener('click', function () { api.setTheme(id); });
            presetButtons.push(preset); presets.appendChild(preset);
        });
        panel.appendChild(presets);
        var custom = element('fieldset', 'hexstudio-custom'); custom.appendChild(element('legend', '', 'Custom colors'));
        var colors = element('div', 'hexstudio-colors');
        ['Background', 'Hex 1', 'Hex 2', 'Hex 3'].forEach(function (label, index) {
            var wrapper = element('label', 'hexstudio-color', label);
            var input = element('input'); input.type = 'color'; input.setAttribute('aria-label', label + ' color');
            input.addEventListener('input', function () {
                var next = {background: spec.background, colors: spec.colors.slice()};
                if (index === 0) next.background = input.value; else next.colors[index - 1] = input.value;
                api.setColors(next);
            });
            wrapper.appendChild(input); colors.appendChild(wrapper); controls[index] = input;
        });
        custom.appendChild(colors); panel.appendChild(custom);
        var motionLabel = element('label', 'hexstudio-motion');
        controls.motion = element('input'); controls.motion.type = 'checkbox';
        controls.motion.addEventListener('change', function () { api.setMotion(controls.motion.checked ? 'drift' : 'still'); });
        controls.motionText = element('span', '', 'Animate background');
        motionLabel.appendChild(controls.motion); motionLabel.appendChild(controls.motionText); panel.appendChild(motionLabel);
        var files = element('div', 'hexstudio-files');
        var exportButton = button('hexstudio-filebtn', 'Export profile');
        exportButton.addEventListener('click', function () { runFileAction(function () { api.downloadProfile(); return 'Profile downloaded as JSON. Use Import profile to load it again.'; }); });
        var importButton = button('hexstudio-filebtn', 'Import profile');
        var fileInput = element('input'); fileInput.type = 'file'; fileInput.accept = '.json,application/json'; fileInput.hidden = true;
        importButton.addEventListener('click', function () { fileInput.value = ''; fileInput.click(); });
        fileInput.addEventListener('change', function () {
            var file = fileInput.files && fileInput.files[0];
            if (!file) return;
            if (file.size > 65536) { fileStatus.textContent = 'Choose a profile JSON file smaller than 64 KB.'; return; }
            var reader = new FileReader();
            reader.onload = function () { runFileAction(function () { api.importProfile(reader.result); return 'Profile imported and applied.'; }); };
            reader.onerror = function () { fileStatus.textContent = 'That file could not be read. Please try again.'; };
            reader.readAsText(file);
        });
        var backgroundButton = button('hexstudio-filebtn hexstudio-background', 'Download background (.js)');
        backgroundButton.addEventListener('click', function () { runFileAction(function () { api.downloadBackground(); return 'Add the downloaded script to your site with a script tag. No stylesheet is needed.'; }); });
        files.appendChild(exportButton); files.appendChild(importButton); files.appendChild(backgroundButton);
        panel.appendChild(files); panel.appendChild(fileInput);
        fileStatus = element('p', 'hexstudio-file-status'); fileStatus.setAttribute('role', 'status'); panel.appendChild(fileStatus);
        status = element('p', 'hexstudio-status'); status.setAttribute('role', 'status'); panel.appendChild(status);
        var reset = button('hexstudio-reset', 'Reset to page defaults'); reset.addEventListener('click', function () { api.reset(); }); panel.appendChild(reset);
        picker.appendChild(panel); picker.appendChild(toggle); document.body.appendChild(picker);
        document.addEventListener('keydown', function (event) {
            if (event.key === 'Escape' && !panel.hidden) { showPicker(false, true); event.stopPropagation(); }
        });
        // Dismiss before an outside control's click can open the picker.
        // A click listener here would close an externally opened picker again.
        document.addEventListener('pointerdown', function (event) {
            if (!panel.hidden && !picker.contains(event.target)) showPicker(false, false);
        });
        syncControls();
    }
    function runFileAction(action) {
        try { var message = action(); if (fileStatus) fileStatus.textContent = message; }
        catch (error) { if (fileStatus) fileStatus.textContent = error.message || 'The file could not be processed.'; }
    }
    function download(content, type, filename) {
        var blob = new Blob([content], {type: type});
        var url = window.URL.createObjectURL(blob);
        var link = element('a'); link.href = url; link.download = filename; link.hidden = true;
        document.body.appendChild(link);
        try { link.click(); }
        finally {
            link.remove();
            window.setTimeout(function () { window.URL.revokeObjectURL(url); }, 10000);
        }
    }
    function syncControls() {
        if (!picker) return;
        presetButtons.forEach(function (preset) { preset.setAttribute('aria-pressed', String(profile.theme === preset.getAttribute('data-theme'))); });
        controls[0].value = spec.background;
        spec.colors.forEach(function (color, i) { controls[i + 1].value = color; });
        controls.motion.checked = moving(); controls.motion.disabled = !!(media && media.matches);
        controls.motionText.textContent = media && media.matches ? 'Motion paused by system settings' : 'Animate background';
        status.textContent = !remember ? 'Applies to this page only.' : storageOK ? 'Saved automatically in this browser.' : 'Storage unavailable. Applies to this page only.';
    }
    function wrapContent(body) {
        if (body.querySelector('.hs-sheet')) return;
        var kids = Array.prototype.slice.call(body.childNodes), nav = body.querySelector('nav'), seen = !nav;
        var sheet = element('div', 'hs-sheet'), move = [];
        kids.forEach(function (node) {
            if (!seen) { if (node === nav || (node.contains && node.contains(nav))) seen = true; return; }
            if (node.nodeType === 1 && (/^(SCRIPT|CANVAS|LINK|STYLE)$/.test(node.tagName) || node.matches('.modal,.hs-hexbg,.hs-hexvig,.hs-hexstripe,.hexstudio-picker'))) return;
            move.push(node);
        });
        if (!move.length) return;
        body.insertBefore(sheet, move[0]); move.forEach(function (node) { sheet.appendChild(node); });
    }
    function start() {
        if (started || !document.body) return;
        if (opt('frame', embedded ? '0' : '1') !== '0') wrapContent(document.body);
        if (opt('stripe', embedded && embedded.stripe ? '1' : '0') === '1') { stripe = element('div', 'hs-hexstripe'); stripe.setAttribute('aria-hidden', 'true'); document.body.appendChild(stripe); }
        vignette = element('div', 'hs-hexvig'); vignette.setAttribute('aria-hidden', 'true'); document.body.appendChild(vignette);
        canvas = element('canvas', 'hs-hexbg'); canvas.setAttribute('aria-hidden', 'true'); document.body.appendChild(canvas);
        try { context = canvas.getContext && canvas.getContext('2d'); } catch (error) { context = null; }
        started = true;
        build(); animate();
        window.addEventListener('resize', build);
        window.addEventListener('pointermove', function (event) { if (event.pointerType !== 'touch') { mouseX = event.clientX; mouseY = event.clientY; } }, {passive: true});
        function clearPointer() { mouseX = mouseY = -9999; }
        document.addEventListener('pointerout', function (event) { if (!event.relatedTarget) clearPointer(); });
        window.addEventListener('blur', clearPointer);
        document.addEventListener('visibilitychange', animate);
        if (opt('controls', embedded ? '0' : '1') !== '0') createPicker();
    }
    var api = {
        getProfile: function () { return clone(profile); },
        exportProfile: function () { return JSON.stringify(profile, null, 2) + '\n'; },
        importProfile: function (value) {
            if (typeof value === 'string') {
                if (value.length > 65536) throw new TypeError('Choose a profile JSON file smaller than 64 KB.');
                try { value = JSON.parse(value); } catch (error) { throw new TypeError('That file is not valid JSON.'); }
            }
            var next = validProfile(value);
            if (!next) throw new TypeError('That file is not a supported Hex Studio profile (version 1).');
            profile = next; changed(); return clone(profile);
        },
        downloadProfile: function () { download(api.exportProfile(), 'application/json', 'hexstudio-' + profile.theme + '-profile.json'); },
        backgroundScript: function () {
            var settings = {profile: clone(profile), size: radius, stripe: !!stripe};
            return '/* Hex Studio background. Add <script src="hex-background.js"></script> before </body>. No external CSS or libraries required. */\n(' + hexStudioRuntime.toString() + ')(' + JSON.stringify(settings) + ');\n';
        },
        downloadBackground: function () { download(api.backgroundScript(), 'text/javascript', 'hex-background.js'); },
        getThemes: function () { return Object.keys(themes).map(function (id) { return {id: id, label: themes[id].label}; }); },
        setTheme: function (id, options) {
            if (!Object.prototype.hasOwnProperty.call(themes, id)) throw new TypeError('Unknown HexStudio theme: ' + id);
            options = options || {};
            if (options.mode && ['dark','light'].indexOf(options.mode) < 0) throw new TypeError('Mode must be dark or light.');
            profile = {version: 1, theme: id, mode: options.mode || themes[id].mode, motion: profile.motion}; changed();
        },
        setColors: function (options) {
            if (!options || !hex(options.background) || !Array.isArray(options.colors) || options.colors.length !== 3 || !options.colors.every(hex)) throw new TypeError('Provide a background and three hex colors.');
            profile = {version: 1, theme: 'custom', mode: luminance(hex(options.background)) > 0.179 ? 'light' : 'dark', motion: profile.motion, background: hex(options.background), colors: options.colors.map(hex)}; changed();
        },
        setMotion: function (motion) {
            if (motion !== 'still' && motion !== 'drift') throw new TypeError('Motion must be drift or still.');
            profile.motion = motion; changed();
        },
        reset: function () { profile = clone(defaults); changed(); },
        openPicker: function () { showPicker(true, true); },
        closePicker: function () { showPicker(false, true); }
    };
    window.HexStudio = api;
    injectStyles(); apply();
    if (media) {
        var onReduce = function () { apply(); };
        if (media.addEventListener) media.addEventListener('change', onReduce); else if (media.addListener) media.addListener(onReduce);
    }
    window.addEventListener('storage', function (event) {
        try {
            if (!remember || event.key !== storageKey || (event.storageArea && event.storageArea !== window.localStorage)) return;
            if (event.newValue === null) { profile = clone(defaults); apply(); window.dispatchEvent(new CustomEvent('hexstudio:change', {detail: clone(profile)})); return; }
            var next = validProfile(JSON.parse(event.newValue));
            if (next) { profile = next; apply(); window.dispatchEvent(new CustomEvent('hexstudio:change', {detail: clone(profile)})); }
        } catch (error) { /* Ignore malformed profiles from other tabs. */ }
    });
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, {once: true}); else start();
})();
