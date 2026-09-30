import type { FC } from "hono/jsx";
import { raw } from "hono/html";
import type { Department } from "../db";
import type { Knowledge } from "../company/memory";
import { isPlaybook, PLAYBOOK_PREFIX } from "../company/playbooks";
import { Icon } from "./icons";

// 기억 지도: the company's memory as a slowly turning 3D constellation.
// The company sits in the middle, departments around it, and each memory
// is a point near the department that learned it — coloured by kind,
// sized by how often it was confirmed. Drawn on a canvas with no library.

export const MEMORY_KINDS: [string, string, string][] = [
  ["lesson", "배운 점", "#ff8a3d"],
  ["fact", "사실", "#5aa9ff"],
  ["decision", "CEO 결정", "#3ddc97"],
  ["feedback", "CEO 피드백", "#c490ff"],
  ["playbook", "대응 매뉴얼", "#ffd166"],
];

export type GraphData = {
  company: string;
  departments: { id: string; name: string }[];
  memories: { d: string | null; k: string; w: number; t: string }[];
};

export function graphData(company: string, departments: Pick<Department, "id" | "name">[], items: Pick<Knowledge, "department" | "kind" | "content" | "weight">[]): GraphData {
  return {
    company,
    departments: departments.map((d) => ({ id: d.id, name: d.name })),
    memories: items.map((m) => ({
      d: m.department,
      k: isPlaybook(m.content) ? "playbook" : m.kind,
      w: m.weight,
      t: (isPlaybook(m.content) ? m.content.slice(PLAYBOOK_PREFIX.length) : m.content).slice(0, 140),
    })),
  };
}


