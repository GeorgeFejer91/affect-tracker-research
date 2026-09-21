"""Agent-only real-keyboard smoke. Never shipped with Experiment Runner.

Install PyAutoGUI==0.9.54 and pywinauto==0.6.9 in an isolated test environment.
Run --preflight-only first. Master3 retains its historical questionnaire phases;
master6 uses survey-before-1, survey-before-2, stimulus, survey-after and terminal.
Interactive phases require an explicitly selected PID and the intended Runner in
the foreground.
Every phase captures the actual window. A blocked UI aborts; this script never
changes capability flags, injects app state, or supplies simulated native replies.
"""
import argparse
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
from pathlib import PurePosixPath
import re
import site
import time

MASTER6_MEDIA_SHA256 = "b5327e7465ec92a4c93f3236a1ebab4556cdf508e24eafe6c593eac1e13afd49"
MASTER6_SURVEY_SHA256 = "cda3b9ae65d8fd2526cbfc198735b7ae9286ec6796729ef85b1149d915260ad0"


def sha256_file(path):
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def checked_asset(root, declaration, path_key, label):
    relative = declaration.get(path_key)
    if not isinstance(relative, str) or not relative or "\\" in relative:
        raise ValueError(f"{label} has an invalid portable path.")
    portable = PurePosixPath(relative)
    if portable.is_absolute() or any(part in ("", ".", "..") for part in portable.parts):
        raise ValueError(f"{label} escapes the selected recipe directory.")
    target = root.joinpath(*portable.parts).resolve()
    try:
        target.relative_to(root)
    except ValueError as exc:
        raise ValueError(f"{label} escapes the selected recipe directory.") from exc
    if not target.is_file():
        raise ValueError(f"{label} is missing: {relative}")
    expected_bytes = declaration.get("byteLength")
    actual_bytes = target.stat().st_size
    if not isinstance(expected_bytes, int) or isinstance(expected_bytes, bool) or actual_bytes != expected_bytes:
        raise ValueError(f"{label} byte length differs from the recipe.")
    expected_sha256 = declaration.get("sha256")
    actual_sha256 = sha256_file(target)
    if not isinstance(expected_sha256, str) or actual_sha256 != expected_sha256:
        raise ValueError(f"{label} SHA-256 differs from the recipe.")
    return {"kind": label, "relativePath": relative, "byteLength": actual_bytes, "sha256": actual_sha256}


