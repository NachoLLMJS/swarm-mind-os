import * as THREE from 'three';
import './style.css';

const stage = document.querySelector('#swarmCanvas');
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(42, 1, .1, 100);
camera.position.set(0, 0, 13.2);
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.8));
renderer.setClearColor(0x000000, 0);
stage.appendChild(renderer.domElement);

const cyan = new THREE.Color('#66e7e2');
const pale = new THREE.Color('#d6fffb');
const mint = new THREE.Color('#61f39c');
const lineMat = new THREE.LineBasicMaterial({ color: 0x5bbfbb, transparent: true, opacity: .34, blending: THREE.AdditiveBlending });
const brightLineMat = new THREE.LineBasicMaterial({ color: 0x22d9d2, transparent: true, opacity: .68, blending: THREE.AdditiveBlending });

function seeded(seed){ let x = Math.sin(seed * 991.73) * 43758.5453; return () => { x = Math.sin(x * 12.9898 + 78.233) * 43758.5453; return x - Math.floor(x); }; }
function addCloud(group, center, scale, count, seed, color = pale, alpha = .78, shell = false){
  const rand = seeded(seed), pts = [], links = [];
  for(let i=0;i<count;i++){
    const u=rand()*2-1, theta=rand()*Math.PI*2, radial=shell ? .82+rand()*.18 : Math.cbrt(rand());
    const q=Math.sqrt(1-u*u), x=Math.cos(theta)*q*radial*scale.x+center.x, y=u*radial*scale.y+center.y, z=Math.sin(theta)*q*radial*scale.z+center.z;
    pts.push(x,y,z);
    if(i>2){
      let nearest=-1, nearestD=Infinity;
      for(let j=Math.max(0,i-24);j<i;j++){
        const dx=x-pts[j*3],dy=y-pts[j*3+1],dz=z-pts[j*3+2],d=dx*dx+dy*dy+dz*dz;
        if(d<nearestD){nearestD=d;nearest=j;}
      }
      if(nearest>=0 && (i%2===0 || nearestD<.045)) links.push(x,y,z,pts[nearest*3],pts[nearest*3+1],pts[nearest*3+2]);
    }
  }
  const geo=new THREE.BufferGeometry(); geo.setAttribute('position',new THREE.Float32BufferAttribute(pts,3));
  const mat=new THREE.PointsMaterial({color,size:.035,transparent:true,opacity:alpha,depthWrite:false,blending:THREE.AdditiveBlending}); group.add(new THREE.Points(geo,mat));
  const lgeo=new THREE.BufferGeometry(); lgeo.setAttribute('position',new THREE.Float32BufferAttribute(links,3)); group.add(new THREE.LineSegments(lgeo,lineMat.clone()));
}
function addCurve(group, points, glow=false){ const curve=new THREE.CatmullRomCurve3(points); const geo=new THREE.BufferGeometry().setFromPoints(curve.getPoints(20)); group.add(new THREE.Line(geo,glow?brightLineMat.clone():lineMat.clone())); }
function createFly(seed=1){
  const fly=new THREE.Group();
  addCloud(fly,new THREE.Vector3(0,0,0),new THREE.Vector3(.48,.54,.38),115,seed+1,pale,.9,true);
  addCloud(fly,new THREE.Vector3(0,-.82,.02),new THREE.Vector3(.42,.9,.34),180,seed+2,cyan,.78,true);
  addCloud(fly,new THREE.Vector3(0,.55,.02),new THREE.Vector3(.38,.35,.34),90,seed+3,pale,.92,true);
  addCloud(fly,new THREE.Vector3(-.34,.65,.24),new THREE.Vector3(.17,.16,.12),32,seed+4,mint,1,true);
  addCloud(fly,new THREE.Vector3(.34,.65,.24),new THREE.Vector3(.17,.16,.12),32,seed+5,mint,1,true);
  // Four translucent, veined wings built from point-shell ellipsoids.
  const wingDefs=[[-.58,.15,-.02,.88,.42,.08],[.58,.15,-.02,.88,.42,.08],[-.54,-.30,-.05,.72,.33,.07],[.54,-.30,-.05,.72,.33,.07]];
  wingDefs.forEach((w,i)=>{
    const side=Math.sign(w[0]), wing=new THREE.Group();
    wing.position.set(w[0],w[1],w[2]);
    wing.rotation.z=side*(i<2?-.52:-.78);
    addCloud(wing,new THREE.Vector3(),new THREE.Vector3(w[3],w[4],w[5]),125,seed+10+i,pale,.55,true);
    const edge=[]; for(let n=0;n<=40;n++){const a=n/40*Math.PI*2;edge.push(new THREE.Vector3(Math.cos(a)*w[3],Math.sin(a)*w[4],0));}
    wing.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(edge),brightLineMat.clone()));
    fly.add(wing);
  });
  // Antennae.
  addCurve(fly,[new THREE.Vector3(-.16,.78,0),new THREE.Vector3(-.38,1.08,.02),new THREE.Vector3(-.58,1.18,.02)]);
  addCurve(fly,[new THREE.Vector3(.16,.78,0),new THREE.Vector3(.38,1.08,.02),new THREE.Vector3(.58,1.18,.02)]);
  // Six angular insect legs.
  [-1,1].forEach(side=>{
    [[.05,-.15,.0],[0,-.55,.05],[-.1,-.95,-.02]].forEach((o,i)=>{
      addCurve(fly,[new THREE.Vector3(side*.25,o[0],.05),new THREE.Vector3(side*(.66+i*.12),o[1],.02),new THREE.Vector3(side*(.98+i*.18),o[2],0)],i===1);
    });
  });
  // Body spine and wing veins.
  addCurve(fly,[new THREE.Vector3(0,.72,.12),new THREE.Vector3(0,0,.12),new THREE.Vector3(0,-1.55,.08)],true);
  return fly;
}

