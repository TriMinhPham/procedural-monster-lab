// Contract test for the procedural music director. It deliberately supplies
// no real WebAudio: scheduling is driven by manual interval ticks.
const fs=require('fs'),vm=require('vm');
const html=fs.readFileSync(__dirname+'/../hunt.html','utf8');
const js=html.split('<script>')[1].split('</script>')[0];
const el=()=>({style:{},dataset:{},textContent:'',classList:{add(){},remove(){},toggle(){}},addEventListener(){},appendChild(){},getContext(){return gl;},querySelector(){return el();}});
const gl=new Proxy({}, {get(_,p){if(p==='getShaderParameter'||p==='getProgramParameter')return()=>true;if(p==='getShaderInfoLog'||p==='getProgramInfoLog')return()=>'';if(p==='createShader'||p==='createProgram')return()=>({});if(p==='getUniformLocation')return(p,n)=>n;return()=>{};}});
let made={osc:0,gain:0,filter:0},intervals=[];
function param(v){return {value:v,setValueAtTime(x){this.value=x;},linearRampToValueAtTime(x){this.value=x;},exponentialRampToValueAtTime(x){this.value=x;}};}
function node(kind){return {kind,frequency:param(0),detune:param(0),gain:param(0),connect(){return this;},disconnect(){},start(){},stop(){},onended:null};}
class FakeAudioContext{
  constructor(){this.currentTime=0;this.sampleRate=44100;this.destination=node('dest');}
  createOscillator(){made.osc++;return node('osc');}
  createGain(){made.gain++;return node('gain');}
  createBiquadFilter(){made.filter++;const n=node('filter');n.frequency=param(0);return n;}
  createBuffer(){return {getChannelData(){return new Float32Array(1);}};}
  createBufferSource(){made.osc++;return node('noise');}
}
const seededMath=Object.create(Math);seededMath.random=()=>.5;
const ctx={console,Math:seededMath,JSON,Float32Array,Map,Set,Proxy,Error,String,
  __TEST_SEED:17,AudioContext:FakeAudioContext,document:{getElementById:id=>id==='gl'?Object.assign(el(),{getContext:()=>gl}):el(),querySelectorAll:()=>[],createElement:el},
  addEventListener(){},matchMedia:()=>({matches:false}),innerWidth:1200,innerHeight:800,devicePixelRatio:1,
  performance:{now:()=>0},requestAnimationFrame(){},setTimeout(){return 0;},clearTimeout(){},
  setInterval:fn=>{intervals.push(fn);return intervals.length;},clearInterval(){}};
vm.createContext(ctx);vm.runInContext(js,ctx,{filename:'hunt.js'});
function tick(seconds){for(let i=0;i<Math.round(seconds*10);i++){ctx.AC_TIME=(ctx.AC_TIME||0)+.1;vm.runInContext('AC.currentTime=AC_TIME;for(const f of __MUSIC_INTERVALS)f();',ctx);}}
vm.runInContext('this.__MUSIC_INTERVALS=[];',ctx);
// Bridge the host-side interval stub into the VM-visible driver.
ctx.__MUSIC_INTERVALS=intervals;
if(vm.runInContext("MUSIC.set('battle');",ctx)!==undefined){}
vm.runInContext('audioUnlock();',ctx);
vm.runInContext("MUSIC.set('title');",ctx);tick(3);
if(made.osc<3)throw Error('title scheduled no notes');
for(const st of ['prowl','battle','enrage','victory','defeat']){const before=made.osc;vm.runInContext(`MUSIC.set('${st}');`,ctx);tick(1);if(made.osc<=before)throw Error(st+' scheduled no notes');}
const total=made.osc+made.gain+made.filter;
if(total/8>40)throw Error('node creation rate exceeded: '+total+'/8s');
console.log('MUSIC TEST OK | oscillators:',made.osc,'gains:',made.gain,'filters:',made.filter);
