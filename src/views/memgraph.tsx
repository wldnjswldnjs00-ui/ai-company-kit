import type { FC } from "hono/jsx";
import { raw } from "hono/html";
import type { Department } from "../db";
import type { Knowledge } from "../company/memory";
import { isPlaybook, PLAYBOOK_PREFIX } from "../company/playbooks";

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

export function graphData(company: string, departments: Pick<Department, "id" | "name">[], items: Knowledge[]): GraphData {
  return {
    company,
    departments: departments.map((d) => ({ id: d.id, name: d.name })),
    memories: items.map((m) => ({
      d: m.department,
      k: isPlaybook(m.content) ? "playbook" : m.kind,
      w: m.weight,
      t: (isPlaybook(m.content) ? m.content.slice(PLAYBOOK_PREFIX.length) : m.content).slice(0, 160),
    })),
  };
}

// JSON inside <script> must never contain "</script>".
export function safeJson(value: unknown): string {
  return JSON.stringify(value).replaceAll("<", "\\u003c");
}

const SCRIPT = `(function(){
var root=document.getElementById('memgraph');if(!root)return;
var data=JSON.parse(document.getElementById('memgraph-data').textContent);
var COLORS={};${MEMORY_KINDS.map(([k, , c]) => `COLORS.${k}='${c}';`).join("")}
var LABELS={};${MEMORY_KINDS.map(([k, l]) => `LABELS.${k}='${l}';`).join("")}
var canvas=root.querySelector('canvas'),ctx=canvas.getContext('2d'),tip=root.querySelector('.mg-tip');
var nodes=[],edges=[];
function rnd(i){var x=Math.sin(i*12.9898+78.233)*43758.5453;return x-Math.floor(x);}
var center={x:0,y:0,z:0,r:9,hub:true,label:data.company,color:'#ffffff'};nodes.push(center);
var used=data.departments.filter(function(d){return data.memories.some(function(m){return m.d===d.id;});});
if(!used.length)used=data.departments.slice(0,8);
var hubs={};var R=used.length>1?(used.length>5?200:170):0;
used.forEach(function(d,i){var a=i/used.length*Math.PI*2;var h={x:Math.cos(a)*R,y:(rnd(i+1)-.5)*70,z:Math.sin(a)*R,r:6,hub:true,label:d.name,color:'#e8e8ee'};hubs[d.id]=h;nodes.push(h);edges.push([center,h,.28]);});
data.memories.forEach(function(m,i){var h=(m.d&&hubs[m.d])||center;var u=rnd(i*3+7)*Math.PI*2,v=Math.acos(2*rnd(i*5+3)-1),s=30+rnd(i*7+1)*46;
var n={x:h.x+s*Math.sin(v)*Math.cos(u),y:h.y+s*Math.cos(v),z:h.z+s*Math.sin(v)*Math.sin(u),r:2.2+Math.min(m.w||1,6)*.55,color:COLORS[m.k]||'#aaaaaa',m:m,hubName:h.label};nodes.push(n);edges.push([h,n,.11]);});
var yaw=.6,pitch=-.32,auto=!window.matchMedia('(prefers-reduced-motion: reduce)').matches,drag=null,hover=null,W=0,H=0,dpr=1;
function size(){dpr=window.devicePixelRatio||1;W=root.clientWidth;H=canvas.clientHeight;canvas.width=W*dpr;canvas.height=H*dpr;ctx.setTransform(dpr,0,0,dpr,0,0);}
function project(n){var cy=Math.cos(yaw),sy=Math.sin(yaw),cp=Math.cos(pitch),sp=Math.sin(pitch);
var x=n.x*cy-n.z*sy,z=n.x*sy+n.z*cy;var y=n.y*cp-z*sp;z=n.y*sp+z*cp;var scale=Math.min(W/(W<520?470:600),H/300),f=700/(700+z);
n.sx=W/2+x*f*scale;n.sy=H/2+y*f*scale;n.sz=z;n.sf=f;}
function frame(){if(auto&&!drag&&!hover)yaw+=.0016;
nodes.forEach(project);ctx.clearRect(0,0,W,H);
if(R){[1,.55].forEach(function(k,ri){ctx.beginPath();for(var i=0;i<=72;i++){var a=i/72*Math.PI*2,p={x:Math.cos(a)*R*k,y:ri?40:0,z:Math.sin(a)*R*k};project(p);if(i)ctx.lineTo(p.sx,p.sy);else ctx.moveTo(p.sx,p.sy);}ctx.setLineDash(ri?[2,6]:[]);ctx.strokeStyle='rgba(255,255,255,'+(ri?.07:.1)+')';ctx.lineWidth=1;ctx.stroke();});ctx.setLineDash([]);}
edges.forEach(function(e){var a=e[0],b=e[1],d=Math.max(.15,Math.min(1,(700-(a.sz+b.sz)/2)/900));ctx.strokeStyle='rgba(255,255,255,'+(e[2]*d)+')';ctx.lineWidth=e[2]>.2?1.2:.8;ctx.beginPath();ctx.moveTo(a.sx,a.sy);ctx.lineTo(b.sx,b.sy);ctx.stroke();});
var order=nodes.slice().sort(function(a,b){return b.sz-a.sz;});
order.forEach(function(n){var depth=Math.max(.25,Math.min(1,(620-n.sz)/780)),r=n.r*n.sf*(n===hover?1.8:1);
if(n.hub){ctx.fillStyle='#16161a';ctx.strokeStyle='rgba(255,255,255,'+(.5+.5*depth)+')';ctx.lineWidth=1.5;ctx.beginPath();ctx.arc(n.sx,n.sy,r+3,0,7);ctx.fill();ctx.stroke();
ctx.fillStyle=n.color;ctx.beginPath();ctx.arc(n.sx,n.sy,r*.45,0,7);ctx.fill();
ctx.font=(n===center?'700 13px ':(W<520?'600 11px ':'600 12px '))+'-apple-system,"Apple SD Gothic Neo","Noto Sans KR",sans-serif';ctx.textAlign='center';
ctx.fillStyle='rgba(255,255,255,'+(.45+.55*depth)+')';ctx.fillText(n.label,n.sx,n.sy-r-9);return;}
var g=ctx.createRadialGradient(n.sx,n.sy,0,n.sx,n.sy,r*3.2);g.addColorStop(0,n.color);g.addColorStop(.35,n.color);g.addColorStop(1,'rgba(0,0,0,0)');
ctx.globalAlpha=depth*.5;ctx.fillStyle=g;ctx.beginPath();ctx.arc(n.sx,n.sy,r*3.2,0,7);ctx.fill();
ctx.globalAlpha=Math.min(1,depth+.15);ctx.fillStyle=n.color;ctx.beginPath();ctx.arc(n.sx,n.sy,r,0,7);ctx.fill();ctx.globalAlpha=1;});
requestAnimationFrame(frame);}
function pick(px,py){var best=null,bd=1e9;nodes.forEach(function(n){if(!n.m)return;var dx=n.sx-px,dy=n.sy-py,d=dx*dx+dy*dy,lim=Math.max(9,n.r*n.sf*2.4);if(d<lim*lim&&d<bd){bd=d;best=n;}});return best;}
function esc(s){return String(s).replace(/[&<>"]/g,function(c){return{'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c];});}
function showTip(n,px,py){if(!n){tip.style.opacity=0;return;}tip.innerHTML='<b style="color:'+n.color+'">'+esc(LABELS[n.m.k]||'')+'</b> · '+esc(n.hubName)+'<div>'+esc(n.m.t)+'</div>';
var x=Math.min(px+14,W-tip.offsetWidth-8),y=py+14;if(y+tip.offsetHeight>H-8)y=py-tip.offsetHeight-14;tip.style.left=Math.max(8,x)+'px';tip.style.top=Math.max(8,y)+'px';tip.style.opacity=1;}
function pos(e){var b=canvas.getBoundingClientRect();return[e.clientX-b.left,e.clientY-b.top];}
canvas.addEventListener('pointerdown',function(e){drag=pos(e).concat([yaw,pitch]);canvas.setPointerCapture(e.pointerId);});
canvas.addEventListener('pointermove',function(e){var p=pos(e);if(drag){yaw=drag[2]+(p[0]-drag[0])*.008;pitch=Math.max(-1.2,Math.min(1.2,drag[3]+(p[1]-drag[1])*.006));showTip(null);return;}hover=pick(p[0],p[1]);showTip(hover,p[0],p[1]);});
canvas.addEventListener('pointerup',function(e){var p=pos(e),moved=drag&&Math.abs(p[0]-drag[0])+Math.abs(p[1]-drag[1])>4;drag=null;if(!moved){hover=pick(p[0],p[1]);showTip(hover,p[0],p[1]);}});
canvas.addEventListener('pointercancel',function(){drag=null;});
canvas.addEventListener('pointerleave',function(){if(!drag){hover=null;showTip(null);}});
window.addEventListener('resize',size);size();requestAnimationFrame(frame);
})();`;