const SCRIPT = `(function(){
var root=document.getElementById('memgraph');if(!root)return;
var sub=root.parentNode.querySelector('.mg-sub');
fetch(root.getAttribute('data-src'),{credentials:'same-origin'}).then(function(r){if(!r.ok)throw new Error(r.status);return r.json();}).then(start).catch(function(){sub.textContent='기억 지도를 불러오지 못했습니다. 새로고침해 보세요.';});
function start(data){
if(!data.memories.length){sub.textContent='아직 기억이 없습니다. 부서들이 일할수록 여기에 별이 하나씩 생깁니다.';return;}
sub.textContent='기억 '+data.memories.length+'개 · 부서 '+new Set(data.memories.map(function(m){return m.d;}).filter(Boolean)).size+'곳 · 드래그로 돌리고, 휠이나 두 손가락으로 확대해서 점을 누르세요';
root.classList.add('mg-ready');
var GLOWS={};function glow(c){if(GLOWS[c])return GLOWS[c];var o=document.createElement('canvas');o.width=o.height=64;var x=o.getContext('2d'),g=x.createRadialGradient(32,32,0,32,32,32);g.addColorStop(0,c);g.addColorStop(.35,c);g.addColorStop(1,'rgba(0,0,0,0)');x.fillStyle=g;x.fillRect(0,0,64,64);return GLOWS[c]=o;}
var COLORS={};${MEMORY_KINDS.map(([k, , c]) => `COLORS.${k}='${c}';`).join("")}
var LABELS={};${MEMORY_KINDS.map(([k, l]) => `LABELS.${k}='${l}';`).join("")}
var canvas=root.querySelector('canvas'),ctx=canvas.getContext('2d'),tip=root.querySelector('.mg-tip');
var nodes=[],edges=[];
function rnd(i){var x=Math.sin(i*12.9898+78.233)*43758.5453;return x-Math.floor(x);}
var center={x:0,y:0,z:0,r:9,hub:true,label:data.company,color:'#ffffff'};nodes.push(center);
var used=data.departments.filter(function(d){return data.memories.some(function(m){return m.d===d.id;});});
if(!used.length)used=data.departments.slice(0,8);
var hubs={};var RX=used.length>1?250:0,RY=used.length>1?150:0,RZ=used.length>1?200:0,R=RX;
used.forEach(function(d,i){var N=used.length,yy=N>1?1-2*(i+.5)/N:0,rr=Math.sqrt(1-yy*yy),th=i*2.39996;var h={x:Math.cos(th)*rr*RX,y:yy*RY,z:Math.sin(th)*rr*RZ,r:6,hub:true,label:d.name,color:'#e8e8ee'};hubs[d.id]=h;nodes.push(h);edges.push([center,h,.28]);});
var per={};data.memories.forEach(function(m){var k=(m.d&&hubs[m.d])?m.d:'';per[k]=(per[k]||0)+1;});var DENSE=Math.min(1,220/Math.max(1,data.memories.length));
data.memories.forEach(function(m,i){var h=(m.d&&hubs[m.d])||center;var spread=Math.min(1.6,Math.max(1,Math.sqrt((per[(m.d&&hubs[m.d])?m.d:'']||1)/25)));var u=rnd(i*3+7)*Math.PI*2,v=Math.acos(2*rnd(i*5+3)-1),s=(30+Math.pow(rnd(i*7+1),.6)*46)*spread;
var n={x:h.x+s*Math.sin(v)*Math.cos(u),y:h.y+s*Math.cos(v),z:h.z+s*Math.sin(v)*Math.sin(u),r:(2.2+Math.min(m.w||1,6)*.55)*(.55+.45*DENSE),color:COLORS[m.k]||'#aaaaaa',m:m,hubName:h.label};nodes.push(n);edges.push([h,n,.11]);});
var EXT_XZ=1,EXT_Y=1;nodes.forEach(function(n){EXT_XZ=Math.max(EXT_XZ,Math.sqrt(n.x*n.x+n.z*n.z));EXT_Y=Math.max(EXT_Y,Math.abs(n.y));});
var yaw=.6,pitch=-.32,auto=!window.matchMedia('(prefers-reduced-motion: reduce)').matches,drag=null,hover=null,W=0,H=0,dpr=1,zoom=1,panX=0,panY=0,pts={},pinch=null;
var ZMIN=.7,ZMAX=5;function zoomed(){return zoom>1.05;}
function size(){dpr=window.devicePixelRatio||1;W=root.clientWidth;H=canvas.clientHeight;canvas.width=W*dpr;canvas.height=H*dpr;ctx.setTransform(dpr,0,0,dpr,0,0);}
function project(n){var cy=Math.cos(yaw),sy=Math.sin(yaw),cp=Math.cos(pitch),sp=Math.sin(pitch);
var x=n.x*cy-n.z*sy,z=n.x*sy+n.z*cy;var y=n.y*cp-z*sp;z=n.y*sp+z*cp;var scale=Math.min(W*.5/EXT_XZ,H*.47/(EXT_Y+EXT_XZ*.33)),f=700/(700+z);
n.sx=W/2+panX+x*f*scale*zoom;n.sy=H/2+panY+y*f*scale*zoom;n.sz=z;n.sf=f*Math.sqrt(zoom);}
function zoomAt(nz,cx,cy){nz=Math.max(ZMIN,Math.min(ZMAX,nz));var bx=(cx-W/2-panX)/zoom,by=(cy-H/2-panY)/zoom;zoom=nz;panX=cx-W/2-bx*zoom;panY=cy-H/2-by*zoom;if(zoom<=1.05){panX*=zoom<1?1:0;panY*=zoom<1?1:0;}canvas.style.touchAction=zoomed()?'none':'pan-y';root.classList.toggle('mg-zoomed',zoomed());}
function resetView(){zoom=1;panX=0;panY=0;canvas.style.touchAction='pan-y';root.classList.remove('mg-zoomed');}
function frame(){if(auto&&!drag&&!hover&&!zoomed())yaw+=.0016;
nodes.forEach(project);ctx.clearRect(0,0,W,H);
if(R){[[1,0],[0,1],[0,2]].forEach(function(k,ri){ctx.beginPath();for(var i=0;i<=72;i++){var a=i/72*Math.PI*2,c=Math.cos(a),q=Math.sin(a),p=ri===0?{x:c*RX,y:0,z:q*RZ}:ri===1?{x:c*RX,y:q*RY,z:0}:{x:0,y:q*RY,z:c*RZ};project(p);if(i)ctx.lineTo(p.sx,p.sy);else ctx.moveTo(p.sx,p.sy);}ctx.setLineDash(ri?[2,6]:[]);ctx.strokeStyle='rgba(255,255,255,'+(ri?.07:.1)+')';ctx.lineWidth=1;ctx.stroke();});ctx.setLineDash([]);}
edges.forEach(function(e){var a=e[0],b=e[1],d=Math.max(.15,Math.min(1,(700-(a.sz+b.sz)/2)/900));ctx.strokeStyle='rgba(255,255,255,'+(e[2]*d*(e[2]>.2?1:DENSE))+')';ctx.lineWidth=e[2]>.2?1.2:.8;ctx.beginPath();ctx.moveTo(a.sx,a.sy);ctx.lineTo(b.sx,b.sy);ctx.stroke();});
var order=nodes.slice().sort(function(a,b){return b.sz-a.sz;});
order.forEach(function(n){var depth=Math.max(.25,Math.min(1,(620-n.sz)/780)),r=n.r*n.sf*(n===hover?1.8:1);
if(n.hub){ctx.fillStyle='#16161a';ctx.strokeStyle='rgba(255,255,255,'+(.5+.5*depth)+')';ctx.lineWidth=1.5;ctx.beginPath();ctx.arc(n.sx,n.sy,r+3,0,7);ctx.fill();ctx.stroke();
ctx.fillStyle=n.color;ctx.beginPath();ctx.arc(n.sx,n.sy,r*.45,0,7);ctx.fill();
n.depth=depth;n.lr=r;return;}
var gl=glow(n.color),gr=r*3.2;ctx.globalAlpha=depth*(.2+.3*DENSE);ctx.drawImage(gl,n.sx-gr,n.sy-gr,gr*2,gr*2);
ctx.globalAlpha=Math.min(1,depth+.15);ctx.fillStyle=n.color;ctx.beginPath();ctx.arc(n.sx,n.sy,r,0,7);ctx.fill();ctx.globalAlpha=1;});
ctx.textAlign='center';ctx.lineJoin='round';order.forEach(function(n){if(!n.hub)return;ctx.font=(n===center?'700 13px ':(W<520?'600 11px ':'600 12px '))+'-apple-system,"Apple SD Gothic Neo","Noto Sans KR",sans-serif';ctx.lineWidth=4;ctx.strokeStyle='rgba(12,12,15,.85)';ctx.strokeText(n.label,n.sx,n.sy-n.lr-9);ctx.fillStyle='rgba(255,255,255,'+(.55+.45*n.depth)+')';ctx.fillText(n.label,n.sx,n.sy-n.lr-9);});
requestAnimationFrame(frame);}
function pick(px,py){var best=null,bd=1e9;nodes.forEach(function(n){if(!n.m)return;var dx=n.sx-px,dy=n.sy-py,d=dx*dx+dy*dy,lim=Math.max(9,n.r*n.sf*2.4);if(d<lim*lim&&d<bd){bd=d;best=n;}});return best;}
function esc(s){return String(s).replace(/[&<>"]/g,function(c){return{'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c];});}
function showTip(n,px,py){if(!n){tip.style.opacity=0;return;}tip.innerHTML='<b style="color:'+n.color+'">'+esc(LABELS[n.m.k]||'')+'</b> · '+esc(n.hubName)+'<div>'+esc(n.m.t)+'</div>';
var x=Math.min(px+14,W-tip.offsetWidth-8),y=py+14;if(y+tip.offsetHeight>H-8)y=py-tip.offsetHeight-14;tip.style.left=Math.max(8,x)+'px';tip.style.top=Math.max(8,y)+'px';tip.style.opacity=1;}
function pos(e){var b=canvas.getBoundingClientRect();return[e.clientX-b.left,e.clientY-b.top];}
canvas.addEventListener('pointerdown',function(e){var p=pos(e);pts[e.pointerId]=p;canvas.setPointerCapture(e.pointerId);var ids=Object.keys(pts);
if(ids.length===2){var a=pts[ids[0]],b=pts[ids[1]];pinch={d:Math.hypot(a[0]-b[0],a[1]-b[1]),z:zoom};drag=null;return;}
drag=p.concat([yaw,pitch,panX,panY]);});
canvas.addEventListener('pointermove',function(e){var p=pos(e);if(pts[e.pointerId])pts[e.pointerId]=p;var ids=Object.keys(pts);
if(pinch&&ids.length===2){var a=pts[ids[0]],b=pts[ids[1]];zoomAt(pinch.z*Math.hypot(a[0]-b[0],a[1]-b[1])/pinch.d,(a[0]+b[0])/2,(a[1]+b[1])/2);showTip(null);return;}
if(drag){if(zoomed()){panX=drag[4]+(p[0]-drag[0]);panY=drag[5]+(p[1]-drag[1]);}else{yaw=drag[2]+(p[0]-drag[0])*.008;pitch=Math.max(-1.2,Math.min(1.2,drag[3]+(p[1]-drag[1])*.006));}showTip(null);return;}
hover=pick(p[0],p[1]);showTip(hover,p[0],p[1]);});
function lift(e){delete pts[e.pointerId];if(Object.keys(pts).length<2)pinch=null;}
canvas.addEventListener('pointerup',function(e){var p=pos(e),moved=drag&&Math.abs(p[0]-drag[0])+Math.abs(p[1]-drag[1])>4;var was=drag;drag=null;lift(e);if(was&&!moved){hover=pick(p[0],p[1]);showTip(hover,p[0],p[1]);}});
canvas.addEventListener('pointercancel',function(e){drag=null;lift(e);});
canvas.addEventListener('pointerleave',function(){if(!drag){hover=null;showTip(null);}});
canvas.addEventListener('dblclick',function(e){var p=pos(e);zoomAt(zoom*1.8,p[0],p[1]);});
// Mouse wheel and trackpad pinch (ctrl+wheel) zoom toward the pointer.
canvas.addEventListener('wheel',function(e){e.preventDefault();var p=pos(e),k=e.ctrlKey?.01:.0018;zoomAt(zoom*Math.exp(-e.deltaY*k),p[0],p[1]);},{passive:false});
root.querySelectorAll('[data-zoom]').forEach(function(btn){btn.addEventListener('click',function(){var z=btn.getAttribute('data-zoom');if(z==='reset')resetView();else zoomAt(zoom*(z==='in'?1.5:1/1.5),W/2,H/2);});});
window.addEventListener('resize',size);size();requestAnimationFrame(frame);
}})();`;

