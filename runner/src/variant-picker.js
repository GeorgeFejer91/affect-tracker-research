import { participantNumber } from "./participants.js";

export function validateVariantUsage(receipt, sourceHash, variants) {
  if (receipt?.schema !== "affect-runner-variant-usage" || receipt.version !== 1 || receipt.basis !== "xdf-file-names-v1" || receipt.recipeSourceByteSha256 !== sourceHash
    || !Array.isArray(receipt.variants) || receipt.variants.length !== variants.length || !Array.isArray(receipt.usedParticipantIds)
    || !Number.isSafeInteger(receipt.ignoredXdfFiles) || receipt.ignoredXdfFiles < 0) throw new Error("Version usage does not match this experiment JSON.");
  const used = new Set();
  for (const id of receipt.usedParticipantIds) {
    const number = participantNumber(id);
    if (number === null || id !== `P${String(number).padStart(3,"0")}` || used.has(id)) throw new Error("Recording participant inventory is invalid.");
    used.add(id);
  }
  receipt.variants.forEach((row, i) => {
    if (row.variantId !== variants[i].variantId || !Number.isSafeInteger(row.recordingCount) || row.recordingCount < 0 || row.recordingCount > 200000
      || !Number.isSafeInteger(row.participantCount) || row.participantCount < 0 || row.participantCount > row.recordingCount || row.participantCount > used.size) throw new Error("Version recording counts are invalid.");
  });
  return structuredClone(receipt);
}
export function leastUsedVariant(rows) {
  return rows.reduce((best, row) => !best || row.recordingCount < best.recordingCount ? row : best, null)?.variantId ?? "";
}
export function nextParticipant(ids) {
  const used = new Set(ids);
  for (let n=1;n<=100000;n++) { const id=`P${String(n).padStart(3,"0")}`; if (!used.has(id)) return id; }
  return null;
}
export function usageColor(count, maximum) { return `hsl(${maximum ? Math.round(120*(1-count/maximum)) : 120} 55% 52%)`; }

export function createVariantPicker(root, {onChange}) {
  const q=id=>root.querySelector(`#${id}`), select=q("runner-variant"), button=q("runner-variant-button"), popup=q("runner-variant-popup"), list=q("runner-variant-options"), status=q("runner-variant-status");
  let variants=[], usage=null, sourceHash=null, manual=false, participant=null, locked=true, active=0;
  const removers=[];
  const listen=(el,event,fn)=>{el.addEventListener(event,fn);removers.push(()=>el.removeEventListener(event,fn));};
  function close(){popup.hidden=true;button.setAttribute("aria-expanded","false");button.removeAttribute("aria-activedescendant");}
  function render(){
    const index=variants.findIndex(v=>v.variantId===select.value), current=usage?.variants[index];
    q("runner-variant-label").textContent=index<0?"Choose version":`V${index+1} · ${variants[index].title}`;
    q("runner-variant-count").textContent=current?`${current.recordingCount} XDF · ${current.participantCount} participant${current.participantCount===1?"":"s"}`:"Usage unavailable";
    const max=usage?Math.max(0,...usage.variants.map(v=>v.recordingCount)):0;
    button.style.setProperty("--version-color",current?usageColor(current.recordingCount,max):"#777");
    status.textContent=usage?`${manual?"Manual selection":"Automatic: least-used version"}. Counts use every matching XDF, including stopped runs.${usage.ignoredXdfFiles?` ${usage.ignoredXdfFiles} older or unrecognized XDF files excluded.`:""}`:"Recording inventory unavailable. You can select a version manually.";
    list.replaceChildren();
    for(let i=0;i<variants.length;i++){
      const variant=variants[i], count=usage?.variants[i], option=document.createElement("div");
      option.id=`runner-version-${i}`;option.role="option";option.dataset.variantIndex=String(i);option.setAttribute("aria-selected",String(select.value===variant.variantId));option.className="runner-version-option";
      option.style.setProperty("--version-color",count?usageColor(count.recordingCount,max):"#777");
      const label=document.createElement("span"), number=document.createElement("span"), track=document.createElement("span"), bar=document.createElement("span");
      label.textContent=`V${i+1} · ${variant.title}`;number.textContent=count?`${count.recordingCount} XDF · ${count.participantCount} participant${count.participantCount===1?"":"s"}`:"Unknown";
      track.className="runner-version-track";bar.style.width=`${count&&max?count.recordingCount/max*100:0}%`;track.append(bar);option.append(label,number,track);list.append(option);
    }
    q("runner-variant-scale").textContent=usage?`Green: 0 XDF · Red: ${max} XDF (current maximum)`:"Recording counts unavailable";
  }
  function changed(previous){render();if(select.value!==previous)onChange();}
  function choose(index){if(locked||!variants[index])return;manual=true;select.value=variants[index].variantId;close();render();button.focus();onChange();}
  function highlight(index){active=Math.max(0,Math.min(variants.length-1,index));list.querySelectorAll('[role="option"]').forEach((el,i)=>el.classList.toggle("is-active",i===active));const option=q(`runner-version-${active}`);button.setAttribute("aria-activedescendant",option.id);option.scrollIntoView({block:"nearest"});}
  function show(){if(locked||!variants.length)return;popup.hidden=false;button.setAttribute("aria-expanded","true");highlight(Math.max(0,variants.findIndex(v=>v.variantId===select.value)));}
  listen(button,"click",()=>popup.hidden?show():close());
  listen(button,"keydown",event=>{
    if(locked)return;
    if(["ArrowDown","ArrowUp","Home","End"].includes(event.key)){event.preventDefault();if(popup.hidden)show();else highlight(event.key==="Home"?0:event.key==="End"?variants.length-1:active+(event.key==="ArrowDown"?1:-1));}
    else if(event.key==="Escape"){event.preventDefault();close();}
    else if(["Enter"," "].includes(event.key)&&!popup.hidden){event.preventDefault();choose(active);}
    else if(event.key==="Tab")close();
  });
  listen(list,"pointerdown",event=>event.preventDefault());
  listen(list,"click",event=>{const row=event.target.closest("[data-variant-index]");if(row)choose(Number(row.dataset.variantIndex));});
  listen(select,"change",()=>{if(!locked){manual=true;render();onChange();}});
  listen(root.ownerDocument,"pointerdown",event=>{if(!q("runner-variant-field").contains(event.target))close();});
  return {
    adopt(receipt){variants=receipt?.recipe?.segments.P3.variants??[];sourceHash=receipt?.canonicalSourceByteSha256??null;usage=null;manual=false;participant=null;select.replaceChildren();const prompt=document.createElement("option");prompt.value="";prompt.textContent="Choose version";select.append(prompt);for(const variant of variants){const option=document.createElement("option");option.value=variant.variantId;option.textContent=variant.title;select.append(option);}q("runner-variant-field").hidden=!variants.length;close();render();},
    history(receipt){const previous=select.value;usage=receipt===null?null:validateVariantUsage(receipt,sourceHash,variants);if(!manual)select.value=usage?leastUsedVariant(usage.variants):"";changed(previous);},
    participant(id){if(participant===id)return;participant=id;manual=false;const previous=select.value;select.value=usage?leastUsedVariant(usage.variants):"";changed(previous);},
    reset(){manual=false;const previous=select.value;select.value=usage?leastUsedVariant(usage.variants):"";changed(previous);},
    lock(value){locked=value;button.disabled=value||!variants.length;if(value)close();},
    destroy(){removers.forEach(remove=>remove());},
  };
}