export const MemoryGraph: FC<{ data: GraphData }> = ({ data }) => (
  <div class="mg-card">
    <div class="mg-head">
      <div>
        <div class="mg-title">기억 지도</div>
        <div class="mg-sub">
          기억 {data.memories.length}개 · 부서 {new Set(data.memories.map((m) => m.d).filter(Boolean)).size}곳 · 드래그해서 돌려 보고, 점을 누르면 내용이 보입니다
        </div>
      </div>
    </div>
    <div id="memgraph" class="mg-stage">
      <canvas />
      <div class="mg-tip" />
    </div>
    <div class="mg-legend">
      {MEMORY_KINDS.map(([, label, color]) => (
        <span>
          <i style={`background:${color};box-shadow:0 0 10px ${color}`} />
          {label}
        </span>
      ))}
    </div>
    <script type="application/json" id="memgraph-data">
      {raw(safeJson(data))}
    </script>
    <script>{raw(SCRIPT)}</script>
  </div>
);

export const MEMGRAPH_CSS = `
.mg-card{position:relative;border-radius:20px;overflow:hidden;margin:6px 0 18px;background:#0c0c0f;background-image:radial-gradient(rgba(255,255,255,.09) 1px,transparent 1.2px);background-size:18px 18px;border:1px solid #1f1f25;box-shadow:0 18px 50px rgba(0,0,0,.18),inset 0 1px 0 rgba(255,255,255,.04)}
.mg-card:before{content:"";position:absolute;inset:0;background:radial-gradient(ellipse at 50% 45%,rgba(255,138,61,.10),transparent 60%);pointer-events:none}
.mg-head{position:relative;display:flex;justify-content:space-between;padding:18px 22px 0;color:#f2f2f5}
.mg-title{font-size:17px;font-weight:700;letter-spacing:-.01em}.mg-sub{font-size:12.5px;color:#8d8d97;margin-top:3px}
.mg-stage{position:relative}.mg-stage canvas{display:block;width:100%;height:460px;cursor:grab;touch-action:pan-y}.mg-stage canvas:active{cursor:grabbing}
.mg-tip{position:absolute;max-width:280px;padding:10px 12px;border-radius:12px;background:rgba(22,22,27,.92);border:1px solid #2c2c34;color:#e9e9ee;font-size:12.5px;line-height:1.5;pointer-events:none;opacity:0;transition:opacity .12s;backdrop-filter:blur(6px);box-shadow:0 8px 24px rgba(0,0,0,.35)}
.mg-tip div{margin-top:4px;color:#c9c9d1}
.mg-legend{position:relative;display:flex;flex-wrap:wrap;gap:6px 16px;padding:0 22px 18px;font-size:12.5px;color:#a9a9b3}
.mg-legend span{display:inline-flex;align-items:center;gap:7px}.mg-legend i{width:8px;height:8px;border-radius:50%}
@media (max-width:860px){.mg-stage canvas{height:320px}}
`;