export const MemoryGraph: FC<{ src: string }> = ({ src }) => (
  <div class="mg-card">
    <div class="mg-head">
      <div>
        <div class="mg-title">기억 지도</div>
        <div class="mg-sub">기억을 불러오는 중…</div>
      </div>
    </div>
    <div id="memgraph" class="mg-stage" data-src={src}>
      <canvas />
      <div class="mg-tip" />
      <div class="mg-zoom">
        <button type="button" data-zoom="in" aria-label="확대">+</button>
        <button type="button" data-zoom="out" aria-label="축소">−</button>
        <button type="button" data-zoom="reset" aria-label="원래대로" title="원래대로">
          <Icon name="refresh" />
        </button>
      </div>
      <div class="mg-hint">확대하면 회전이 멈추고, 드래그로 이동합니다</div>
    </div>
    <div class="mg-legend">
      {MEMORY_KINDS.map(([, label, color]) => (
        <span>
          <i style={`background:${color};box-shadow:0 0 10px ${color}`} />
          {label}
        </span>
      ))}
    </div>
    <script>{raw(SCRIPT)}</script>
  </div>
);

export const MEMGRAPH_CSS = `
.mg-card{position:relative;border-radius:20px;overflow:hidden;margin:6px 0 18px;background:#0c0c0f;background-image:radial-gradient(rgba(255,255,255,.09) 1px,transparent 1.2px);background-size:18px 18px;border:1px solid #1f1f25;box-shadow:0 18px 50px rgba(0,0,0,.18),inset 0 1px 0 rgba(255,255,255,.04)}
.mg-card:before{content:"";position:absolute;inset:0;background:radial-gradient(ellipse at 50% 45%,rgba(255,138,61,.10),transparent 60%);pointer-events:none}
.mg-head{position:relative;display:flex;justify-content:space-between;padding:18px 22px 0;color:#f2f2f5}
.mg-title{font-size:17px;font-weight:700;letter-spacing:-.01em}.mg-sub{font-size:12.5px;color:#8d8d97;margin-top:3px}
.mg-stage{position:relative}.mg-stage .mg-zoom{opacity:0;transition:opacity .2s}.mg-stage.mg-ready .mg-zoom{opacity:1}.mg-stage canvas{display:block;width:100%;height:520px;cursor:grab;touch-action:pan-y}.mg-stage canvas:active{cursor:grabbing}
.mg-tip{position:absolute;max-width:280px;padding:10px 12px;border-radius:12px;background:rgba(22,22,27,.92);border:1px solid #2c2c34;color:#e9e9ee;font-size:12.5px;line-height:1.5;pointer-events:none;opacity:0;transition:opacity .12s;backdrop-filter:blur(6px);box-shadow:0 8px 24px rgba(0,0,0,.35)}
.mg-tip div{margin-top:4px;color:#c9c9d1}
.mg-legend{position:relative;display:flex;flex-wrap:wrap;gap:6px 16px;padding:0 22px 18px;font-size:12.5px;color:#a9a9b3}
.mg-legend span{display:inline-flex;align-items:center;gap:7px}.mg-legend i{width:8px;height:8px;border-radius:50%}
.mg-zoom{position:absolute;right:16px;top:12px;display:flex;flex-direction:column;gap:6px}
.mg-zoom button{width:34px;height:34px;padding:0;border-radius:10px;background:rgba(28,28,34,.85);border:1px solid #33333c;color:#e9e9ee;font:500 18px/1 -apple-system,sans-serif;display:flex;align-items:center;justify-content:center;cursor:pointer}
.mg-zoom button:hover{background:#2a2a32}.mg-zoom .ic{width:15px;height:15px;vertical-align:0}
.mg-hint{position:absolute;left:50%;bottom:10px;transform:translateX(-50%);font-size:12px;color:#9a9aa3;background:rgba(20,20,25,.8);padding:4px 10px;border-radius:999px;opacity:0;transition:opacity .2s;pointer-events:none}
.mg-zoomed .mg-hint{opacity:1}.mg-zoomed canvas{cursor:move}
@media (max-width:860px){.mg-stage canvas{height:420px}}
`;