const flies=[];
const placements=[[-3.25,1.9,.15,1.05,.10],[3.15,1.95,-.1,.9,-.16],[-3.25,-1.65,.05,.92,-.22],[3.25,-1.65,.12,.95,.20],[0,-2.62,-.2,.85,.03]];
placements.forEach((p,i)=>{const f=createFly(100+i*30);f.position.set(p[0],p[1],p[2]);f.scale.setScalar(p[3]);f.rotation.z=p[4];scene.add(f);flies.push(f)});

const core=createFly(900); core.scale.setScalar(.42); core.rotation.z=Math.PI; core.position.set(0,.05,.2); scene.add(core);
const routePts=[]; placements.forEach(p=>routePts.push(new THREE.Vector3(p[0]*.74,p[1]*.74,0),new THREE.Vector3(0,.05,0))); const routeGeo=new THREE.BufferGeometry().setFromPoints(routePts); const routes=new THREE.LineSegments(routeGeo,brightLineMat); scene.add(routes);
const dustGeo=new THREE.BufferGeometry(), dust=[]; const rand=seeded(88); for(let i=0;i<850;i++)dust.push((rand()-.5)*18,(rand()-.5)*10,(rand()-.5)*2); dustGeo.setAttribute('position',new THREE.Float32BufferAttribute(dust,3)); const dustPoints=new THREE.Points(dustGeo,new THREE.PointsMaterial({color:0x1bded7,size:.016,transparent:true,opacity:.65,depthWrite:false,blending:THREE.AdditiveBlending})); scene.add(dustPoints);

function resize(){const r=stage.getBoundingClientRect();renderer.setSize(r.width,r.height,false);camera.aspect=r.width/r.height;camera.updateProjectionMatrix()}
addEventListener('resize',resize);resize();
const startedAt=performance.now();
function animate(){const t=(performance.now()-startedAt)/1000;flies.forEach((f,i)=>{f.position.y=placements[i][1]+Math.sin(t*1.2+i)*.055;f.rotation.y=Math.sin(t*.6+i)*.09});core.rotation.y=t*.18;routes.material.opacity=.45+Math.sin(t*2)*.16;dustPoints.rotation.z=t*.006;renderer.render(scene,camera);requestAnimationFrame(animate)}animate();

