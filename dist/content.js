"use strict";(()=>{var f=(...e)=>console.debug("[NavAI]",...e),C=["a[href]","button","input","textarea","select","summary",'[role="button"]','[role="link"]','[role="tab"]','[role="menuitem"]','[role="option"]','[role="checkbox"]','[role="radio"]','[role="switch"]','[role="treeitem"]','[role="combobox"]','[role="searchbox"]','[role="slider"]','[role="spinbutton"]','[tabindex]:not([tabindex="-1"])','[contenteditable="true"]'].join(", ");function H(e){let n=e;for(;n&&n!==document.documentElement;){let t=getComputedStyle(n);if(t.display==="none"||t.visibility==="hidden"||t.opacity==="0")return!1;n=n.parentElement}return!0}function A(e){return e.bottom>0&&e.top<window.innerHeight&&e.right>0&&e.left<window.innerWidth}function N(){let e=document.querySelector('dialog[open], [role="dialog"][aria-modal="true"]');if(e&&e.getBoundingClientRect().width>50)return e;let n=document.activeElement;if(!n||n===document.body||n===document.documentElement)return null;let t=null,i=n.parentElement,s=0;for(;i&&i!==document.body&&s<15;){let o=i.querySelectorAll('input, textarea, [contenteditable="true"], select'),r=i.querySelectorAll('button, [role="button"], a[href]'),h=o.length+r.length;if(o.length>=1&&r.length>=1&&h>=3){t=i;let a=i.getBoundingClientRect(),l=window.innerWidth*window.innerHeight;if(a.width*a.height<l*.8)break}i=i.parentElement,s++}return t}function k(e){if(e.id)return`#${CSS.escape(e.id)}`;let n=e.getAttribute("data-testid");if(n)return`[data-testid="${CSS.escape(n)}"]`;let t=e.getAttribute("aria-label");if(t)return`[aria-label="${CSS.escape(t)}"]`;let i=e.getAttribute("name");if(i)return`[name="${CSS.escape(i)}"]`;let s=[],o=e;for(;o&&o!==document.documentElement&&s.length<5;){let r=o.tagName.toLowerCase();if(o.id){s.unshift(`#${CSS.escape(o.id)}`);break}let h=o.parentElement;if(h){let a=Array.from(h.children).filter(l=>l.tagName===o.tagName);a.length>1&&(r+=`:nth-of-type(${a.indexOf(o)+1})`)}s.unshift(r),o=h}return s.join(" > ")}function R(e){let n="";for(let t of e.childNodes)t.nodeType===Node.TEXT_NODE&&(n+=t.textContent??"");return n=n.trim().replace(/\s+/g," "),n||(n=(e.textContent??"").trim().replace(/\s+/g," ")),n.substring(0,100)}function O(e){let n=e.getAttribute("aria-label");if(n)return n;let t=e.getAttribute("aria-labelledby");if(t){let o=document.getElementById(t);if(o)return(o.textContent??"").trim().substring(0,80)}if(e.id){let o=document.querySelector(`label[for="${CSS.escape(e.id)}"]`);if(o)return(o.textContent??"").trim().substring(0,80)}let i=e.closest("label");if(i)return(i.textContent??"").trim().substring(0,80);let s=e.getAttribute("title");return s||""}function I(){let e=N(),n=e!==null;f(`Active panel: ${n?e.tagName+"."+(e.className||"").substring(0,30):"none"}`);let i=(n?e:document).querySelectorAll(C),s=new Set,o=[];for(let a of i){let l=a;if(s.has(l))continue;let c=l.getBoundingClientRect();if(c.width<5||c.height<5||!H(l))continue;let d=l.parentElement?.closest(C);if(d&&s.has(d)&&s.delete(d),s.add(l),c.top>window.innerHeight*3)continue;let g=A(c),u=n?e.contains(l):!1;o.push({el:l,rect:c,inViewport:g,inPanel:u})}o.sort((a,l)=>n&&a.inPanel!==l.inPanel?a.inPanel?-1:1:a.inViewport!==l.inViewport?a.inViewport?-1:1:a.rect.top-l.rect.top);let h=o.slice(0,150).map((a,l)=>{let{el:c,rect:d,inViewport:g,inPanel:u}=a,p=c.tagName.toLowerCase(),m=c.getAttribute("role")??p,M=["input","textarea","select"].includes(p)||c.getAttribute("contenteditable")==="true";return{idx:l,tag:p,role:m,text:R(c),label:O(c),selector:k(c),rect:{top:d.top+window.scrollY,left:d.left+window.scrollX,width:d.width,height:d.height},isInput:M,inputType:c.getAttribute("type")??void 0,placeholder:c.getAttribute("placeholder")??void 0,isInViewport:g,isInDialog:u}});return{url:location.href,title:document.title,elements:h,hasOpenDialog:n}}var y=null,b=null,S=null,w=null;function $(){if(b)return b;y=document.createElement("div"),y.id="navai-overlay",Object.assign(y.style,{position:"fixed",top:"0",left:"0",width:"0",height:"0",zIndex:"2147483647",pointerEvents:"none"}),document.documentElement.appendChild(y),b=y.attachShadow({mode:"closed"});let e=document.createElement("style");return e.textContent=`
    .highlight {
      position: fixed;
      border: 3px solid #6366f1;
      border-radius: 6px;
      box-shadow: 0 0 0 4000px rgba(0,0,0,0.35);
      pointer-events: none;
      animation: pulse 1.5s ease-in-out infinite;
    }
    @keyframes pulse {
      0%, 100% { box-shadow: 0 0 0 4000px rgba(0,0,0,0.35), 0 0 0 0 rgba(99,102,241,0.4); }
      50% { box-shadow: 0 0 0 4000px rgba(0,0,0,0.35), 0 0 15px 5px rgba(99,102,241,0.3); }
    }
    .card {
      position: fixed;
      background: #fff;
      border: 2px solid #6366f1;
      border-radius: 12px;
      padding: 12px 16px;
      max-width: 280px;
      box-shadow: 0 4px 20px rgba(0,0,0,0.15);
      font-family: system-ui, sans-serif;
      pointer-events: auto;
      z-index: 2147483647;
    }
    .step-num {
      font-size: 11px;
      font-weight: 700;
      color: #6366f1;
      text-transform: uppercase;
      margin-bottom: 4px;
    }
    .instruction {
      font-size: 14px;
      color: #1e1e2e;
      line-height: 1.4;
      margin-bottom: 8px;
    }
    .done-btn {
      font-size: 12px;
      padding: 6px 14px;
      background: #6366f1;
      color: #fff;
      border: none;
      border-radius: 6px;
      cursor: pointer;
    }
    .done-btn:hover { background: #4f46e5; }
  `,b.appendChild(e),b}function P(e){E(),S=e;let n=null;try{n=document.querySelector(e.selector)}catch{}if(!n&&e.textHint){let d=e.textHint.toLowerCase().trim();if(d.length>0){let g=document.querySelectorAll(C);for(let u of g)if((u.textContent??"").toLowerCase().trim()===d){let m=u.getBoundingClientRect();if(m.width>0&&m.height>0){n=u;break}}if(!n&&d.length>3)for(let u of g){let p=(u.textContent??"").toLowerCase();if(p.includes(d)||d.includes(p.substring(0,20))){let m=u.getBoundingClientRect();if(m.width>0&&m.height>0){n=u;break}}}if(!n)for(let u of g){let p=(u.getAttribute("aria-label")??"").toLowerCase();if(p&&(p.includes(d)||d.includes(p))){let m=u.getBoundingClientRect();if(m.width>0&&m.height>0){n=u;break}}}}}if(!n){f("Target not found:",e.selector,e.textHint),x({type:"ERROR",msg:"Could not find the target element. Click Skip to try another."});return}let t=n.getBoundingClientRect(),i=$();for(let d of Array.from(i.children))d.tagName!=="STYLE"&&d.remove();let s=document.createElement("div");s.className="highlight",Object.assign(s.style,{top:`${t.top-4}px`,left:`${t.left-4}px`,width:`${t.width+8}px`,height:`${t.height+8}px`}),i.appendChild(s);let o=document.createElement("div");o.className="card",o.innerHTML=`
    <div class="step-num">Step ${e.stepNumber}</div>
    <div class="instruction">${V(e.instruction)}</div>
    <button class="done-btn">Done</button>
  `;let r=12,h=280,a=120,l,c;window.innerHeight-t.bottom>a+r?(l=t.bottom+r,c=Math.max(r,Math.min(t.left,window.innerWidth-h-r))):t.top>a+r?(l=t.top-a-r,c=Math.max(r,Math.min(t.left,window.innerWidth-h-r))):t.left>h+r?(l=Math.max(r,Math.min(t.top,window.innerHeight-a-r)),c=t.left-h-r):(l=Math.max(r,Math.min(t.top,window.innerHeight-a-r)),c=t.right+r),o.style.top=`${l}px`,o.style.left=`${Math.max(r,Math.min(c,window.innerWidth-h-r))}px`,o.querySelector(".done-btn").addEventListener("click",()=>{E(),x({type:"ACTION_DONE",action:e.action})}),i.appendChild(o),(t.top<0||t.bottom>window.innerHeight)&&n.scrollIntoView({behavior:"smooth",block:"center"}),D(n,e)}function D(e,n){if(L(),n.action==="click"){let t=i=>{e.contains(i.target)&&(f("Click detected"),L(),E(),x({type:"ACTION_DONE",action:"click"}))};document.addEventListener("click",t,!0),w=()=>document.removeEventListener("click",t,!0)}else if(n.action==="type"){let t,i=()=>{clearTimeout(t),t=setTimeout(()=>{(e.value||e.textContent)&&(f("Type detected"),L(),E(),x({type:"ACTION_DONE",action:"type"}))},1e3)};e.addEventListener("input",i),w=()=>{e.removeEventListener("input",i),clearTimeout(t)}}else if(n.action==="select"){let t=()=>{f("Select detected"),L(),E(),x({type:"ACTION_DONE",action:"select"})};e.addEventListener("change",t),w=()=>e.removeEventListener("change",t)}}function L(){w&&(w(),w=null)}function E(){if(L(),S=null,b)for(let e of Array.from(b.children))e.tagName!=="STYLE"&&e.remove()}function V(e){let n=document.createElement("div");return n.textContent=e,n.innerHTML}var T=location.href;function _(){let e=history.pushState,n=history.replaceState;history.pushState=function(...t){e.apply(this,t),v()},history.replaceState=function(...t){n.apply(this,t),v()},window.addEventListener("popstate",v),window.addEventListener("hashchange",v)}function v(){location.href!==T&&(T=location.href,f("URL changed:",T),x({type:"NAV_CHANGE",url:T}))}function x(e){chrome.runtime.sendMessage(e).catch(()=>{})}chrome.runtime.onMessage.addListener((e,n,t)=>{switch(f("Received:",e.type),e.type){case"EXTRACT":let i=I();return f(`Extracted ${i.elements.length} elements, topLayer=${i.hasOpenDialog}`),t({type:"PAGE_DATA",data:i}),!0;case"SHOW_STEP":return P(e.step),t({ok:!0}),!0;case"HIDE_OVERLAY":return E(),t({ok:!0}),!0}return!1});_();f("Content script ready");})();
