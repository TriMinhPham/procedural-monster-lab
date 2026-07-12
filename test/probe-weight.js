const fs=require('fs'),vm=require('vm');
const html=fs.readFileSync(process.env.PROBE_SRC||__dirname+'/../visual-lab.html','utf8');
const js=html.split('<script>')[1].split('</script>')[0];
function el(){return {style:{},dataset:{},value:'0',checked:false,firstElementChild:{textContent:''},classList:{add(){},toggle(){},remove(){},contains(){return false;}},addEventListener(){},appendChild(){},setAttribute(){},getBoundingClientRect(){return {left:0,top:0,width:1200,height:800};},setPointerCapture(){}};}
const gl=new Proxy({}, {get(_,p){if(p==='getShaderParameter'||p==='getProgramParameter')return()=>true;if(p==='getShaderInfoLog'||p==='getProgramInfoLog')return()=>'';if(p==='createShader'||p==='createProgram')return()=>({});if(p==='getUniformLocation')return(p,n)=>n;if(typeof p==='string'&&/^[A-Z_]+$/.test(p))return 1;return()=>{};}});
const canvas=Object.assign(el(),{width:0,height:0,getContext:()=>gl});
const ctx={console,Math,JSON,Float32Array,Map,Proxy,Error,URLSearchParams,document:{getElementById:id=>id==='gl'?canvas:el(),querySelectorAll:()=>[],createElement:()=>el()},matchMedia:()=>({matches:false}),addEventListener(){},innerWidth:1200,innerHeight:800,devicePixelRatio:1,location:{search:''},performance:{now:()=>ctx.__t},requestAnimationFrame:cb=>{ctx.__raf=cb;},__t:0,__raf:null};
vm.createContext(ctx);vm.runInContext(js,ctx,{filename:'visual-lab.js'});
vm.runInContext(`
function drive(n,fn){for(let i=0;i<n;i++){__t+=16.6;const cb=__raf;__raf=null;cb(__t);if(fn)fn(i);}}
function run(name,target,n,impact,verbose=true){initCreature(name);P.impact=impact;P.bob=0;st.roam=false;st.target=target;let min=1e9,max=-1e9,mean=0,gsum=0,rollMin=1e9,rollMax=-1e9,speedMax=0,drops=[];let was=[],pending=[],wmn=1e9,wmx=-1e9,wplants=[];
  drive(n,i=>{min=Math.min(min,st.chest[1]);max=Math.max(max,st.chest[1]);mean+=st.chest[1];gsum+=st.gallop;rollMin=Math.min(rollMin,st.roll);rollMax=Math.max(rollMax,st.roll);speedMax=Math.max(speedMax,st.speedN);wmn=Math.min(wmn,st.chest[1]);wmx=Math.max(wmx,st.chest[1]);for(const q of pending){q.age++;q.min=Math.min(q.min,st.chest[1]);}pending=pending.filter(q=>{if(q.age>=20){drops.push(q.pre-q.min);return false;}return true;});for(const l of st.legs){const old=was[l.u+' '+l.s];if(old&&old.stepping&&!l.stepping&&l.u<.5){const q={f:i,pre:st.chest[1],min:st.chest[1],age:0};pending.push(q);wplants.push(q);}was[l.u+' '+l.s]={stepping:l.stepping};}if(verbose&&i%50===49){const dip=wplants.length?Math.max(...wplants.map(p=>p.pre-p.min)):0;console.log(name,'window',i-49+'-'+i,'chest',wmn.toFixed(4),wmx.toFixed(4),'post-plant dip',dip.toFixed(4));wmn=1e9;wmx=-1e9;wplants=[];}});
  drops=drops.filter(v=>typeof v==='number'&&isFinite(v));mean/=n;console.log(name,'chest',min.toFixed(4),max.toFixed(4),'mean',mean.toFixed(4),'roll',rollMin.toFixed(4),rollMax.toFixed(4),'speedN',speedMax.toFixed(2),'fore drops',drops.slice(-8).map(v=>v.toFixed(4)).join(','));return {min,max,mean,meanG:gsum/n,rollMin,rollMax,drops};}
st.roam=false;
const d=run('diablos',[100,0,0],600,1);
const c=run('diablos',[100,0,0],600,0,false);
const diff=d.drops.reduce((a,v)=>a+v,0)/d.drops.length-c.drops.reduce((a,v)=>a+v,0)/c.drops.length;
console.log('impact differential dip',diff.toFixed(4),'mean sag',(c.mean-d.mean).toFixed(4));
const shoulderMax=d.rollMax*.5*.34;console.log('diablos shoulder shift target',shoulderMax.toFixed(4));
const dash=[];startAction('dash');drive(30,()=>dash.push(st.pitch));const dashMax=Math.max(...dash),dashEnd=dash[dash.length-1];console.log('diablos dash pitch',dashMax.toFixed(4),dashEnd.toFixed(4));
const s=run('skink',[100,0,0],600,.45);
startAction('rest');drive(300);console.log('rest roll/pitch',st.roll.toFixed(5),st.pitch.toFixed(5),'chest',st.chest[1].toFixed(4));
function check(ok,label){console.log((ok?'PASS ':'FAIL ')+label);}
check(d.rollMax-d.rollMin>.14&&d.rollMax<.13&&d.rollMin>-.13,'diablos roll reaches gait sway');
check(shoulderMax>.014&&shoulderMax<.020,'shoulder shift reaches target magnitude');
check(s.rollMax-s.rollMin<d.rollMax-d.rollMin*.75,'skink roll is smaller');
check(diff>.012&&diff<.03,'impact differential is 1.5-4% of diablos chestH');
const sagLim=d.meanG>.5?.036:.016; // paired 1.2x kicks at gallop carry the run lower
check(Math.abs(c.mean-d.mean)<sagLim,'impact mean sag under budget ('+(d.meanG>.5?'gallop 4.5%':'trot 2%')+' of chestH)');
check(s.drops.reduce((a,v)=>a+v,0)/s.drops.length<diff*.45,'skink impact is several times smaller');
check(dashMax>=.05&&dashEnd<dashMax,'dash nose-up pitch then settles');
check(Math.abs(st.roll)<.01&&Math.abs(st.pitch)<.01,'rest settles roll and pitch');
`,ctx,{filename:'probe-driver.js'});