// Small independent fly schematic.
const mini=document.querySelector('#miniFly'); const miniRenderer=new THREE.WebGLRenderer({antialias:true,alpha:true});miniRenderer.setPixelRatio(1);mini.appendChild(miniRenderer.domElement);const miniScene=new THREE.Scene(),miniCam=new THREE.PerspectiveCamera(45,1,.1,20);miniCam.position.z=6;const mf=createFly(444);mf.scale.setScalar(.9);mf.rotation.z=-.28;miniScene.add(mf);function resizeMini(){const r=mini.getBoundingClientRect();miniRenderer.setSize(r.width,r.height,false);miniCam.aspect=r.width/r.height;miniCam.updateProjectionMatrix()}resizeMini();
(function miniLoop(){mf.rotation.y=Math.sin((performance.now()-startedAt)/1500)*.22;miniRenderer.render(miniScene,miniCam);requestAnimationFrame(miniLoop)})();

// Oscilloscope.
const sig=document.querySelector('#signalCanvas'),ctx=sig.getContext('2d');let phase=0;function signal(){const w=sig.width,h=sig.height;ctx.clearRect(0,0,w,h);ctx.strokeStyle='#19d6d0';ctx.lineWidth=1;ctx.beginPath();for(let x=0;x<w;x++){const spike=Math.sin((x+phase)*.47)*7+Math.sin((x+phase)*.12)*4+(x%37===0?18:0);const y=h/2+spike*(.35+.65*Math.sin((x+phase)*.023)**2);x?ctx.lineTo(x,y):ctx.moveTo(x,y)}ctx.stroke();phase+=1.4;requestAnimationFrame(signal)}signal();

const toast=document.querySelector('#toast');let toastTimer;function showToast(msg){toast.textContent=msg;toast.classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>toast.classList.remove('show'),2600)}
const tokenInput=document.querySelector('#tokenInput'),amountInput=document.querySelector('#amountInput'),routeBtn=document.querySelector('#routeBtn'),formStatus=document.querySelector('#formStatus');
routeBtn.addEventListener('click',()=>{const token=tokenInput.value.trim(),amount=Number(amountInput.value);if(!/^0x[a-fA-F0-9]{40}$/.test(token)){formStatus.textContent='Enter a valid 42-character token address';showToast('Invalid Robinhood Chain token address');return}if(!Number.isFinite(amount)||amount<=0){formStatus.textContent='Enter the ETH amount to research';return}formStatus.textContent='Target accepted · swarm research can begin';showToast('Research target staged — no transaction submitted')});
const commandInput=document.querySelector('#commandInput'),sendBtn=document.querySelector('#sendBtn'),chatHistory=[];
function appendLog(name,text,final=false){const p=document.createElement('p');if(final)p.classList.add('swarm-final');const now=new Date().toLocaleTimeString('en-GB',{hour12:false});p.innerHTML=`<time>${now}</time><i></i><b></b><span></span>`;p.querySelector('b').textContent=name;p.querySelector('span').textContent=text;const log=document.querySelector('#logLines');log.appendChild(p);log.scrollTop=log.scrollHeight}
async function sendCommand(){const text=commandInput.value.trim();if(!text||commandInput.disabled)return;appendLog('YOU',text);chatHistory.push({role:'user',content:text});commandInput.value='';commandInput.disabled=true;sendBtn.disabled=true;showToast('The swarm is reasoning…');try{const response=await fetch('/api/swarm',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({message:text,history:chatHistory.slice(-8,-1),target:tokenInput.value.trim(),amount:amountInput.value})});const data=await response.json();if(!response.ok)throw new Error(data.message||'The swarm could not answer.');for(const agent of data.agents||[])appendLog(agent.name,agent.text);appendLog('SWARM',data.answer||'No final answer returned.',true);chatHistory.push({role:'assistant',content:data.answer||''});showToast(`Swarm response · ${data.model||'OpenAI'}`)}catch(error){appendLog('SYSTEM',error.message||'AI service unavailable.',true);showToast(error.message||'AI service unavailable.')}finally{commandInput.disabled=false;sendBtn.disabled=false;commandInput.focus()}}
sendBtn.addEventListener('click',sendCommand);commandInput.addEventListener('keydown',e=>{if(e.key==='Enter')sendCommand()});
