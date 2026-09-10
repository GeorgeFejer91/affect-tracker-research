use crate::research_native_media::NativeMediaViewportPxV1;
use std::marker::PhantomData;
use std::rc::Rc;
use std::thread::{self, ThreadId};
use windows::core::w;
use windows::Win32::Foundation::HWND;
use windows::Win32::UI::WindowsAndMessaging::{
    CreateWindowExW, DestroyWindow, DispatchMessageW, PeekMessageW, SetWindowPos, ShowWindow,
    TranslateMessage, MSG, PM_REMOVE, SWP_NOACTIVATE, SWP_NOOWNERZORDER, SWP_NOZORDER, SW_HIDE,
    SW_SHOWNA, WINDOW_EX_STYLE, WS_CHILD, WS_CLIPCHILDREN, WS_CLIPSIBLINGS,
};

/// Application-owned child HWND used exclusively by the GstPlay overlay.
///
/// Invariants:
/// - construction, mutation, message pumping, and destruction happen on the
///   same actor thread;
/// - the Tauri parent outlives this value;
/// - every GstPlay renderer is dropped before this value;
/// - no HWND or pointer is exposed to the WebView or another Rust module.
pub(super) struct ChildVideoWindow {
    hwnd: HWND,
    owner_thread: ThreadId,
    _not_send_or_sync: PhantomData<Rc<()>>,
}

impl ChildVideoWindow {
    pub(super) fn create(parent_handle: isize) -> Result<Self, &'static str> {
        if parent_handle == 0 {
            return Err("native-parent-window-invalid");
        }
        let parent = HWND(parent_handle as *mut std::ffi::c_void);
        // SAFETY: `parent` is obtained from Tauri's live Research window in the
        // composition root. The built-in STATIC class needs no project WndProc
        // or callback. This actor thread owns the returned child for its whole
        // lifetime and destroys it before the parent is released.
        let hwnd = unsafe {
            CreateWindowExW(
                WINDOW_EX_STYLE::default(),
                w!("STATIC"),
                w!(""),
                WS_CHILD | WS_CLIPSIBLINGS | WS_CLIPCHILDREN,
                0,
                0,
                1,
                1,
                Some(parent),
                None,
                None,
                None,
            )
        }
        .map_err(|_| "native-child-window-create-failed")?;
        Ok(Self {
            hwnd,
            owner_thread: thread::current().id(),
            _not_send_or_sync: PhantomData,
        })
    }

    pub(super) fn create_renderer(
        &self,
    ) -> Result<gstreamer_play::PlayVideoOverlayVideoRenderer, &'static str> {
        self.require_owner()?;
        // SAFETY: The HWND is a non-null live application-owned child window.
        // This method runs only on its owner actor thread, and the returned
        // renderer is stored and dropped before `ChildVideoWindow`. No panic or
        // Rust reference crosses the FFI boundary.
        Ok(unsafe { gstreamer_play::PlayVideoOverlayVideoRenderer::new(self.hwnd.0 as usize) })
    }

    pub(super) fn set_viewport(
        &self,
        viewport: NativeMediaViewportPxV1,
    ) -> Result<(), &'static str> {
        self.require_owner()?;
        if viewport.left_px < 0
            || viewport.top_px < 0
            || viewport.width_px < 1
            || viewport.height_px < 1
        {
            return Err("native-child-window-viewport-invalid");
        }
        // SAFETY: The HWND remains valid and owned by this thread. Coordinates
        // were finite, scaled, range-checked, and bounded to the parent client
        // area before reaching this adapter. Z-order and activation are not
        // changed.
        unsafe {
            SetWindowPos(
                self.hwnd,
                None,
                viewport.left_px,
                viewport.top_px,
                viewport.width_px,
                viewport.height_px,
                SWP_NOACTIVATE | SWP_NOOWNERZORDER | SWP_NOZORDER,
            )
        }
        .map_err(|_| "native-child-window-position-failed")
    }

    pub(super) fn show(&self) -> Result<(), &'static str> {
        self.require_owner()?;
        // SAFETY: The child HWND is valid and owned by this actor thread.
        let _ = unsafe { ShowWindow(self.hwnd, SW_SHOWNA) };
        Ok(())
    }

    pub(super) fn hide(&self) -> Result<(), &'static str> {
        self.require_owner()?;
        // SAFETY: The child HWND is valid and owned by this actor thread.
        let _ = unsafe { ShowWindow(self.hwnd, SW_HIDE) };
        Ok(())
    }

    pub(super) fn pump_messages(&self) -> Result<(), &'static str> {
        self.require_owner()?;
        let mut message = MSG::default();
        // SAFETY: `message` is valid writable storage. Only messages belonging
        // to this child are drained; dispatch cannot enter project Rust
        // callbacks because the built-in STATIC class owns the WndProc.
        unsafe {
            while PeekMessageW(&mut message, Some(self.hwnd), 0, 0, PM_REMOVE).as_bool() {
                let _ = TranslateMessage(&message);
                DispatchMessageW(&message);
            }
        }
        Ok(())
    }

    fn require_owner(&self) -> Result<(), &'static str> {
        if thread::current().id() == self.owner_thread && !self.hwnd.0.is_null() {
            Ok(())
        } else {
            Err("native-child-window-thread-affinity-violation")
        }
    }
}

impl Drop for ChildVideoWindow {
    fn drop(&mut self) {
        if thread::current().id() != self.owner_thread || self.hwnd.0.is_null() {
            return;
        }
        // SAFETY: Drop runs on the creating actor thread after all GstPlay
        // renderers were dropped. The handle is destroyed exactly once and is
        // immediately nulled to prevent accidental reuse.
        let _ = unsafe { DestroyWindow(self.hwnd) };
        self.hwnd = HWND(std::ptr::null_mut());
    }
}
