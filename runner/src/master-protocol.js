/** Renderer projection of the native master worker. No JS sampling or ISI clocks. */
export class NativeMasterProtocolAdapter {
  constructor({ invoke, render, terminal, fail, windowObject }) {
    Object.assign(this, { invoke, render, terminal, fail, windowObject });
    this.active = false; this.status = null; this.plan = null; this.pending = false; this.destroyed = false;
  }
  async start(plan, request, {validation = false} = {}) {
    if (this.active) throw new Error("A master attempt is already active.");
    if (![1, 2, 3, 4].includes(plan.version)) throw new Error("Unsupported master plan version.");
    if ([2, 3, 4].includes(plan.version) && (request.version !== plan.version || request.participantId !== plan.participantId || Object.hasOwn(request, "participant"))) throw new Error("Typed master Start requires its participant ID without legacy participant preparation.");
    if (validation && plan.version !== 3) throw new Error("Validation sessions require master3.");
    const receipt = validation
      ? await this.invoke("research_runner_master_validation_start", {request:{version:1,acknowledgeUnqualified:true,experiment:request}})
      : await this.invoke(({1:"research_runner_master_start",2:"research_runner_master_start_v2",3:"research_runner_master_start_v3",4:"research_runner_master_start_v4"}[plan.version]), { request });
    if (validation && (receipt?.executionQualification?.sessionKind !== "local-validation" || receipt.executionQualification.researchQualified !== false)) throw new Error("Validation Start omitted its permanent unqualified label.");
    if (receipt?.schema !== "affect-runner-master-attempt" || receipt.version !== plan.version || receipt.recipeSourceByteSha256 !== plan.recipeSourceByteSha256
      || receipt.planIdentitySha256 !== plan.planIdentitySha256 || receipt.participantId !== plan.participantId || !/^run-[a-f0-9-]{36}$/u.test(receipt.runId)) {
      throw new Error("Native master Start did not return this exact plan and participant.");
    }
    this.plan = plan; this.receipt = receipt; this.active = true; this.presented = null;
    this.timer = this.windowObject.setInterval(() => this.poll().catch(this.fail), 100);
    await this.poll(); return receipt;
  }
  async poll() {
    if (!this.active || this.pending || this.destroyed) return;
    this.pending = true;
    try {
      const status = await this.invoke("research_runner_master_status");
      this.assertStatus(status); this.status = status;
      await this.render(status, this.plan);
      if (!status.active) {
        this.active = false; this.windowObject.clearInterval(this.timer); await this.terminal(status); return;
      }
      if (status.phase === "awaitingPresentation" && this.presented !== status.position) {
        await new Promise(resolve => this.windowObject.requestAnimationFrame(() => this.windowObject.requestAnimationFrame(resolve)));
        if (this.destroyed) return;
        const next = await this.command({ type: "presented", position: status.position });
        this.presented = status.position; this.status = next;
      }
    } catch (error) {
      // A renderer/layout failure cannot leave acquisition running invisibly.
      if (this.active && this.receipt) {
        try { const result = await this.command({ type: "stop" }); this.status = result; }
        catch { /* Native status remains authoritative on the following poll. */ }
      }
      throw error;
    } finally { this.pending = false; }
  }
  assertStatus(status) {
    if (status?.schema !== "affect-runner-master-status" || status.version !== this.plan.version || status.runId !== this.receipt.runId
      || status.attemptId !== this.receipt.attemptId || status.recipeSourceByteSha256 !== this.plan.recipeSourceByteSha256 || status.planIdentitySha256 !== this.plan.planIdentitySha256) throw new Error("Native master status does not match this attempt.");
  }
  async command(action) {
    const args = { runId: this.receipt.runId, action };
    const status = await this.invoke(({1:"research_runner_master_action",2:"research_runner_master_action_v2",3:"research_runner_master_action_v3",4:"research_runner_master_action_v4"}[this.plan.version]), this.plan.version >= 3 ? {request:{version:this.plan.version,...args}} : args);
    this.assertStatus(status); this.status = status; return status;
  }
  async togglePause() { await this.command({ type: this.status?.phase === "paused" ? "resume" : "pause" }); }
  async finish() { await this.command({ type: "stop" }); await this.poll(); }
  questionnaireAnswers(detail) {
    return [2, 3, 4].includes(this.plan.version)
      ? Object.entries(detail.answers).map(([itemId, value]) => ({ itemId, value: structuredClone(value) }))
      : Object.entries(detail.answers).map(([itemId, optionId]) => ({ itemId, optionId }));
  }
  answerAction(type, detail) {
    if (detail.surveyjs) {
      if (this.plan.version !== 4) throw new Error("SurveyJS answers require master version 4.");
      return { type: type === "draft" ? "surveyDraft" : "surveySubmit", position: detail.protocolStepPosition, data: structuredClone(detail.data), pageNo: detail.pageNo };
    }
    return { type, position: detail.protocolStepPosition, answers: this.questionnaireAnswers(detail) };
  }
  async questionnaireDraft(detail) { await this.command(this.answerAction("draft", detail)); }
  async questionnaireSubmit(detail) { await this.command(this.answerAction("submit", detail)); await this.poll(); }
  async resize() {
    const viewport = this.plan.selected.layout.profile.viewport;
    if (this.windowObject.innerWidth !== viewport.widthCssPx || this.windowObject.innerHeight !== viewport.heightCssPx) {
      await this.finish(); throw new Error("The saved fullscreen layout changed. The attempt was stopped and retained as partial.");
    }
  }
  destroy() { this.destroyed = true; this.windowObject.clearInterval(this.timer); }
}
