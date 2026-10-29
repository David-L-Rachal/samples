const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '..', 'hex-studio.js'), 'utf8');

function setup(options = {}) {
  const rafs = new Map(), listeners = {}, mediaListeners = {}, store = new Map(), blobs = new Map(), downloads = [], cleanups = [];
  let id = 0, strokes = 0, active;
  class Element {
    constructor(tag) {
      this.tagName = tag.toUpperCase(); this.nodeType = 1; this.childNodes = [];
      this.attrs = {}; this.handlers = {}; this.style = {setProperty(k,v) {this[k]=v}, removeProperty(k) {delete this[k]}};
      this.className = ''; this.hidden = false;
      this.classList = {
        contains: x => this.className.split(/\s+/).includes(x),
        add: x => {if(!this.classList.contains(x)) this.className += ' ' + x},
        toggle: (x, on) => { this.className = this.className.split(/\s+/).filter(c=>c && c!==x).concat(on ? [x] : []).join(' ') }
      };
    }
    setAttribute(k,v) {this.attrs[k]=String(v)}
    getAttribute(k) {return this.attrs[k] ?? null}
    hasAttribute(k) {return k in this.attrs}
    appendChild(e) {if(e.parentNode) e.parentNode.childNodes=e.parentNode.childNodes.filter(x=>x!==e); this.childNodes.push(e); e.parentNode=this; return e}
    insertBefore(e,n) {this.childNodes.splice(this.childNodes.indexOf(n),0,e);e.parentNode=this}
    contains(e) {return this===e || this.childNodes.some(c=>c.contains(e))}
    matches(query) {return query.split(',').some(s=>s.startsWith('.') ? this.classList.contains(s.slice(1)) : this.tagName===s.toUpperCase())}
    querySelector(query) {for (const c of this.childNodes) {if(c.matches(query)) return c; const nested=c.querySelector(query);if(nested)return nested}return null}
    addEventListener(k,fn) {(this.handlers[k] ||= []).push(fn)}
    focus() {active=this}
    click() {
      if(this.tagName==='A')downloads.push({filename:this.download,blob:blobs.get(this.href)});
      const event={target:this};
      (this.handlers.click||[]).forEach(fn=>fn(event));
      (listeners['doc:click']||[]).forEach(fn=>fn(event));
    }
    remove() {if(this.parentNode)this.parentNode.childNodes=this.parentNode.childNodes.filter(c=>c!==this)}
    getContext() {return options.noCanvas ? null : {beginPath(){},moveTo(){},lineTo(){},closePath(){},stroke(){strokes++},fill(){},clearRect(){},setTransform(){}}}
  }
  const root=new Element('html'),body=new Element('body'),head=new Element('head'),script=new Element('script');
  root.appendChild(head);root.appendChild(body);
  const attrs = {'data-frame':'0', ...(options.attrs||{})};
  for(const [k,v] of Object.entries(attrs))script.setAttribute(k,v);
  const document={documentElement:root,body,head,currentScript:script,readyState:'complete',hidden:false,
    createElement:t=>new Element(t),addEventListener(k,fn){(listeners['doc:'+k] ||= []).push(fn)}};
  const storage={getItem(k){if(options.blockStorage)throw Error('blocked');return store.get(k)||null},setItem(k,v){if(options.blockStorage)throw Error('blocked');store.set(k,v)}};
  if(options.saved)store.set('hexstudio.profile.v1',options.saved);
  const media={matches:!!options.reduce,addEventListener(k,fn){(mediaListeners[k] ||= []).push(fn)}};
  const window={innerWidth:1024,innerHeight:768,devicePixelRatio:2,localStorage:storage,matchMedia:()=>media,
    URL:{createObjectURL(blob){const url='blob:'+blobs.size;blobs.set(url,blob);return url},revokeObjectURL(url){blobs.delete(url)}},setTimeout(fn){cleanups.push(fn)},
    requestAnimationFrame(fn){rafs.set(++id,fn);return id},cancelAnimationFrame(id){rafs.delete(id)},
    addEventListener(k,fn){(listeners[k] ||= []).push(fn)},dispatchEvent(event){(listeners[event.type]||[]).forEach(fn=>fn(event))}};
  const context=vm.createContext({window,document,location:{search:options.search||''},URLSearchParams,Blob:class {constructor(parts,options){this.content=parts.join('');this.type=options.type}},CustomEvent:class {constructor(type,options){this.type=type;this.detail=options.detail}}});
  const run=()=>vm.runInContext(options.source||source,context);
  run();
  return {window,document,root,body,head,rafs,store,media,mediaListeners,run,downloads,blobs,cleanups,get active(){return active},get strokes(){return strokes},
    event(k,e={}){(listeners[k]||[]).forEach(fn=>fn(e))},step(time){const pending=[...rafs.values()];rafs.clear();pending.forEach(fn=>fn(time))}};
}
let checks=0;
function test(name,fn){fn();checks++;console.log('PASS',name)}
test('original defaults, canvas, and singleton animation',()=>{
 const e=setup();assert.equal(e.window.HexStudio.getProfile().theme,'original');assert.equal(e.rafs.size,1);
 for(let i=0;i<20;i++)e.window.HexStudio.setTheme(i%2?'carbon':'nimbus');
 assert.equal(e.rafs.size,1);const before=e.strokes;e.step(0);e.step(16);assert.ok(e.strokes>before);assert.equal(e.rafs.size,1);
 e.run();assert.equal(e.body.childNodes.filter(x=>x.tagName==='CANVAS').length,1);
});
test('preset saving, restore, API snapshots and reset',()=>{
 const e=setup();e.window.HexStudio.setTheme('carbon');const saved=e.store.get('hexstudio.profile.v1');
 assert.equal(JSON.parse(saved).theme,'carbon');const next=setup({saved});assert.equal(next.window.HexStudio.getProfile().theme,'carbon');
 const snapshot=next.window.HexStudio.getProfile();snapshot.theme='nimbus';assert.equal(next.window.HexStudio.getProfile().theme,'carbon');
 next.window.HexStudio.reset();assert.equal(next.window.HexStudio.getProfile().theme,'original');
});
test('Nimbus light mode and explicit dark override',()=>{
 const e=setup();e.window.HexStudio.setTheme('nimbus');assert.equal(e.window.HexStudio.getProfile().mode,'light');
 assert.ok(e.root.classList.contains('hs-hex-light'));assert.equal(e.root.style['--hs-text'],'#203c50');
 e.window.HexStudio.setTheme('nimbus',{mode:'dark'});assert.equal(e.window.HexStudio.getProfile().mode,'dark');
 e.window.HexStudio.setTheme('original');assert.equal(e.root.style['--hs-text'],undefined);
});
test('custom colors validate, normalize and restore',()=>{
 const e=setup();e.window.HexStudio.setColors({background:'#000',colors:['#cff','#fff','#abc']});
 const p=e.window.HexStudio.getProfile();assert.equal(p.background,'#000000');assert.equal(p.colors[0],'#ccffff');assert.equal(e.root.style['--hexstudio-button-text'],'#08121c');
 const next=setup({saved:e.store.get('hexstudio.profile.v1')});assert.equal(next.window.HexStudio.getProfile().theme,'custom');
 e.window.HexStudio.setColors({background:'#a0a0a0',colors:['#cff','#fff','#abc']});assert.equal(e.window.HexStudio.getProfile().mode,'light');
 assert.throws(()=>e.window.HexStudio.setColors({background:'red',colors:['#fff']}));assert.throws(()=>e.window.HexStudio.setTheme('__proto__'));
});
test('blocked or malformed storage fails gracefully',()=>{
 const e=setup({blockStorage:true});e.window.HexStudio.setTheme('carbon');assert.equal(e.window.HexStudio.getProfile().theme,'carbon');
 assert.match(e.body.querySelector('.hexstudio-status').textContent,/Storage unavailable/);
 assert.equal(setup({saved:'not-json'}).window.HexStudio.getProfile().theme,'original');
 assert.equal(setup({saved:JSON.stringify({version:1,theme:'__proto__',mode:'dark',motion:'drift'})}).window.HexStudio.getProfile().theme,'original');
});
test('motion respects system changes and hidden tabs',()=>{
 const e=setup({reduce:true});assert.equal(e.rafs.size,0);e.window.HexStudio.setMotion('drift');assert.equal(e.rafs.size,0);
 e.media.matches=false;e.mediaListeners.change.forEach(fn=>fn());assert.equal(e.rafs.size,1);
 e.document.hidden=true;e.event('doc:visibilitychange');assert.equal(e.rafs.size,0);
 e.document.hidden=false;e.event('doc:visibilitychange');assert.equal(e.rafs.size,1);
 e.window.HexStudio.setMotion('still');assert.equal(e.rafs.size,0);e.event('resize');assert.equal(e.rafs.size,0);
});
test('keyboard picker opens with focus and closes on Escape',()=>{
 const e=setup();const toggle=e.body.querySelector('.hexstudio-toggle'),panel=e.body.querySelector('.hexstudio-panel');
 toggle.handlers.click[0]();assert.equal(panel.hidden,false);assert.equal(e.active,e.body.querySelector('.hexstudio-preset'));
 e.event('doc:keydown',{key:'Escape',stopPropagation(){}});assert.equal(panel.hidden,true);assert.equal(e.active,toggle);
});
test('external Customize click opens the picker through the full event sequence',()=>{
 const e=setup();const api=e.window.HexStudio,panel=e.body.querySelector('.hexstudio-panel'),toggle=e.body.querySelector('.hexstudio-toggle');
 const external=e.document.createElement('button');e.body.appendChild(external);external.addEventListener('click',()=>api.openPicker());
 e.event('doc:pointerdown',{target:external});external.click();
 assert.equal(panel.hidden,false);assert.equal(toggle.getAttribute('aria-expanded'),'true');
 assert.equal(e.active,e.body.querySelector('.hexstudio-preset'));
 e.event('doc:pointerdown',{target:e.body.querySelector('.hexstudio-color')});assert.equal(panel.hidden,false);
 api.downloadProfile();assert.equal(panel.hidden,false,'generated download clicks must not close the picker');
 e.event('doc:pointerdown',{target:e.body});assert.equal(panel.hidden,true);
 external.click();assert.equal(panel.hidden,false,'keyboard-generated clicks must also open the picker');
 toggle.click();assert.equal(panel.hidden,true);toggle.click();assert.equal(panel.hidden,false);
});
test('other-tab profiles and resets dispatch changes',()=>{
 const e=setup();let changes=0;e.window.addEventListener('hexstudio:change',()=>changes++);
 e.event('storage',{key:'hexstudio.profile.v1',newValue:JSON.stringify({version:1,theme:'carbon',mode:'dark',motion:'still'})});
 assert.equal(e.window.HexStudio.getProfile().theme,'carbon');assert.equal(e.rafs.size,0);
 e.event('storage',{key:'hexstudio.profile.v1',newValue:null});assert.equal(e.window.HexStudio.getProfile().theme,'original');assert.equal(changes,2);
});
test('opt-outs, still/no-canvas mode and disabled persistence',()=>{
 assert.equal(setup({attrs:{'data-mode':'off'}}).window.HexStudio,undefined);
 assert.equal(setup({search:'?nohex=1'}).window.HexStudio,undefined);
 assert.ok(setup({search:'?nohex=10'}).window.HexStudio);
 assert.equal(setup({noCanvas:true}).rafs.size,0);
 const e=setup({attrs:{'data-controls':'0','data-remember':'0','data-motion':'still'}});assert.equal(e.rafs.size,0);
 assert.equal(e.body.querySelector('.hexstudio-picker'),null);e.window.HexStudio.setTheme('carbon');assert.equal(e.store.size,0);
});
test('existing light and frame defaults remain supported',()=>{
 const e=setup({attrs:{'data-mode':'light','data-frame':'1'}});assert.equal(e.window.HexStudio.getProfile().mode,'light');
 assert.ok(e.root.classList.contains('hs-hex-light'));
});
test('profile export/import preserves presets and custom combinations',()=>{
 for(const theme of ['original','carbon','nimbus']) {
  const e=setup();e.window.HexStudio.setTheme(theme);e.window.HexStudio.setMotion('still');
  const before=JSON.stringify(e.window.HexStudio.getProfile());const json=e.window.HexStudio.exportProfile();e.window.HexStudio.reset();e.window.HexStudio.importProfile(json);
  assert.equal(JSON.stringify(e.window.HexStudio.getProfile()),before);
 }
 const e=setup();e.window.HexStudio.setColors({background:'#08121f',colors:['#a8dfff','#ffffff','#bac8d6']});
 const json=e.window.HexStudio.exportProfile();const next=setup();next.window.HexStudio.importProfile(json);assert.equal(next.window.HexStudio.exportProfile(),json);
});
test('invalid imports do not change the active profile',()=>{
 const e=setup();e.window.HexStudio.setTheme('carbon');const before=e.window.HexStudio.exportProfile();
 for(const value of ['{oops',JSON.stringify({version:99,theme:'carbon'}),JSON.stringify({version:1,theme:'custom',mode:'dark',motion:'drift',background:'url(bad)',colors:['#fff','#fff','#fff']}),' '.repeat(65537)]) {
  assert.throws(()=>e.window.HexStudio.importProfile(value));assert.equal(e.window.HexStudio.exportProfile(),before);
 }
});
test('standalone background script works without CSS, storage, or controls',()=>{
 const e=setup({attrs:{'data-stripe':'1'}});e.window.HexStudio.setColors({background:'#08121f',colors:['#a8dfff','#ffffff','#bac8d6']});e.window.HexStudio.setMotion('still');
 const script=e.window.HexStudio.backgroundScript();new vm.Script(script);
 const next=setup({source:script,attrs:{},blockStorage:true});assert.equal(next.window.HexStudio.exportProfile(),e.window.HexStudio.exportProfile());
 assert.equal(next.rafs.size,0);assert.equal(next.body.querySelector('.hexstudio-picker'),null);assert.ok(next.body.querySelector('.hs-hexstripe'));
 assert.match(next.head.childNodes[0].textContent,/\.hs-hexbg,.hs-hexvig/);assert.match(next.head.childNodes[0].textContent,/@keyframes hs-hex-slide/);
});
test('download creates proper files and delays URL cleanup',()=>{
 const e=setup();e.window.HexStudio.setTheme('carbon');e.window.HexStudio.downloadProfile();e.window.HexStudio.downloadBackground();
 assert.equal(e.downloads.length,2);assert.equal(e.downloads[0].filename,'hexstudio-carbon-profile.json');assert.equal(e.downloads[0].blob.type,'application/json');
 assert.equal(JSON.parse(e.downloads[0].blob.content).theme,'carbon');assert.equal(e.downloads[1].filename,'hex-background.js');new vm.Script(e.downloads[1].blob.content);
 assert.equal(e.body.childNodes.filter(c=>c.tagName==='A').length,0);assert.equal(e.blobs.size,2);e.cleanups.forEach(fn=>fn());assert.equal(e.blobs.size,0);
});
console.log(`${checks} behavioral checks passed`);
module.exports = {setup};
