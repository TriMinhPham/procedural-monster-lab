// VM visual contract for the hunter forge tiers in hunt.html.
const fs=require('fs'),vm=require('vm');
const html=fs.readFileSync(__dirname+'/../hunt.html','utf8');
const js=html.split('<script>')[1].split('</script>')[0];
function el(){return {style:{},dataset:{},value:'0',checked:false,textContent:'',firstElementChild:{textContent:''},classList:{add(){},remove(){},toggle(){},contains(){return false;}},addEventListener(){},appendChild(){},setAttribute(){},getBoundingClientRect(){return {left:0,top:0,width:1200,height:800};},setPointerCapture(){}};}
const gl=new Proxy({}, {get(_,p){
  if(p==='getShaderParameter'||p==='getProgramParameter')return()=>true;
  if(p==='getShaderInfoLog'||p==='getProgramInfoLog')return()=>'';
  if(p==='createShader'||p==='createProgram')return()=>({});
  if(p==='getUniformLocation')return(p,n)=>n;
  return()=>{};
}});
const canvas=Object.assign(el(),{width:0,height:0,getContext:()=>gl});
const seededMath=Object.create(Math); let seed=0x51f0e; seededMath.random=()=>{
  seed|=0; seed=(seed+0x6d2b79f5)|0;
  let t=Math.imul(seed^(seed>>>15),1|seed); t=(t+Math.imul(t^(t>>>7),61|t))^t;
  return ((t^(t>>>14))>>>0)/4294967296;
};
const ctx={console,Math:seededMath,JSON,Float32Array,Map,Set,Proxy,Error,String,
  document:{getElementById:id=>id==='gl'?canvas:el(),querySelectorAll:()=>[],createElement:el},
  matchMedia:()=>({matches:false}),addEventListener(){},innerWidth:1200,innerHeight:800,devicePixelRatio:1,
  performance:{now:()=>ctx.__t},requestAnimationFrame:cb=>{ctx.__raf=cb;},__t:0,__raf:null,__timers:[]};
ctx.setTimeout=(cb,ms)=>{ctx.__timers.push({cb,at:ctx.__t+(ms||0)});return 0;};
ctx.clearTimeout=()=>{};
vm.createContext(ctx); vm.runInContext(js,ctx,{filename:'hunt.js'});
vm.runInContext(`
  function __driveForge(n){
    for(let i=0;i<n;i++){
      __t+=16.6;
      const due=__timers.filter(x=>x.at<=__t); __timers=__timers.filter(x=>x.at>__t);
      for(const x of due)x.cb();
      const cb=__raf; __raf=null; if(!cb)throw new Error('frame callback missing'); cb(__t);
    }
  }
  function __forgeSnapshot(){
    const all=[...player.segs.soft,...player.segs.hard,...boss.segs.soft,...boss.segs.hard];
    for(const s of all){
      for(const v of s)if(Array.isArray(v)){for(const n of v)if(!Number.isFinite(n))throw new Error('non-finite vector');}
      for(const n of s)if(typeof n==='number'&&!Number.isFinite(n))throw new Error('non-finite scalar');
    }
    return {hard:player.segs.hard.length,blade:Math.hypot(...sub(player.bladeB,player.bladeA))};
  }
`,ctx);
const snap=combo=>vm.runInContext(`WTIER=${combo[0]};ATIER=${combo[1]};__driveForge(60);__forgeSnapshot();`,ctx);
const records={};
const base=snap([0,0]); records['0/0']=base;
for(let w=0;w<=4;w++)for(let a=0;a<=3;a++){
  const s=snap([w,a]); records[`${w}/${a}`]=s;
}
const tier0=snap([0,0]);
if(tier0.hard!==base.hard||Math.abs(tier0.blade-base.blade)>1e-9)throw new Error('tier 0 visual delta');
const max=snap([4,3]);
if(max.hard-base.hard>10)throw new Error(`hard-cap growth exceeded: ${base.hard} -> ${max.hard}`);
const growth=(max.blade/base.blade-1)*100;
if(growth<18||growth>26)throw new Error(`blade growth out of range: ${growth}%`);
console.log('FORGE TEST OK | caps:',JSON.stringify(records),'| blade growth:',growth.toFixed(2)+'%');
