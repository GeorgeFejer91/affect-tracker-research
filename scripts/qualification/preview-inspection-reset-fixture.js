// Actual Planner DOM, synthetic fixture input only; no physical device/Runner claim.
import { bootResearchUi } from "../../site/src/research/app.js";
import { canonicalJson } from "../../site/src/research/canonical.js";

export async function checkPreviewInspectionReset() {
  const root = bootResearchUi(), ui = root.researchUi, q = selector => root.querySelector(selector);
  const rows = [];
  const check = (name, pass) => { rows.push({name, pass: Boolean(pass)}); if (!pass) throw Error(name); };
  const state = () => ui.getPreviewInspectionSnapshot();
  const saved = () => canonicalJson(ui.getFeedbackContributionSnapshot().contribution);
  const change = (id, value) => {
    const field = q(`#${id}`); field.value = String(value);
    field.dispatchEvent(new Event("input", {bubbles:true}));
    field.dispatchEvent(new Event("change", {bubbles:true}));
  };
  const key = (code, key = code) => q(".preview-primary-stage").dispatchEvent(new KeyboardEvent("keydown", {code,key,bubbles:true,cancelable:true}));
  q('[data-color-anchor="up"]').click(); change("preview-color-hex", "#123456"); q("#preview-color-apply").click();
  await new Promise(resolve => setTimeout(resolve,0));
  q('input[name="previewGridSizing"][value="custom"]').click();
  change("preview-tile-columns",3); change("preview-tile-rows",5);
  q(".preview-primary-stage").focus(); key("ArrowRight","ArrowRight"); key("ArrowUp","ArrowUp");
  check("inspection moves on rectangular grid",state().rendering.x===1&&state().rendering.y===0.5);
  check("fixture has two held directions",state().response.heldDirections.length===2);
  const beforeReset = saved();
  ui.resetPreviewInspection();
  check("inspection reset is not grey-palette reset",saved()===beforeReset&&q("#color-up-hex").value==="#123456");
  check("inspection reset clears point and holds",state().rendering.x===0&&state().rendering.y===0&&state().response.heldDirections.length===0);
  check("inspection reset preserves configured dimensions",state().response.tileCount===3&&state().response.tileRows===5);
  key("ArrowRight","ArrowRight");
  check("same key works after reset without an old keyup",state().rendering.x===1);
  ui.resetPreviewInspection();
  const detached = state(); detached.rendering.colors.up="#ffffff";
  check("inspection readback cannot mutate configured values",state().rendering.colors.up==="#123456");
  q('[data-color-anchor="up"]').click(); change("preview-color-hex","#abcdef"); change("preview-color-label","Unapplied label");
  const beforeDraftReset=saved(); ui.resetPreviewInspection();
  await new Promise(resolve=>setTimeout(resolve,0));
  check("unapplied palette and label are discarded",!q("#preview-color-dialog").open&&saved()===beforeDraftReset&&state().rendering.colors.up==="#123456");
  q('[data-color-anchor="up"]').click();ui.resetPreviewInspection();q('[data-color-anchor="up"]').click();
  change("preview-color-hex","#345678");await new Promise(resolve=>setTimeout(resolve,0));q("#preview-color-apply").click();
  check("old close event cannot discard a newly opened palette",q("#color-up-hex").value==="#345678");
  await new Promise(resolve=>setTimeout(resolve,0));
  q("#preview-input-menu").click();q('[data-binding-capture-target="left"]').click();
  const beforeCaptureReset=saved();ui.resetPreviewInspection();
  q(".binding-capture-area").dispatchEvent(new KeyboardEvent("keydown",{code:"KeyJ",key:"j",bubbles:true}));
  check("reset disarms binding capture without assigning input",!q("#binding-capture-dialog").open&&saved()===beforeCaptureReset);
  change("grid-line-thickness",3.75);
  q('[data-feedback-preview-mode="grid"]').click();
  check("both tiled views use configured non-scaling line width",[...root.querySelectorAll("[data-preview-tile-lines]")].every(path=>Number(path.style.strokeWidth)===3.75&&path.getAttribute("vector-effect")==="non-scaling-stroke"));
  change("grid-line-thickness",0.25);
  check("line width edit applies without dimensions changing",[...root.querySelectorAll("[data-preview-tile-lines]")].every(path=>Number(path.style.strokeWidth)===0.25));
  // V2 inspection geometry is fixed (P4 owns layout). The retained V1 editor
  // still permits dragging; exercise that lifecycle without weakening V2.
  const configured = ui.getFeedbackContributionSnapshot().contribution;
  if (configured.version === 2) {
    check("V2 inspection position is intentionally locked",state().rendering.lockPosition);
    await ui.restoreFeedbackContribution({ input: configured.input, visual: configured.visual, mappings: configured.mappings });
  }
  const overlay=q(".preview-pane [data-preview-overlay]"),stage=q(".preview-primary-stage"),bounds=stage.getBoundingClientRect();
  // Pointer capture itself is a local test double: no OS pointer is synthesized.
  let captured=null;
  overlay.setPointerCapture=id=>{captured=id;};overlay.hasPointerCapture=id=>captured===id;overlay.releasePointerCapture=()=>{captured=null;};
  overlay.dispatchEvent(new PointerEvent("pointerdown",{pointerId:19,button:0,clientX:bounds.left+bounds.width/3,clientY:bounds.top+bounds.height/2,bubbles:true,cancelable:true}));
  check("fixture arms the renderer position drag",overlay.dataset.dragging==="true"&&captured===19);
  const positioned=saved();
  ui.resetPreviewInspection();
  check("inspection reset cancels drag without overwriting configured position",!overlay.dataset.dragging&&captured===null&&saved()===positioned);
  return {pass:true,rows};
}