def qualification_profile(recipe, language):
    if recipe.get("schema") != "affect-research-planner-recipe":
        raise ValueError("The selected file is not a Planner master recipe.")
    version = recipe.get("version")
    study = recipe.get("segments", {}).get("P1", {}).get("study", {})
    if study.get("id") != "mock-dictator":
        raise ValueError("Refusing to enter synthetic answers into a different study.")
    participant_count = recipe.get("policy", {}).get("participantCount")
    if not isinstance(participant_count, int) or isinstance(participant_count, bool) or participant_count < 1:
        raise ValueError("The mock recipe has no supported explicit participant count.")
    if version == 3:
        return {"kind": "historical-master3", "recipeVersion": 3, "studyId": study["id"], "participantCount": participant_count}
    if version != 6:
        raise ValueError("This sequence supports only the frozen master3 mock and the explicit master6 qualification profile.")

    policy = recipe.get("policy", {})
    sampling = policy.get("samplingFrequencyHz")
    if policy.get("version") != 2 or policy.get("acquisitionWindow") != "fullAttempt":
        raise ValueError("Master6 qualification requires the explicit full-attempt policy-v2 contract.")
    if sampling != 130 or isinstance(sampling, bool):
        raise ValueError("This master6 qualification sequence is fixed to the authored 130 Hz sampling rate.")
    if policy.get("lsl", {}).get("enabled") is not True:
        raise ValueError("Master6 qualification requires its authored LSL streams to be enabled.")
    if recipe.get("presentationTarget") != "desktop-screen":
        raise ValueError("The foreground keyboard smoke is confined to desktop-screen recipes.")
    if recipe.get("recipeId") != "mock-dictator-recipe":
        raise ValueError("The master6 keyboard smoke is confined to the explicit mock-dictator recipe identity.")

    videos = recipe["segments"]["P1"]["videoCatalogue"]["entries"]
    if len(videos) != 1 or videos[0].get("sha256") != MASTER6_MEDIA_SHA256:
        raise ValueError("The master6 keyboard smoke requires the exact reviewed Great Dictator media bytes.")

    p2 = recipe["segments"]["P2"]
    route = next((item for item in p2["languageSelection"]["languages"] if item.get("languageId") == language), None)
    if route is None:
        raise ValueError(f"The recipe has no {language} participant route.")
    modules = {item.get("moduleId"): item for item in p2["questionnaires"]["modules"]}
    if len(modules) != len(p2["questionnaires"]["modules"]):
        raise ValueError("Questionnaire module identities are ambiguous.")
    try:
        placements = [modules[module_id]["placement"]["kind"] for module_id in route["questionnaireModuleIds"]]
    except KeyError as exc:
        raise ValueError("The selected language route references an absent questionnaire module.") from exc
    if placements != ["beforeSession", "beforeSession", "afterSession"]:
        raise ValueError("Master6 keyboard qualification expects two before-session surveys and one after-session survey.")
    questionnaire_assets = p2["questionnaires"].get("assets", [])
    if len(questionnaire_assets) != 4 or {item.get("sha256") for item in questionnaire_assets} != {MASTER6_SURVEY_SHA256}:
        raise ValueError("The master6 keyboard smoke requires the exact reviewed Boolean qualification survey bytes.")

    variants = recipe["segments"]["P3"]["variants"]
    variant = next((item for item in variants if item.get("variantId") == "variant-1"), None)
    if len(variants) != 1 or variant is None or [item.get("kind") for item in variant.get("entries", [])] != ["isi", "video", "isi"]:
        raise ValueError("Master6 keyboard qualification expects variant-1 with ISI, video, ISI chronology.")
    if [(item.get("isiId"), item.get("durationMs")) for item in recipe["segments"]["P3"]["isiDefinitions"]] != [("ISI1", 1750), ("ISI2", 3213)]:
        raise ValueError("The master6 keyboard smoke requires the reviewed 1750 ms and 3213 ms interval definitions.")
    input_binding = recipe["segments"]["P5"]["input"]
    expected_directions = {direction: {"kind": "keyboard", "code": f"Arrow{direction.title()}"} for direction in ("up", "down", "left", "right")}
    if input_binding.get("kind") != "digital" or input_binding.get("preset") != "arrowKeys" or input_binding.get("directions") != expected_directions:
        raise ValueError("The master6 keyboard smoke sends keys only for the exact authored arrow-key binding.")
    return {
        "kind": "master6-full-attempt",
        "recipeVersion": 6,
        "studyId": study["id"],
        "acquisitionWindow": "fullAttempt",
        "samplingFrequencyHz": sampling,
        "lslEnabled": True,
        "participantCount": participant_count,
        "language": language,
        "questionnairePlacements": placements,
        "variantId": "variant-1",
        "variantEntryKinds": ["isi", "video", "isi"],
        "expectedStepKinds": ["questionnaire", "questionnaire", "interval", "video", "interval", "questionnaire"],
    }


