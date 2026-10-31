const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '..', 'hex-studio.js'), 'utf8');

function setup(options = {}) {
  const rafs = new Map(), listeners = {}, mediaListeners = {}, store = new Map(), blobs = new Map(), downloads = [], cleanups = [];
  const canvasStats = {frames: 0, fills: 0, gradients: 0, effectPaints: 0};
  let id = 0, strokes = 0, active, currentPath = [], currentCommands = [], pathClosed = false, framePaths = [], frameStrokes = [];
  const canvasStateStack = [];
  const canvasStateKeys = ['strokeStyle','fillStyle','lineWidth','globalAlpha','shadowColor','shadowBlur','filter','lineCap','lineJoin'];
  const canvasContext = {
    strokeStyle:'#000000',fillStyle:'#000000',lineWidth:1,globalAlpha:1,shadowColor:'rgba(0,0,0,0)',shadowBlur:0,filter:'none',lineCap:'butt',lineJoin:'miter',
    beginPath(){currentPath=[];currentCommands=[];pathClosed=false},
    moveTo(x,y){currentPath.push({x,y,method:'moveTo'});currentCommands.push({method:'moveTo',args:[x,y]})},
    lineTo(x,y){currentPath.push({x,y,method:'lineTo'});currentCommands.push({method:'lineTo',args:[x,y]})},
    quadraticCurveTo(...args){currentCommands.push({method:'quadraticCurveTo',args})},
    bezierCurveTo(...args){currentCommands.push({method:'bezierCurveTo',args})},
    arc(...args){currentCommands.push({method:'arc',args})},
    ellipse(...args){currentCommands.push({method:'ellipse',args})},
    closePath(){pathClosed=true;currentCommands.push({method:'closePath',args:[]})},
    stroke(){
      strokes++;
      const points=currentPath.map(point=>({...point}));
      framePaths.push({points,closed:pathClosed});
      frameStrokes.push({points,closed:pathClosed,commands:currentCommands.map(command=>({method:command.method,args:command.args.slice()})),
        ...Object.fromEntries(canvasStateKeys.map(key=>[key,this[key]]))});
    },
    fill(){canvasStats.fills++},
    fillRect(){canvasStats.effectPaints++},
    clearRect(){canvasStats.frames++;framePaths=[];frameStrokes=[]},
    setTransform(){},
    save(){canvasStateStack.push(Object.fromEntries(canvasStateKeys.map(key=>[key,this[key]])))},
    restore(){const state=canvasStateStack.pop();if(state)Object.assign(this,state)},
    translate(){},rotate(){},scale(){},
    createRadialGradient(){canvasStats.gradients++;return {addColorStop(){}}},
    createLinearGradient(){canvasStats.gradients++;return {addColorStop(){}}}
  };
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
    getContext() {return options.noCanvas ? null : canvasContext}
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
  return {window,document,root,body,head,rafs,store,media,mediaListeners,run,downloads,blobs,cleanups,canvasStats,get active(){return active},get strokes(){return strokes},get gridPaths(){return framePaths.filter(path=>path.closed&&path.points.length===6).map(path=>path.points)},get frameStrokes(){return frameStrokes},
    event(k,e={}){(listeners[k]||[]).forEach(fn=>fn(e))},step(time){const pending=[...rafs.values()];rafs.clear();pending.forEach(fn=>fn(time))}};
}
let checks=0;
function test(name,fn){fn();checks++;console.log('PASS',name)}
function controlByLabel(element,label) {
 if(element.getAttribute('aria-label')===label)return element;
 for(const child of element.childNodes){const result=controlByLabel(child,label);if(result)return result}
 return null;
}
function inputValue(element,value,event='input') {
 assert.ok(element,'the labeled control must exist');
 element.value=String(value);
 assert.ok(element.handlers[event]&&element.handlers[event].length,'the control must handle '+event);
 element.handlers[event].forEach(fn=>fn({target:element}));
}
function openStrokePaths(environment) {
 const paths=[];
 for(const stroke of environment.frameStrokes) {
  if(stroke.closed)continue;
  let points=[];
  function finish(){if(points.length>1)paths.push({...stroke,points});points=[]}
  for(const command of stroke.commands) {
   if(command.method==='moveTo'){finish();points.push({x:command.args[0],y:command.args[1]})}
   else if(command.method==='lineTo')points.push({x:command.args[0],y:command.args[1]});
  }
  finish();
 }
 return paths;
}
function pathSignature(points) {return points.map(point=>point.x.toFixed(3)+','+point.y.toFixed(3)).join(';')}
function uniqueOpenPaths(environment) {
 const unique=new Map();
 for(const path of openStrokePaths(environment))unique.set(pathSignature(path.points),path);
 return [...unique.values()];
}
function strokeColor(stroke) {
 const match=/^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)(?:\s*,\s*([\d.]+))?\s*\)$/.exec(stroke.strokeStyle);
 assert.ok(match,'the rendered stroke must have a numeric RGB color');
 return {rgb:match.slice(1,4).map(Number),opacity:Number(match[4]===undefined?1:match[4])*(stroke.globalAlpha===undefined?1:stroke.globalAlpha)};
}
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
test('legacy v1 profiles receive compatible size, speed, and effect defaults',()=>{
 const legacy={version:1,theme:'carbon',mode:'dark',motion:'drift'};
 const e=setup({saved:JSON.stringify(legacy)}),api=e.window.HexStudio;
 assert.equal(api.getProfile().theme,'carbon');
 assert.equal(api.getProfile().size,42);assert.equal(api.getProfile().speed,1);assert.equal(api.getProfile().effect,'clouds');
 api.setSize(80);api.setSpeed(2);api.setEffect('water');api.importProfile(legacy);
 assert.equal(api.getProfile().size,42);assert.equal(api.getProfile().speed,1);assert.equal(api.getProfile().effect,'clouds');
 const configured=setup({attrs:{'data-size':'72','data-speed':'1.5','data-effect':'none'}}).window.HexStudio.getProfile();
 assert.equal(configured.size,72);assert.equal(configured.speed,1.5);assert.equal(configured.effect,'none');
});
test('settings setters reject invalid values without changing the profile',()=>{
 const e=setup(),api=e.window.HexStudio;
 api.setSize(12);api.setSize(160);api.setSpeed(0);api.setSpeed(3);
 const before=api.exportProfile();
 for(const value of [11,161,NaN,Infinity,-Infinity,'42',null,undefined])assert.throws(()=>api.setSize(value));
 for(const value of [-0.01,3.01,NaN,Infinity,-Infinity,'1',null,undefined])assert.throws(()=>api.setSpeed(value));
 for(const value of ['rain','Clouds','__proto__','',null,undefined])assert.throws(()=>api.setEffect(value));
 assert.equal(api.exportProfile(),before);
});
test('settings validation is atomic during profile import',()=>{
 const e=setup(),api=e.window.HexStudio;
 api.setTheme('carbon');api.setSize(64);api.setSpeed(1.5);api.setEffect('water');
 const profile=JSON.parse(api.exportProfile()),before=api.exportProfile();
 for(const patch of [{size:11},{size:161},{size:'42'},{size:null},{speed:-1},{speed:3.01},{speed:'1'},{speed:null},{effect:'rain'},{effect:null}]) {
  assert.throws(()=>api.importProfile(JSON.stringify({...profile,...patch})));
  assert.equal(api.exportProfile(),before,'a rejected import must not partially change the active settings');
 }
});
test('palette and motion changes retain the chosen animation settings',()=>{
 const e=setup(),api=e.window.HexStudio;
 api.setSize(76);api.setSpeed(0.75);api.setEffect('lightning');
 function assertSettings(){const p=api.getProfile();assert.equal(p.size,76);assert.equal(p.speed,0.75);assert.equal(p.effect,'lightning')}
 api.setTheme('nimbus');assertSettings();
 api.setColors({background:'#071521',colors:['#a8dfff','#ffffff','#bac8d6']});assertSettings();
 api.setMotion('still');assertSettings();api.setMotion('drift');assertSettings();
});
test('size, speed, and atmosphere survive browser, JSON, and standalone round trips',()=>{
 const e=setup({attrs:{'data-stripe':'1'}}),api=e.window.HexStudio;
 api.setColors({background:'#071521',colors:['#a8dfff','#ffffff','#bac8d6']});
 api.setSize(68);api.setSpeed(1.75);api.setEffect('water');
 const json=api.exportProfile(),profile=JSON.parse(json);
 const restored=setup({saved:e.store.get('hexstudio.profile.v1')});
 assert.deepEqual(JSON.parse(restored.window.HexStudio.exportProfile()),profile);
 const imported=setup();imported.window.HexStudio.importProfile(json);
 assert.deepEqual(JSON.parse(imported.window.HexStudio.exportProfile()),profile);
 const standalone=setup({source:api.backgroundScript(),blockStorage:true});
 assert.deepEqual(JSON.parse(standalone.window.HexStudio.exportProfile()),profile);
 assert.equal(standalone.body.querySelector('.hexstudio-picker'),null);
});
test('labeled picker controls apply size, movement speed, and background effect',()=>{
 const e=setup(),picker=e.body.querySelector('.hexstudio-picker'),api=e.window.HexStudio;
 inputValue(controlByLabel(picker,'Hex size'),84);
 assert.equal(api.getProfile().size,84);
 inputValue(controlByLabel(picker,'Movement speed'),0.5);
 assert.equal(api.getProfile().speed,0.5);
 inputValue(controlByLabel(picker,'Background effect'),'water','change');
 assert.equal(api.getProfile().effect,'water');
 inputValue(controlByLabel(picker,'Movement speed'),0);
 assert.equal(api.getProfile().speed,0);assert.equal(e.rafs.size,0);
});
test('hex size changes actual grid density',()=>{
 const e=setup(),api=e.window.HexStudio;
 api.setEffect('none');api.setMotion('still');api.setSize(24);
 const smallCount=e.gridPaths.length;assert.ok(smallCount>0);
 api.setSize(96);const largeCount=e.gridPaths.length;
 assert.ok(largeCount>0);assert.ok(largeCount<smallCount/4,'larger hexagons must draw fewer cells');
});
test('speed zero pauses every atmosphere and resumes a single animation loop',()=>{
 for(const effect of ['clouds','lightning','water','none']) {
  const e=setup(),api=e.window.HexStudio;api.setEffect(effect);e.step(0);e.step(50);
  api.setSpeed(0);assert.equal(e.rafs.size,0,effect+' must stop scheduling frames at zero speed');
  const frames=e.canvasStats.frames,paints=e.canvasStats.effectPaints;
  e.step(100);e.step(150);assert.equal(e.canvasStats.frames,frames);assert.equal(e.canvasStats.effectPaints,paints);
  api.setSpeed(1);assert.equal(e.rafs.size,1);api.setSpeed(2);assert.equal(e.rafs.size,1);
  e.step(200);e.step(250);assert.ok(e.canvasStats.frames>frames);
 }
});
test('atmosphere animation respects reduced motion and hidden tabs',()=>{
 for(const effect of ['clouds','lightning','water']) {
  const e=setup({reduce:true}),api=e.window.HexStudio;api.setEffect(effect);assert.equal(e.rafs.size,0);
  const reducedFrames=e.canvasStats.frames;e.step(0);e.step(50);assert.equal(e.canvasStats.frames,reducedFrames);
  e.media.matches=false;e.mediaListeners.change.forEach(fn=>fn());assert.equal(e.rafs.size,1);
  e.step(100);e.step(150);e.document.hidden=true;e.event('doc:visibilitychange');assert.equal(e.rafs.size,0);
  const hiddenFrames=e.canvasStats.frames;e.step(200);assert.equal(e.canvasStats.frames,hiddenFrames);
  e.document.hidden=false;e.event('doc:visibilitychange');assert.equal(e.rafs.size,1);
 }
});
test('water ripples deform hex vertices while cells stay anchored',()=>{
 const e=setup(),api=e.window.HexStudio;api.setEffect('water');api.setSpeed(1);api.setSize(42);
 e.step(0);const initial=e.gridPaths[0];assert.ok(initial,'water must still draw the hex grid');
 let maxCenterTravel=0,shapeChanged=false;
 const center=points=>({x:points.reduce((sum,p)=>sum+p.x,0)/6,y:points.reduce((sum,p)=>sum+p.y,0)/6});
 const origin=center(initial);
 for(let frame=1;frame<=180;frame++) {
  e.step(frame*50);const current=e.gridPaths[0];assert.ok(current);
  const now=center(current);maxCenterTravel=Math.max(maxCenterTravel,Math.hypot(now.x-origin.x,now.y-origin.y));
  for(let i=1;i<6;i++) {
   const beforeX=initial[i].x-initial[0].x,beforeY=initial[i].y-initial[0].y;
   const afterX=current[i].x-current[0].x,afterY=current[i].y-current[0].y;
   if(Math.hypot(afterX-beforeX,afterY-beforeY)>0.05)shapeChanged=true;
  }
 }
 assert.ok(shapeChanged,'water must change vertex-relative geometry rather than translate the entire grid');
 assert.ok(maxCenterTravel<20,'water cells should remain anchored instead of drifting through a full row');
});
test('lightning has jagged connected forks instead of smooth decorative curves',()=>{
 const e=setup(),api=e.window.HexStudio;api.setEffect('lightning');
 const paths=uniqueOpenPaths(e).sort((a,b)=>b.points.length-a.points.length);
 assert.ok(paths.length>=4,'a strike must include several distinct open bolt paths');
 const main=paths[0].points;
 assert.ok(main.length>=20,'the main bolt needs enough straight segments to form a jagged strike');
 let lastTurn=0,alternatingTurns=0;
 for(let i=2;i<main.length;i++) {
  const ax=main[i-1].x-main[i-2].x,ay=main[i-1].y-main[i-2].y;
  const bx=main[i].x-main[i-1].x,by=main[i].y-main[i-1].y;
  const cross=ax*by-ay*bx;
  if(Math.abs(cross)<0.001)continue;
  const turn=Math.sign(cross);if(lastTurn&&turn!==lastTurn)alternatingTurns++;lastTurn=turn;
 }
 assert.ok(alternatingTurns>=5,'the bolt must zigzag through sharp changes of direction');
 const forks=paths.slice(1).filter(branch=>paths.some(parent=>parent!==branch&&parent.points.length>branch.points.length&&parent.points.some(point=>Math.hypot(point.x-branch.points[0].x,point.y-branch.points[0].y)<0.01)));
 assert.ok(forks.length>=2,'at least two smaller branches must connect to a parent bolt');
 assert.ok(e.gridPaths.length>0,'the closed honeycomb grid remains visible behind the open bolts');
});
test('lightning holds its shape through a pulse and changes geometry while dim',()=>{
 const e=setup(),api=e.window.HexStudio;api.setSize(64);api.setSpeed(1);api.setEffect('lightning');api.setTheme('carbon');
 const before=api.exportProfile();
 function mainSignature(){const paths=uniqueOpenPaths(e).sort((a,b)=>b.points.length-a.points.length);assert.ok(paths.length);return pathSignature(paths[0].points)}
 const first=mainSignature(),openingBrightness=Math.max(...openStrokePaths(e).map(stroke=>strokeColor(stroke).opacity));e.step(0);
 for(let time=50;time<=500;time+=50){e.step(time);assert.equal(mainSignature(),first,'the initial shape must remain stable as its brightness pulses')}
 let changedBrightness;
 for(let time=550;time<=8000;time+=50){
  e.step(time);assert.equal(e.rafs.size,1,'lightning must use the existing single animation loop');
  if(changedBrightness===undefined&&uniqueOpenPaths(e).length&&mainSignature()!==first)changedBrightness=Math.max(...openStrokePaths(e).map(stroke=>strokeColor(stroke).opacity));
 }
 assert.notEqual(mainSignature(),first,'a later pulse cycle must reveal a new bolt shape');
 assert.ok(changedBrightness!==undefined&&changedBrightness<openingBrightness*0.15,'new geometry should appear near the dim phase rather than cut sharply at full brightness');
 assert.equal(api.exportProfile(),before,'rendering pulses must not alter the chosen profile or settings');
});
test('lightning uses a readable fuzzy core with a broader blue bloom',()=>{
 const e=setup();e.window.HexStudio.setEffect('lightning');
 const paths=openStrokePaths(e),main=paths.reduce((best,path)=>!best||path.points.length>best.points.length?path:best,null);
 assert.ok(main);
 const layers=paths.filter(path=>pathSignature(path.points)===pathSignature(main.points)).sort((a,b)=>a.lineWidth-b.lineWidth);
 assert.ok(layers.length>=2,'the same bolt must be rendered as a soft core and a larger glow');
 const core=layers[0],bloom=layers[layers.length-1],color=strokeColor(core);
 assert.ok(color.rgb.every(channel=>channel>=230),'the peak core should appear near white');
 assert.ok(color.opacity>=0.35&&color.opacity<=0.65,'the core should remain readable at a restrained pulse brightness');
 const coreBlur=/blur\(([\d.]+)px\)/.exec(core.filter);
 assert.ok(coreBlur&&Number(coreBlur[1])>2.5,'the visible core should be diffuse rather than appear razor sharp');
 assert.ok(bloom.lineWidth>core.lineWidth*3,'bloom must surround the thin core');
 assert.ok(bloom.shadowBlur>core.shadowBlur,'the surrounding bloom should diffuse farther than the core');
});
test('lightning breathes smoothly through a dim minimum and returns without flashes',()=>{
 const e=setup();e.window.HexStudio.setEffect('lightning');
 function opacity(){return openStrokePaths(e).reduce((peak,stroke)=>Math.max(peak,strokeColor(stroke).opacity),0)}
 const samples=[{time:0,value:opacity()}];e.step(0);
 for(let time=50;time<=8000;time+=50){e.step(time);samples.push({time,value:opacity()})}
 const peak=Math.max(...samples.map(sample=>sample.value));
 assert.ok(peak>=0.35&&peak<=0.65,'a pulse should peak at a restrained, readable brightness');
 assert.ok(samples.some(sample=>sample.value>0&&sample.value<peak*0.3),'the pulse should pass gradually through lower brightness levels');
 assert.ok(samples.find(sample=>sample.time===500).value>peak*0.8,'the glow should remain continuous instead of quickly striking and fading');
 assert.ok(samples.find(sample=>sample.time===4000).value<peak*0.1,'the pulse should reach a dim midpoint');
 const fade=samples.find(sample=>sample.time===2000).value,rise=samples.find(sample=>sample.time===6000).value;
 assert.ok(fade>peak*0.25&&fade<peak*0.75&&rise>peak*0.25&&rise<peak*0.75,'both sides of the breath should have a gradual mid-brightness phase');
 for(let i=1;i<samples.length;i++)assert.ok(Math.abs(samples[i].value-samples[i-1].value)<0.08,'adjacent animation frames must not jump like a hard flash or restrike');
 assert.ok(samples[samples.length-1].value>peak*0.9,'the next smooth pulse should return to full glow');
});
console.log(`${checks} behavioral checks passed`);
module.exports = {setup};
