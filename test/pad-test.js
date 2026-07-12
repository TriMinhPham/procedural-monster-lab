// Gamepad regression test for hunt.html.  Like hunt-smoke, this runs the page
// in a deliberately small VM DOM/WebGL environment.
const fs=require('fs'),vm=require('vm');
const js=fs.readFileSync(__dirname+'/../hunt.html','utf8').split('<script>')[1].split('</script>')[0];
function el(){return {style:{},dataset:{},value:'0',checked:false,textContent:'',firstElementChild:{textContent:''},classList:{add(){},remove(){},toggle(){},contains(){return false;}},addEventListener(){},appendChild(){},setAttribute(){},querySelectorAll(){return[];},getBoundingClientRect(){return{left:0,top:0,width:1200,height:800};},setPointerCapture(){}};}
const gl=new Proxy({}, {get(_,p){if(p==='getShaderParameter'||p==='getProgramParameter')return()=>true;if(p==='getShaderInfoLog'||p==='getProgramInfoLog')return()=>'';if(p==='createShader'||p==='createProgram')return()=>({});if(p==='getUniformLocation')return(p,n)=>n;if(p==='getParameter')return()=>512;if(typeof p==='string'&&/^[A-Z_]+$/.test(p))return 1;return()=>{};}});
const canvas=Object.assign(el(),{width:1200,height:800,getContext:()=>gl});
const pad={axes:[.8,0,0,0],buttons:Array.from({length:17},()=>({pressed:false}))};pad.buttons[0].pressed=true;
const ctx={console,Math,JSON,Float32Array,Map,Set,Proxy,Error,String,devicePixelRatio:1,innerWidth:1200,innerHeight:800,
  window:{ontouchstart:null},navigator:{getGamepads:()=>[pad]},location:{search:'?seed=7',pathname:'hunt.html'},
  document:{body:el(),getElementById:id=>id==='gl'?canvas:el(),createElement:()=>el(),querySelectorAll:()=>[]},
  addEventListener(){},performance:{now:()=>ctx.__t},requestAnimationFrame:cb=>{ctx.__raf=cb;},__t:0,__raf:null,__timers:[]};
ctx.setTimeout=(cb,ms)=>{ctx.__timers.push({cb,at:ctx.__t+(ms||0)});return 0;};ctx.clearTimeout=()=>{};
vm.createContext(ctx);vm.runInContext(js,ctx,{filename:'hunt.js'});
vm.runInContext(`
  function __drive(n){for(let i=0;i<n;i++){__t+=16.6;const due=__timers.filter(x=>x.at<=__t);__timers=__timers.filter(x=>x.at>__t);for(const x of due)x.cb();const cb=__raf;__raf=null;if(cb)cb(__t);}}
`,ctx);
vm.runInContext(`
  const before=player.target.slice();__drive(4);
  if(player.moveDir[0]===0&&player.moveDir[2]===0)throw new Error('gamepad left stick did not move player');
  if(player.target[0]===before[0]&&player.target[2]===before[2])throw new Error('gamepad movement did not change target');
  if(player.act!=='strike')throw new Error('gamepad A did not start a strike');
  const target=player.target.slice();player.act=null;player.moveDir=V();game.board=true;navigator.getGamepads=()=>[{axes:[0,0,0,0],buttons:Array.from({length:17},()=>({pressed:false}))}];
  for(let i=0;i<4;i++)updInput(.016);
  if(player.target[0]!==target[0]||player.target[2]!==target[2])throw new Error('gamepad input leaked through board');
`,ctx);
console.log('pad-test: ok');
