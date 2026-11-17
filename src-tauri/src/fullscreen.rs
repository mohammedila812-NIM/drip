/// Transient shell window class names confirmed in authoritative Windows sources:
/// - "Shell_TrayWnd": Primary Windows Taskbar (Microsoft Win32 UI docs: Taskbar Window Class)
/// - "Shell_SecondaryTrayWnd": Secondary monitor Windows Taskbar (Microsoft Win32 UI docs)
/// - "Progman": Desktop Program Manager window (Microsoft Win32 SDK / Raymond Chen "The Old New Thing")
/// - "WorkerW": Desktop Worker window hosting wallpaper behind icons (Raymond Chen / Windows Internals)
/// - "XamlExplorerHostIslandWindow": Windows 11 modern taskbar / tray flyout host (Windows App SDK / WinUI 3 XAML Islands)
/// - "Windows.UI.Core.CoreWindow": UWP modern system flyouts, Start menu, Action Center (Microsoft Windows SDK / MSDN)
/// - "MultitaskingViewFrame": Windows 10/11 Task View and Alt+Tab switcher frame (Windows Sysinternals / Windows Internals)
pub const TRANSIENT_SHELL_CLASSES: &[&str] = &[
    "Shell_TrayWnd",
    "Shell_SecondaryTrayWnd",
    "Progman",
    "WorkerW",
    "XamlExplorerHostIslandWindow",
    "Windows.UI.Core.CoreWindow",
    "MultitaskingViewFrame",
];

/// Pure function to test whether a window class name corresponds to a known transient shell window.
pub fn is_transient_shell(class: &str) -> bool {
    TRANSIENT_SHELL_CLASSES.contains(&class)
}

/// Pure debouncer for fullscreen mode transitions with injectable time.
/// The state flag flips only after the candidate state has remained stable for `debounce_ms` (400 ms).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct FullscreenDebouncer {
    current_state: bool,
    candidate_state: bool,
    candidate_since_ms: u64,
    debounce_ms: u64,
}

impl FullscreenDebouncer {
    pub fn new(initial_state: bool, debounce_ms: u64) -> Self {
        Self {
            current_state: initial_state,
            candidate_state: initial_state,
            candidate_since_ms: 0,
            debounce_ms,
        }
    }

    /// Updates the candidate state at timestamp `now_ms`.
    /// Returns the active debounced state.
    pub fn update(&mut self, candidate: bool, now_ms: u64) -> bool {
        if candidate != self.candidate_state {
            self.candidate_state = candidate;
            self.candidate_since_ms = now_ms;
        }

        if self.candidate_state != self.current_state
            && now_ms.saturating_sub(self.candidate_since_ms) >= self.debounce_ms
        {
            self.current_state = self.candidate_state;
        }

        self.current_state
    }

    pub fn state(&self) -> bool {
        self.current_state
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_transient_shell() {
        assert!(is_transient_shell("Shell_TrayWnd"));
        assert!(is_transient_shell("Shell_SecondaryTrayWnd"));
        assert!(is_transient_shell("Progman"));
        assert!(is_transient_shell("WorkerW"));
        assert!(is_transient_shell("XamlExplorerHostIslandWindow"));
        assert!(is_transient_shell("Windows.UI.Core.CoreWindow"));
        assert!(is_transient_shell("MultitaskingViewFrame"));

        // Regular applications must not match
        assert!(!is_transient_shell("Chrome_WidgetWin_1"));
        assert!(!is_transient_shell("CabinetWClass"));
        assert!(!is_transient_shell("Notepad"));
    }

    #[test]
    fn test_fullscreen_debounce_flips_after_400ms_stable() {
        let mut debouncer = FullscreenDebouncer::new(false, 400);
        assert_eq!(debouncer.state(), false);

        // Candidate becomes true at t = 100ms
        assert_eq!(debouncer.update(true, 100), false);
        // At t = 300ms (200ms elapsed), still false
        assert_eq!(debouncer.update(true, 300), false);
        // At t = 499ms (399ms elapsed), still false
        assert_eq!(debouncer.update(true, 499), false);
        // At t = 500ms (400ms elapsed), flips to true!
        assert_eq!(debouncer.update(true, 500), true);
        assert_eq!(debouncer.state(), true);
    }

    #[test]
    fn test_fullscreen_debounce_resets_on_flicker() {
        let mut debouncer = FullscreenDebouncer::new(false, 400);

        // Candidate becomes true at t = 100ms
        assert_eq!(debouncer.update(true, 100), false);
        // At t = 350ms, candidate flickers back to false
        assert_eq!(debouncer.update(false, 350), false);
        // At t = 400ms, candidate becomes true again
        assert_eq!(debouncer.update(true, 400), false);
        // At t = 700ms (only 300ms since last change), still false!
        assert_eq!(debouncer.update(true, 700), false);
        // At t = 800ms (400ms since t=400), flips to true!
        assert_eq!(debouncer.update(true, 800), true);
    }

    #[test]
    fn test_fullscreen_debounce_flip_back_to_false() {
        let mut debouncer = FullscreenDebouncer::new(true, 400);
        assert_eq!(debouncer.state(), true);

        // Candidate becomes false at t = 100ms
        assert_eq!(debouncer.update(false, 100), true);
        // At t = 500ms (400ms elapsed), flips to false
        assert_eq!(debouncer.update(false, 500), false);
    }
}
