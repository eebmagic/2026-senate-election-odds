import{SOLID_SEATS as D,STATE_NAMES as V,colorForDemProb as X,fmtPct as B,seatPartyResolved as N,isMaterialIndependent as A,raceAxisProb as C,raceLeader as Y,raceHasPendingPrimary as Z,STRONG_LEAN as J,isTouchDevice as U,HIDE_DELAY_MS as Q}from"./senate-shared.js";import{renderMap as ee}from"./map.js";const H=130,E=.9,te=.45,M=900,_=60;function w(e){return String(e).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;")}function ne(e){return e.party!==void 0?`<span class="value split"><span class="party">${w(e.party)}</span><span class="pct">${w(e.pct)}</span></span>`:`<span class="value">${w(e.value)}</span>`}function se(e){const t=e.rows.map(n=>`<div class="row"><span>${w(n.label)}</span>${ne(n)}</div>`).join(""),s=e.href?`<a class="hint" href="${w(e.href)}" target="_blank" rel="noopener noreferrer">${U?"Tap again to view on ":"Click to view on "}<span class="hint-link">Kalshi \u2197</span></a>`:"";return`<div class="title">${w(e.title)}</div><div class="rows">${t}</div>${s}`}function j(e,t,{anchorToRow:s=!1}={}){let n=!1,p=null,u=null,l=null;function f(){l!==null&&(clearTimeout(l),l=null)}function b(){f(),l=setTimeout(d,Q)}function m(r,c,a){f(),n=!0,u=a||null,t.innerHTML=se(r),t.classList.toggle("scrollable",!!r.scrollable),t.style.display="block",s&&a?v(a):(t.classList.remove("below"),h(c))}function h(r){if(!n||s||r.type==="mousemove"&&t.classList.contains("scrollable"))return;const c=e.getBoundingClientRect();t.style.left=r.clientX-c.left+"px",t.style.top=r.clientY-c.top+"px",o()}function v(r){const c=e.getBoundingClientRect(),a=r.getBoundingClientRect(),g=4,y=a.left+a.width/2-c.left;t.classList.remove("below"),t.style.left=y+"px",t.style.top=a.top-g-c.top+"px";const x=t.getBoundingClientRect().height,T=a.top,R=window.innerHeight-a.bottom;T<x+g&&R>T&&(t.classList.add("below"),t.style.top=a.bottom+g-c.top+"px"),o(),$(y)}function $(r){const c=e.getBoundingClientRect(),a=t.getBoundingClientRect(),g=a.left-c.left,y=10,x=Math.max(y,Math.min(a.width-y,r-g));t.style.setProperty("--tail-x",x+"px")}function o(){const c=t.getBoundingClientRect();let a=0,g=0;c.left<8?a=8-c.left:c.right>window.innerWidth-8&&(a=window.innerWidth-8-c.right),c.top<8?g=8-c.top:c.bottom>window.innerHeight-8&&(g=window.innerHeight-8-c.bottom),(a||g)&&(t.style.left=parseFloat(t.style.left)+a+"px",t.style.top=parseFloat(t.style.top)+g+"px")}function d(){f(),n=!1,p=null,u=null,t.style.display="none",t.classList.remove("below")}s||e.addEventListener("mousemove",h),U&&document.addEventListener("click",r=>{e.contains(r.target)||d()}),t.addEventListener("mouseenter",()=>f()),t.addEventListener("mouseleave",r=>{n&&(u&&r.relatedTarget===u||b())});function P(r,c){U?r.addEventListener("click",a=>{a.preventDefault(),m(c,a,r)}):(r.addEventListener("mouseenter",a=>m(c,a,r)),r.addEventListener("mouseleave",a=>{a.relatedTarget&&t.contains(a.relatedTarget)||b()}))}function k(r,c){U?r.addEventListener("click",a=>{p!==r&&(a.preventDefault(),m(c,a,r),p=r)}):(r.addEventListener("mouseenter",a=>m(c,a,r)),r.addEventListener("mouseleave",a=>{a.relatedTarget&&t.contains(a.relatedTarget)||b()}))}return{bindHover:P,bindLink:k,hide:d}}function ae(e){const t=[{label:e.demCandidate+(e.demPrimaryPending?" (primary TBD)":""),party:"D",pct:B(e.demProbability),probability:e.demProbability},{label:e.repCandidate+(e.repPrimaryPending?" (primary TBD)":""),party:"R",pct:B(e.repProbability),probability:e.repProbability}];A(e)&&e.otherTickers.forEach(n=>t.push({label:n.candidate+" (I)",party:"",pct:B(n.probability),probability:n.probability})),t.sort((n,p)=>p.probability-n.probability);let s=(V[e.state]||e.state)+(e.raceType==="special"?" \u2014 special election":"");return e.stale&&(s+=" (as of "+ie(e.staleSince)+")"),{title:s,rows:t,href:e.kalshiUrl}}function oe(e){const t=Y(e);return{state:e.state,race:e,href:e.kalshiUrl,color:X(C(e)),leadLabel:Math.round(t.probability*100),leadProb:t.probability,leadParty:t.party,showIndependentMark:A(e),showPendingMark:Z(e),tooltip:ae(e)}}function ie(e){if(!e)return"unknown";const t=new Date(e);return isNaN(t)?e:t.toLocaleString("en-US",{month:"short",day:"numeric"})}function re(e){const t=e.length,s=(o,d)=>o.leadParty===d&&o.leadProb>=J;let n=0;for(;n<t&&s(e[n],"D");)n++;let p=0;for(;p<t-n&&s(e[t-1-p],"R");)p++;const u=t-p;let l=0;for(;l<t&&e[l].leadParty==="D";)l++;const f=l>0&&l<t,b=[];n>0&&n<t&&b.push({index:n,units:E,above:"Strong D",below:null}),p>0&&u>0&&b.push({index:u,units:E,above:null,below:"Strong R"}),f&&b.push({index:l,units:te,above:null,below:null});const m=[];for(const o of b){const d=m.find(P=>P.index===o.index);if(!d){m.push({...o});continue}d.units=Math.max(d.units,o.units),d.above=d.above||o.above,d.below=d.below||o.below}m.sort((o,d)=>o.index-d.index);const h=t+m.reduce((o,d)=>o+d.units,0),v=o=>o+m.filter(d=>d.index<=o).reduce((d,P)=>d+P.units,0),$=f?m.find(o=>o.index===l):null;return{gaps:m,totalUnits:h,edgeUnits:v,strongDem:n>0?{startUnits:0,endUnits:n}:null,strongRep:p>0?{startUnits:v(u),endUnits:h}:null,flipUnits:$?v(l)-$.units/2:null}}function le(e){const t=e.races||[],s=D.filter(i=>N(i)==="D").sort((i,S)=>i.state.localeCompare(S.state)),n=D.filter(i=>N(i)==="R").sort((i,S)=>i.state.localeCompare(S.state)),u=[...t].sort((i,S)=>C(S)-C(i)).map(oe),l=s.length,f=n.length,b=l+f+H,m=l/b/2*100,h=100-f/b/2*100,v=l/b*100,$=H/b*100,o=re(u),d=i=>v+i/o.totalUnits*$,P=M-2*_,k=i=>(_+i/o.totalUnits*P)/M*100,r=50-l,c=d(o.edgeUnits(r)),a=k(o.edgeUnits(r)),g=i=>i&&{pos:d(i.startUnits),size:d(i.endUnits)-d(i.startUnits)},y=i=>i&&{pos:k(i.startUnits),size:k(i.endUnits)-k(i.startUnits)},x=[{key:"dem",label:"Strong D",wide:g(o.strongDem),narrow:y(o.strongDem)},{key:"rep",label:"Strong R",wide:g(o.strongRep),narrow:y(o.strongRep)}].filter(i=>i.wide),T=o.flipUnits===null?null:d(o.flipUnits),R=o.flipUnits===null?null:k(o.flipUnits),F={title:l+" Democratic seats not up in 2026",rows:s.map(i=>({label:i.state,value:i.senator})),scrollable:!0},W={title:f+" Republican seats not up in 2026",rows:n.map(i=>({label:i.state,value:i.senator})),scrollable:!0},L=e.controlsMarket||{demProbability:.5,repProbability:.5},O=L.kalshiUrl||"",q=Math.round(L.demProbability*1e3)/10,z=Math.round(L.repProbability*1e3)/10,I=new Date(e.fetchedAt),K=isNaN(I)?e.fetchedAt:I.toLocaleString("en-US",{month:"short",day:"numeric",hour:"numeric",minute:"2-digit",timeZoneName:"short"});return{races:t,segments:u,demSolidCount:l,repSolidCount:f,gaps:o.gaps.map(i=>({...i,flex:i.units+" 1 0%"})),strongGroups:x,leanPos:T,leanPosNarrow:R,demSolidLabelPos:m,repSolidLabelPos:h,majorityLinePos:c,majorityLinePosNarrow:a,demBlockFlex:l+" 1 0%",repBlockFlex:f+" 1 0%",contestedWrapFlex:H+" 1 0%",demBlockTooltip:F,repBlockTooltip:W,demPct:q,repPct:z,demPctLabel:"Democratic "+B(L.demProbability),repPctLabel:"Republican "+B(L.repProbability),controlsHref:O,fetchedAtLabel:K,failedStates:e.failedStates||[]}}function de(e,t){return`
    <a class="seg-wide" href="${w(e.href)}" target="_blank" rel="noopener noreferrer" style="background:${e.color};" data-seg-index="${t}">
      <span class="seg-label-stack">
        <span class="seg-state">${w(e.state)}</span>
        <span class="seg-pct">${e.leadLabel}</span>
        <span class="seg-party">${e.leadParty}</span>
      </span>
      ${e.showIndependentMark?'<span class="ind-mark ind-mark-h" role="img" aria-label="Independent polling above 10%">&#42;</span>':""}
      ${e.showPendingMark?'<span class="pending-mark-h pending-badge" title="Primary not yet decided">?</span>':""}
    </a>`}function ce(e,t){return`
    <a class="seg-narrow" href="${w(e.href)}" target="_blank" rel="noopener noreferrer" style="background:${e.color};" data-seg-index="${t}">
      <span class="seg-state">${w(e.state)}</span>
      <span class="seg-pct">${e.leadLabel}</span>
      <span class="seg-party">${e.leadParty}</span>
      ${e.showIndependentMark?'<span class="ind-mark ind-mark-v" role="img" aria-label="Independent polling above 10%">&#42;</span>':""}
      ${e.showPendingMark?'<span class="pending-mark-v pending-badge" title="Primary not yet decided">?</span>':""}
    </a>`}function G(e,t,s){return e.segments.map((n,p)=>{const u=e.gaps.find(l=>l.index===p);return(u?s(u):"")+t(n,p)}).join("")}function pe(e){return`<div class="seg-gap-wide" style="flex:${e.flex};"></div>`}function ue(e){const t=e.above?`<span class="gap-label dem">${e.above} &#9650;</span>`:"",s=e.below?`<span class="gap-label rep">&#9660; ${e.below}</span>`:"";return`<div class="seg-gap-narrow" style="flex:${e.flex};">${t}${s}</div>`}function me(e){const t=e.strongGroups.map(n=>`
      <div class="strong-group ${n.key}" style="left:${n.wide.pos}%; width:${n.wide.size}%;">
        <div class="strong-bracket"></div>
        <div class="strong-label">${n.label}</div>
      </div>`).join(""),s=e.leanPos===null?"":`
      <div class="lean-mark" style="left:${e.leanPos}%;">
        <span class="lean-tick"></span>
        <!-- U+25C4/U+25BA (pointers), not the U+25C0/U+25B6 triangles: that
             pair resolves to two different fallback fonts here, giving the two
             labels line boxes of different heights (15px vs 12px) and so
             visibly different baselines despite a shared top offset. These two
             share the label font's own metrics -- same as the narrow layout's
             U+25B2/U+25BC -- so the two labels line up. -->
        <span class="lean-label lean-d">&#9668; Leans D</span>
        <span class="lean-label lean-r">Leans R &#9658;</span>
      </div>`;return`<div class="lean-band-wide">${t}${s}</div>`}function fe(e){const t=document.getElementById("gauge-dem"),s=document.getElementById("gauge-rep");t.style.width=e.demPct+"%",s.style.width=e.repPct+"%",t.textContent=e.demPctLabel,s.textContent=e.repPctLabel;const n=document.getElementById("gauge-source-link");e.controlsHref?n.href=e.controlsHref:n.removeAttribute("href")}function be(e){const t=document.getElementById("bar-wide-container");t.innerHTML=`
    <div class="bar-wrap-wide" id="bar-wide">
      <div class="callout" style="left:${e.majorityLinePos}%; color:#211f1c;">50 seats</div>
      <div class="callout" style="left:${e.demSolidLabelPos}%; color:#1c3f7a;">${e.demSolidCount} D seats not up</div>
      <div class="callout" style="left:${e.repSolidLabelPos}%; color:#8a2a22;">${e.repSolidCount} R seats not up</div>
      <div class="bar-wide">
        <div class="solid-block dem" style="flex:${e.demBlockFlex};" data-tip="dem-solid"></div>
        <div class="contested-wrap-wide" style="flex:${e.contestedWrapFlex};">
          ${G(e,de,pe)}
        </div>
        <div class="solid-block rep" style="flex:${e.repBlockFlex};" data-tip="rep-solid"></div>
      </div>
      <div class="majority-line-wide" style="left:${e.majorityLinePos}%;"></div>
      <div class="tooltip" id="tooltip-wide"></div>
    </div>
    ${me(e)}`;const s=document.getElementById("bar-wide"),n=document.getElementById("tooltip-wide"),p=j(s,n,{anchorToRow:!0});p.bindHover(s.querySelector('[data-tip="dem-solid"]'),e.demBlockTooltip),p.bindHover(s.querySelector('[data-tip="rep-solid"]'),e.repBlockTooltip),s.querySelectorAll(".seg-wide").forEach(u=>{const l=e.segments[Number(u.dataset.segIndex)];p.bindLink(u,l.tooltip)})}function ge(e){const t=document.getElementById("bar-narrow-container");t.innerHTML=`
    <div class="bar-wrap-narrow">
      <div class="bar-inner-narrow" id="bar-narrow">
        <div class="solid-caption dem">${e.demSolidCount} D seats not up</div>
        <div class="bar-track-narrow">
          <div class="bar-narrow">
            <div class="solid-block-narrow dem" style="flex:${e.demBlockFlex};" data-tip="dem-solid"></div>
            <div class="contested-wrap-narrow" style="flex:${e.contestedWrapFlex};">
              ${G(e,ce,ue)}
            </div>
            <div class="solid-block-narrow rep" style="flex:${e.repBlockFlex};" data-tip="rep-solid"></div>
          </div>
          <div class="majority-line-narrow" style="top:${e.majorityLinePosNarrow}%;"></div>
          <div class="majority-label-narrow" style="top:${e.majorityLinePosNarrow}%;">50 seats</div>
          ${e.leanPosNarrow===null?"":`
          <div class="lean-line-narrow" style="top:${e.leanPosNarrow}%;"></div>
          <div class="lean-labels-narrow" style="top:${e.leanPosNarrow}%;">
            <span class="lean-label lean-d">Leans D &#9650;</span>
            <span class="lean-label lean-r">&#9660; Leans R</span>
          </div>`}
        </div>
        <div class="solid-caption rep">${e.repSolidCount} R seats not up</div>
        <div class="tooltip" id="tooltip-narrow"></div>
      </div>
    </div>`;const s=document.getElementById("bar-narrow"),n=document.getElementById("tooltip-narrow"),p=j(s,n,{anchorToRow:!0});p.bindHover(s.querySelector('[data-tip="dem-solid"]'),e.demBlockTooltip),p.bindHover(s.querySelector('[data-tip="rep-solid"]'),e.repBlockTooltip),s.querySelectorAll(".seg-narrow").forEach(u=>{const l=e.segments[Number(u.dataset.segIndex)];p.bindLink(u,l.tooltip)})}function we(e){const t=document.getElementById("fetched-at-label");if(t.textContent="Updated "+e.fetchedAtLabel,e.failedStates.length){const s=document.createElement("div");s.className="stale",s.textContent=`Showing last-known data for ${e.failedStates.join(", ")}`,t.parentElement.appendChild(s)}}function ye(e){document.getElementById("status").style.display="none",document.getElementById("app").style.display="block";const t=le(e);we(t),fe(t),be(t),ge(t),ee(t.races)}function he(e){const t=document.getElementById("status"),s=e&&e.message?": "+e.message:"";t.textContent="Unable to load market data"+s+". Try refreshing the page.",t.classList.add("error")}async function ve(){try{const e=await fetch("./live-senate-data.json",{cache:"no-store"});if(!e.ok)throw new Error("HTTP "+e.status);const t=await e.json();ye(t)}catch(e){he(e)}}ve();
