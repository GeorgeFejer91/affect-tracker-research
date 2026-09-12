// Read-only DOM probe for an isolated, already loaded actual application.
// No loading, source adoption, layout/style mutation, playback or synthetic events.
export function captureLayoutDom(root,surface) {
  const view=root.ownerDocument.defaultView;
  const element=selector=>{const el=root.querySelector(selector);if(!el)throw Error(`Missing ${selector}`);return el;};
  const visible=el=>{const s=view.getComputedStyle(el);return el.getClientRects().length>0&&s.visibility==='visible'&&s.display!=='none'&&Number(s.opacity)>0&&!el.closest('[hidden]');};
  const rect=el=>{const r=el.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height};};
  const windowViewport={width:view.innerWidth,height:view.innerHeight};
  if(surface==='planner') {
    const svg=element('[data-layout-scene] svg'),ctm=svg.getScreenCTM();
    if(!ctm||ctm.b!==0||ctm.c!==0||ctm.a<=0||ctm.d<=0)throw Error('Unsupported miniature transform');
    const design=selector=>{const r=rect(element(selector));return {x:(r.x-ctm.e)/ctm.a,y:(r.y-ctm.f)/ctm.d,width:r.width/ctm.a,height:r.height/ctm.d};};
    return {surface,windowViewport,designViewport:{width:svg.viewBox.baseVal.width,height:svg.viewBox.baseVal.height},visible:visible(svg),
      reference:design('.layout-reference'),video:design('.layout-video'),feedback:design('.layout-feedback'),
      controls:Object.fromEntries([...root.querySelectorAll('[data-layout-field]')].map(el=>[el.dataset.layoutField,el.type==='checkbox'?el.checked:el.value])),
      miniatureScreenRect:rect(svg)};
  }
  if(surface!=='runner')throw Error('Unknown surface');
  const stage=element('#runner-stage'),feedback=element('.run-feedback-stage');
  return {surface,windowViewport,designViewport:{width:windowViewport.width,height:windowViewport.height},visible:visible(stage)&&visible(feedback),
    reference:rect(element('.stimulus-stage')),feedback:rect(feedback),nativeHost:rect(element('#run-native-video-host')),
    overlay:rect(element('.run-feedback-stage [data-preview-overlay]')),
    flubberVisible:visible(element('.run-feedback-stage [data-preview-flubber]')),stageRect:rect(stage),devicePixelRatio:view.devicePixelRatio};
}
