"""Agent-only real-keyboard smoke. Never shipped with Experiment Runner.

Install PyAutoGUI==0.9.54 and pywinauto==0.6.9 in an isolated test environment.
Run --phase inspect first, then setup, demographics, maia, tas, playback or all.
Requires an explicitly selected PID and the intended Runner in the foreground.
Every phase captures the actual window. A blocked UI aborts; this script never
changes capability flags, injects app state, or supplies simulated native replies.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import site
import sys
import time


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--pid", type=int, required=True)
    parser.add_argument("--recipe", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--deps", type=Path)
    parser.add_argument("--language", choices=["en", "de"], default="en")
    parser.add_argument("--phase", choices=["inspect", "setup", "prepare", "demographics", "maia", "tas", "playback", "all"], default="inspect")
    args = parser.parse_args()
    if args.deps:
        site.addsitedir(str(args.deps.resolve()))
    import pyautogui as keys
    import win32gui
    import win32process
    from pywinauto import Application
    from pywinauto.uia_defines import IUIA

    recipe_bytes = args.recipe.read_bytes()
    recipe = json.loads(recipe_bytes)
    if recipe.get("schema") != "affect-research-planner-recipe" or recipe.get("version") != 3:
        raise ValueError("This sequence targets the explicit master3 mock only.")
    if recipe["segments"]["P1"]["study"]["id"] != "mock-dictator":
        raise ValueError("Refusing to enter synthetic answers into a different study.")
    args.output.mkdir(parents=True, exist_ok=False)
    app = Application(backend="uia").connect(process=args.pid)
    window = app.window(title="Experiment Runner")
    window.wait("exists visible", timeout=10)
    window.set_focus()
    keys.FAILSAFE = True
    keys.PAUSE = 0.15
    observations = []
    uia = IUIA().iuia

    def guard():
        foreground = win32gui.GetForegroundWindow()
        if win32process.GetWindowThreadProcessId(foreground)[1] != args.pid:
            raise RuntimeError("Runner lost foreground focus; no key was sent.")

    def control(identifier):
        return window.child_window(auto_id=identifier)

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
        texts = [child.window_text() for child in window.descendants(control_type="Text") if child.is_visible()]
        guard()
        observations.append({"stage": label, "monotonicSeconds": time.monotonic(), "screenshot": file.name, "visibleText": texts})

    def press(key, count=1):
        guard()
        keys.press(key, presses=count, interval=0.15)

    def focus(identifier):
        for _ in range(100):
            guard()
            if uia.GetFocusedElement().CurrentAutomationId == identifier:
                return
            press("tab")
        raise RuntimeError("Keyboard could not reach " + identifier)

    def button(identifier):
        if not visible(identifier) or not control(identifier).is_enabled():
            raise RuntimeError("Required control is unavailable: " + identifier)
        focus(identifier)
        press("enter")

    def questionnaire(title_fragment):
        wait_for(lambda: visible("runner-questionnaire-title") and title_fragment.casefold() in control("runner-questionnaire-title").window_text().casefold(), "Expected questionnaire: " + title_fragment, 90)
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
        wait_for(lambda: visible("runner-variant") and control("runner-variant").is_enabled(), "Recipe load", 90)
        focus("runner-variant")
        press("home")
        press("down")
        press("tab")
        focus("runner-participant")
        keys.hotkey("ctrl", "a")
        keys.write("1")
        press("tab")
        wait_for(lambda: control("runner-launch").is_enabled(), "Participant/version selection")
        button("runner-launch")
        wait_for(lambda: visible("runner-preparation"), "Fullscreen preparation")
        # Fresh preparation focuses its heading. The mock has EN then DE buttons.
        press("tab", 1 if args.language == "en" else 2)
        press("enter")
        capture("language-selected")
        button("runner-prepare")
        questionnaire("demogra")

    def demographics():
        questionnaire("demogra")
        if uia.GetFocusedElement().CurrentControlType != 50004:
            raise RuntimeError("Expected focused text field; refusing to type a name elsewhere.")
        keys.write("Synthetic Keyboard Test", interval=0.03)
        answer_key("enter")
        keys.write("30", interval=0.03)
        answer_key("enter")
        answer_key("end")
        answer_key("enter")
        answer_key("home")
        answer_key("enter")
        if uia.GetFocusedElement().CurrentAutomationId != "runner-questionnaire-submit":
            raise RuntimeError("Demographics did not advance to Submit.")
        capture("demographics-filled")
        press("enter")

    def likert(label, count):
        questionnaire("Multidimensional" if label == "maia" else "Toronto" if args.language == "en" else "TAS-20")
        for index in range(count):
            if uia.GetFocusedElement().CurrentControlType != 50013:
                raise RuntimeError(f"Expected radio input at {label} item {index + 1}.")
            answer_key("home")
            answer_key("right")
            answer_key("enter")
        if uia.GetFocusedElement().CurrentAutomationId != "runner-questionnaire-submit":
            raise RuntimeError("Final item did not advance to Submit.")
        capture(label + "-filled")
        press("enter")

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

    error = None
    try:
        capture("initial")
        phases = ["setup", "demographics", "maia", "tas", "playback"] if args.phase == "all" else [args.phase]
        for phase in phases:
            if phase == "setup": setup()
            elif phase == "prepare":
                button("runner-prepare")
                questionnaire("demogra")
            elif phase == "demographics": demographics()
            elif phase == "maia": likert("maia", 37)
            elif phase == "tas": likert("tas", 20)
            elif phase == "playback": playback()
        capture("final")
    except Exception as exc:
        error = str(exc)
        try: capture("blocked")
        except Exception: pass
    finally:
        (args.output / "receipt.json").write_text(json.dumps({"recipeSha256": hashlib.sha256(recipe_bytes).hexdigest(), "pid": args.pid, "phase": args.phase, "language": args.language, "error": error, "observations": observations, "qualification": "GUI test evidence only; independently verify XDF and timing"}, ensure_ascii=False, indent=2), encoding="utf-8")
    if error:
        raise SystemExit(error)


if __name__ == "__main__":
    main()