def preflight_recipe(recipe_path, recipe_bytes, recipe, language):
    root = recipe_path.resolve().parent
    profile = qualification_profile(recipe, language)
    assets = []
    for index, declaration in enumerate(recipe["segments"]["P1"]["videoCatalogue"]["entries"], start=1):
        assets.append(checked_asset(root, declaration, "packageRelativePath", f"video-{index}"))
    for index, declaration in enumerate(recipe["segments"]["P2"]["questionnaires"].get("assets", []), start=1):
        assets.append(checked_asset(root, declaration, "relativePath", f"questionnaire-{index}"))
    return {
        "schema": "affect-runner-foreground-keyboard-preflight",
        "version": 1,
        "createdAtUtc": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "scriptSha256": sha256_file(Path(__file__).resolve()),
        "recipePath": str(recipe_path.resolve()),
        "recipeSha256": hashlib.sha256(recipe_bytes).hexdigest(),
        "profile": profile,
        "assets": assets,
        "scope": "Static input guard only; no app launch, physical input, playback, acquisition, LSL or XDF claim.",
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--pid", type=int)
    parser.add_argument("--recipe", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--deps", type=Path)
    parser.add_argument("--language", choices=["en", "de"], default="en")
    parser.add_argument("--participant-number", default="1")
    parser.add_argument("--preflight-only", action="store_true")
    parser.add_argument("--phase", choices=["inspect", "settings", "launch", "setup", "prepare", "demographics", "maia", "tas", "playback", "survey-before-1", "survey-before-2", "stimulus", "survey-after", "terminal", "all"], default="inspect")
    args = parser.parse_args()
    recipe_bytes = args.recipe.read_bytes()
    recipe = json.loads(recipe_bytes)
    preflight = preflight_recipe(args.recipe, recipe_bytes, recipe, args.language)
    profile = preflight["profile"]
    if args.pid is None:
        if not args.preflight_only:
            parser.error("--pid is required unless --preflight-only is used")
    if not re.fullmatch(r"[1-9][0-9]{0,5}", args.participant_number):
        parser.error("--participant-number must be an explicit positive decimal participant number")
    if int(args.participant_number) > profile["participantCount"]:
        parser.error("--participant-number exceeds the participant count frozen in this recipe")
    if profile["recipeVersion"] == 3 and args.phase in {"survey-before-1", "survey-before-2", "stimulus", "survey-after", "terminal"}:
        parser.error("master6 phases cannot be used with the historical master3 mock")
    if profile["recipeVersion"] == 6 and args.phase in {"demographics", "maia", "tas", "playback"}:
        parser.error("historical master3 phases cannot be used with the master6 qualification profile")
    args.output.mkdir(parents=True, exist_ok=False)
    (args.output / "preflight.json").write_text(json.dumps(preflight, ensure_ascii=False, indent=2), encoding="utf-8")
    if args.preflight_only:
        print(json.dumps(preflight, ensure_ascii=False), flush=True)
        return

    if args.deps:
        site.addsitedir(str(args.deps.resolve()))
    import pyautogui as keys
    import win32api
    import win32con
    import win32gui
    import win32process
    from pywinauto import Application
    from pywinauto.uia_defines import IUIA

    app = Application(backend="uia").connect(process=args.pid)
    window = app.window(title="Experiment Runner")
    window.wait("exists visible", timeout=10)
    keys.FAILSAFE = True
    keys.PAUSE = 0.15
    observations = []
    physical_inputs = []
    uia = IUIA().iuia

    def bring_runner_foreground():
        handle = window.wrapper_object().handle
        for _ in range(4):
            attached = []
            try:
                foreground = win32gui.GetForegroundWindow()
                target_thread = win32process.GetWindowThreadProcessId(handle)[0]
                foreground_thread = win32process.GetWindowThreadProcessId(foreground)[0] if foreground else 0
                current_thread = win32api.GetCurrentThreadId()
                for thread in {target_thread, foreground_thread}:
                    if thread and thread != current_thread:
                        win32process.AttachThreadInput(current_thread, thread, True)
                        attached.append(thread)
                keys.press("alt")
                win32gui.ShowWindow(handle, win32con.SW_RESTORE)
                win32gui.SetWindowPos(
                    handle,
                    win32con.HWND_TOPMOST,
                    0,
                    0,
                    0,
                    0,
                    win32con.SWP_NOMOVE | win32con.SWP_NOSIZE | win32con.SWP_SHOWWINDOW,
                )
                win32gui.BringWindowToTop(handle)
                box = window.rectangle()
                keys.click(box.left + 120, box.top + 18)
                win32gui.SetForegroundWindow(handle)
                win32gui.SetActiveWindow(handle)
                window.set_focus()
            except Exception:
                pass
            finally:
                current_thread = win32api.GetCurrentThreadId()
                for thread in attached:
                    try:
                        win32process.AttachThreadInput(current_thread, thread, False)
                    except Exception:
                        pass
            time.sleep(0.25)
            foreground = win32gui.GetForegroundWindow()
            if win32process.GetWindowThreadProcessId(foreground)[1] == args.pid:
                return
        raise RuntimeError("Runner could not be brought to the foreground.")

    bring_runner_foreground()

    def release_runner_topmost():
        try:
            win32gui.SetWindowPos(
                window.wrapper_object().handle,
                win32con.HWND_NOTOPMOST,
                0,
                0,
                0,
                0,
                win32con.SWP_NOMOVE | win32con.SWP_NOSIZE | win32con.SWP_SHOWWINDOW,
            )
        except Exception:
            pass

    def guard():
        foreground = win32gui.GetForegroundWindow()
        if win32process.GetWindowThreadProcessId(foreground)[1] == args.pid:
            return
        bring_runner_foreground()
        foreground = win32gui.GetForegroundWindow()
        if win32process.GetWindowThreadProcessId(foreground)[1] != args.pid:
            raise RuntimeError("Runner lost foreground focus; no key was sent.")

    def control(identifier):
        return window.child_window(auto_id=identifier, visible_only=False)

    def visible(identifier):
        spec = control(identifier)
        return spec.exists(timeout=0) and spec.is_visible()

    def fail_if_error():
        if visible("runner-error"):
            message = control("runner-error").window_text()
            if message.strip():
                raise RuntimeError("Runner blocked: " + message)

    def wait_for(predicate, description, seconds=15):
        deadline = time.monotonic() + seconds
        while time.monotonic() < deadline:
            guard()
            fail_if_error()
            if predicate():
                return
            time.sleep(0.2)
        raise TimeoutError(description)

    def capture(label):
        guard()
        box = window.rectangle()
        image = keys.screenshot(region=(box.left, box.top, box.width(), box.height()))
        file = args.output / (label + ".png")
        image.save(file)
        focused = uia.GetFocusedElement()
        guard()
        observations.append({
            "stage": label,
            "observedAtUtc": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
            "monotonicSeconds": time.monotonic(),
            "screenshot": file.name,
            "screenshotSha256": sha256_file(file),
            "focusedId": focused.CurrentAutomationId,
            "focusedName": focused.CurrentName,
            "session": control("runner-session").window_text(),
            "stimulus": control("runner-stimulus").window_text(),
            "timing": control("runner-timing").window_text(),
            "write": control("runner-write").window_text(),
            "lsl": control("runner-lsl").window_text(),
        })
        print("Captured: " + label, flush=True)

    def press(key, count=1, purpose=None):
        guard()
        keys.press(key, presses=count, interval=0.15)
        if purpose:
            physical_inputs.append({
                "purpose": purpose,
                "key": key,
                "count": count,
                "observedAtUtc": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
                "monotonicSeconds": time.monotonic(),
            })

    def focus(identifier):
        print("Keyboard focus: " + identifier, flush=True)
        for _ in range(100):
            guard()
            if uia.GetFocusedElement().CurrentAutomationId == identifier:
                return
            press("tab")
        raise RuntimeError("Keyboard could not reach " + identifier)

    def button(identifier):
        if not control(identifier).exists(timeout=0) or not control(identifier).is_enabled():
            raise RuntimeError("Required control is unavailable: " + identifier)
        focus(identifier)
        if not visible(identifier):
            raise RuntimeError("Focused control did not scroll into view: " + identifier)
        press("enter")

    def named_button(name):
        for _ in range(100):
            guard()
            element = uia.GetFocusedElement()
            if element.CurrentName == name and element.CurrentControlType == 50000:
                press("enter")
                return
            press("tab")
        raise RuntimeError("Keyboard could not reach button " + name)

    def session_step():
        match = re.search(r"·\s*(\d+)\/(\d+)\s*$", control("runner-session").window_text())
        return (int(match.group(1)), int(match.group(2))) if match else None

    def wait_step(position, description, seconds=30):
        wait_for(lambda: session_step() == (position, 6), description, seconds)

    def focus_boolean_answer():
        expected_question = "Details angeben?" if args.language == "de" else "Provide details?"
        false_label = "Nein" if args.language == "de" else "No"
        for _ in range(120):
            guard()
            element = uia.GetFocusedElement()
            name = element.CurrentName.strip()
            if element.CurrentControlType == 50002 and expected_question.casefold() in name.casefold():
                return "toggle"
            if element.CurrentControlType == 50013 and name.casefold() == false_label.casefold():
                return "false-choice"
            press("tab")
        raise RuntimeError("Keyboard could not reach the exact master6 Boolean answer control.")

    def questionnaire():
        wait_for(lambda: visible("runner-questionnaire-title") and control("runner-questionnaire-title").window_text().strip(), "Expected questionnaire screen", 90)
        wait_for(lambda: control("runner-questionnaire-submit").is_enabled(), "Questionnaire not ready")

    def answer_key(key):
        press(key)
        time.sleep(0.2)
        wait_for(lambda: control("runner-questionnaire-submit").is_enabled(), "Answer acknowledgement")

    def setup():
        button("runner-open")
        time.sleep(0.7)
        guard()
        keys.hotkey("alt", "n")
        keys.write(str(args.recipe.resolve()), interval=0.01)
        press("enter")
        wait_for(lambda: visible("runner-variant-button") and control("runner-variant-button").is_enabled(), "Recipe load", 90)
        focus("runner-participant")
        keys.hotkey("ctrl", "a")
        keys.write(args.participant_number)
        press("tab")
        wait_for(lambda: control("runner-launch").is_enabled(), "Participant/version selection")
        settings()
        launch()

    def settings():
        if not visible("runner-settings-title"):
            button("runner-settings")
        # Choose validation before arming the recorder locks the session policy.
        focus("runner-validation")
        if control("runner-validation").get_toggle_state() != 1:
            press("space")
        button("runner-test")
        focus("runner-test-region")
        for direction in ["up", "down", "left", "right"]:
            press(direction, purpose="native-input-readiness-test")
        wait_for(lambda: "All directions tested" in control("runner-input-status").window_text(), "Real native input test", 30)
        capture("input-tested")
        button("runner-record-start")
        wait_for(lambda: control("runner-record-stop").is_enabled(), "Recorder armed", 30)
        capture("recording-armed")
        named_button("Done")

    def launch():
        button("runner-launch")
        wait_for(lambda: visible("runner-preparation"), "Fullscreen preparation")
        # Fresh preparation focuses its heading. The mock has EN then DE buttons.
        press("tab", 1 if args.language == "en" else 2)
        press("enter")
        capture("language-selected")
        questionnaire()

    def demographics():
        questionnaire()
        for _ in range(100):
            if uia.GetFocusedElement().CurrentControlType == 50004:
                break
            press("tab")
        else:
            raise RuntimeError("Expected a SurveyJS text field; refusing to type elsewhere.")
        keys.write("Synthetic Keyboard Test", interval=0.03)
        answer_key("tab")
        if uia.GetFocusedElement().CurrentControlType != 50004:
            raise RuntimeError("Expected the age field.")
        keys.write("30", interval=0.03)
        answer_key("tab")
        for _ in range(2):
            if uia.GetFocusedElement().CurrentControlType != 50013:
                raise RuntimeError("Expected a demographic choice.")
            answer_key("right")
            answer_key("tab")
        capture("demographics-filled")
        named_button("Weiter" if args.language == "de" else "Next")

    def likert(label, count):
        questionnaire()
        for _ in range(100):
            if uia.GetFocusedElement().CurrentControlType == 50013:
                break
            press("tab")
        else:
            raise RuntimeError("Expected a SurveyJS Likert choice.")
        for index in range(count):
            if uia.GetFocusedElement().CurrentControlType != 50013:
                raise RuntimeError(f"Expected radio input at {label} item {index + 1}.")
            answer_key("right")
            answer_key("tab")
        capture(label + "-filled")
        named_button("Weiter" if args.language == "de" else "Next")

    def playback():
        deadline = time.monotonic() + 300
        frame = 0
        while time.monotonic() < deadline:
            guard()
            fail_if_error()
            if visible("runner-receipt") and control("runner-receipt").window_text().strip():
                capture("terminal-receipt")
                return
            capture(f"playback-{frame:03d}")
            frame += 1
            time.sleep(5)
        raise TimeoutError("No terminal receipt within five minutes; execution is not verified.")

    def master6_survey(label, position, next_position=None):
        wait_step(position, f"master6 questionnaire step {position}", 90)
        questionnaire()
        control_kind = focus_boolean_answer()
        if control_kind == "toggle":
            # Toggle true and then false so an explicit false value is admitted;
            # this keeps the conditional detail page out of this fixed smoke.
            press("space", purpose="synthetic-questionnaire-answer")
            time.sleep(0.4)
            press("space", purpose="synthetic-questionnaire-answer")
        else:
            press("space", purpose="synthetic-questionnaire-answer")
        time.sleep(0.5)
        fail_if_error()
        capture(label + "-answered")
        named_button("Weiter" if args.language == "de" else "Next")
        if next_position is None:
            wait_for(lambda: visible("runner-receipt") and control("runner-receipt").window_text().strip(), "master6 terminal receipt", 90)
        else:
            wait_step(next_position, f"master6 step {next_position}", 90)

    def master6_stimulus():
        wait_step(3, "master6 leading interval", 30)
        capture("leading-isi")
        wait_step(4, "master6 video start", 30)
        capture("video-started")
        for direction in ["up", "right", "down", "left", "up", "right"]:
            press(direction, purpose="affect-rating-input")
            time.sleep(0.5)
        capture("video-after-affect-input")
        deadline = time.monotonic() + 360
        next_capture = time.monotonic() + 30
        frame = 0
        while time.monotonic() < deadline:
            guard()
            fail_if_error()
            if session_step() == (5, 6):
                capture("trailing-isi")
                wait_step(6, "master6 after-session questionnaire", 30)
                return
            if time.monotonic() >= next_capture:
                capture(f"video-progress-{frame:02d}")
                frame += 1
                next_capture += 30
            time.sleep(0.25)
        raise TimeoutError("The exact master6 video did not reach its trailing interval within six minutes.")

    def terminal():
        wait_for(lambda: visible("runner-receipt") and control("runner-receipt").window_text().strip(), "terminal receipt", 90)
        capture("terminal-receipt")

    error = None
    try:
        capture("initial")
        if args.phase == "all":
            phases = (["setup", "demographics", "maia", "tas", "playback"] if profile["recipeVersion"] == 3
                      else ["setup", "survey-before-1", "survey-before-2", "stimulus", "survey-after", "terminal"])
        else:
            phases = [args.phase]
        for phase in phases:
            if phase == "setup": setup()
            elif phase == "settings": settings()
            elif phase == "launch": launch()
            elif phase == "prepare":
                press("tab", 1 if args.language == "en" else 2)
                press("enter")
                questionnaire()
            elif phase == "demographics": demographics()
            elif phase == "maia": likert("maia", 37)
            elif phase == "tas": likert("tas", 20)
            elif phase == "playback": playback()
            elif phase == "survey-before-1": master6_survey("survey-before-1", 1, 2)
            elif phase == "survey-before-2": master6_survey("survey-before-2", 2, 3)
            elif phase == "stimulus": master6_stimulus()
            elif phase == "survey-after": master6_survey("survey-after", 6)
            elif phase == "terminal": terminal()
        capture("final")
    except Exception as exc:
        error = str(exc)
        try: capture("blocked")
        except Exception: pass
    finally:
        release_runner_topmost()
        (args.output / "receipt.json").write_text(json.dumps({
            "schema": "affect-runner-foreground-keyboard-smoke",
            "version": 2,
            "createdAtUtc": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
            "recipeSha256": hashlib.sha256(recipe_bytes).hexdigest(),
            "scriptSha256": sha256_file(Path(__file__).resolve()),
            "profile": profile,
            "pid": args.pid,
            "participantNumber": args.participant_number,
            "phase": args.phase,
            "language": args.language,
            "validationRequested": True,
            "error": error,
            "physicalInputs": physical_inputs,
            "observations": observations,
            "qualification": "Foreground GUI and physical-key evidence only; the session remains permanently unqualified and XDF/timing require independent verification.",
        }, ensure_ascii=False, indent=2), encoding="utf-8")
    if error:
        raise SystemExit(error)


if __name__ == "__main__":
    main()
