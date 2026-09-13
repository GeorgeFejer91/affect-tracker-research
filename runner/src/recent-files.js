export function validateRecentFiles(value) {
  if(value?.schema!=="affect-runner-recent-experiments"||value.version!==1||!Array.isArray(value.entries)||value.entries.length>10000)throw new Error("Recent experiment list is unavailable.");
  const ids=new Set();
  for(const item of value.entries){
    if(!/^recent-[a-f0-9]{64}$/u.test(item.id)||ids.has(item.id)||typeof item.basename!=="string"||!item.basename||!(item.folderName===null||typeof item.folderName==="string")||typeof item.available!=="boolean")throw new Error("Recent experiment list is invalid.");
    ids.add(item.id);
  }
  return value.entries;
}
export function createRecentFiles(root,{onSelect}) {
  const select=root.querySelector("#runner-recent-files");let entries=[];
  const changed=()=>{const id=select.value;select.value="";if(entries.some(e=>e.id===id&&e.available))onSelect(id);};
  select.addEventListener("change",changed);
  return {
    render(value){entries=validateRecentFiles(value);select.replaceChildren();const prompt=document.createElement("option");prompt.value="";prompt.textContent=entries.length?`Previous files (${entries.length})…`:"No previous files";select.append(prompt);for(const entry of entries){const option=document.createElement("option");option.value=entry.id;option.textContent=`${entry.basename}${entry.folderName?` — ${entry.folderName}`:""}${entry.available?"":" (unavailable)"}`;option.disabled=!entry.available;select.append(option);}},
    lock(value){select.disabled=value||!entries.length;},
    destroy(){select.removeEventListener("change",changed);},
  };
}
