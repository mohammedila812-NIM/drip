/// Pure function to detect private/sensitive windows based on executable name,
/// window title, or presentation mode (e.g. QUNS_PRESENTATION_MODE).
pub fn is_private(exe: &str, title: &str, presentation_mode: bool) -> bool {
    if presentation_mode {
        return true;
    }

    let exe_lower = exe.to_ascii_lowercase();
    const PRIVATE_EXES: &[&str] = &[
        "1password",
        "bitwarden",
        "keepass",
        "keepassxc",
        "lastpass",
        "dashlane",
        "enpass",
        "nordpass",
    ];

    for p in PRIVATE_EXES {
        if exe_lower == *p || exe_lower == format!("{p}.exe") {
            return true;
        }
    }

    let title_lower = title.to_ascii_lowercase();
    title_lower.contains("inprivate")
        || title_lower.contains("incognito")
        || title_lower.contains("private browsing")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_is_private_table_driven() {
        struct Case {
            exe: &'static str,
            title: &'static str,
            presentation: bool,
            expected: bool,
        }

        let cases = [
            // Presentation mode
            Case { exe: "code", title: "Project - Visual Studio Code", presentation: true, expected: true },
            Case { exe: "powerpnt", title: "Slide Show", presentation: true, expected: true },

            // Password managers (with and without .exe)
            Case { exe: "1password", title: "1Password", presentation: false, expected: true },
            Case { exe: "1password.exe", title: "Locked", presentation: false, expected: true },
            Case { exe: "Bitwarden", title: "Vault", presentation: false, expected: true },
            Case { exe: "keepass", title: "Database.kdbx - KeePass", presentation: false, expected: true },
            Case { exe: "keepassxc", title: "KeePassXC", presentation: false, expected: true },
            Case { exe: "lastpass", title: "LastPass", presentation: false, expected: true },
            Case { exe: "dashlane", title: "Dashlane", presentation: false, expected: true },
            Case { exe: "enpass", title: "Enpass", presentation: false, expected: true },
            Case { exe: "nordpass", title: "NordPass", presentation: false, expected: true },

            // Private browsing windows
            Case { exe: "msedge", title: "InPrivate - Microsoft Edge", presentation: false, expected: true },
            Case { exe: "chrome", title: "New Incognito Tab - Google Chrome", presentation: false, expected: true },
            Case { exe: "firefox", title: "Mozilla Firefox (Private Browsing)", presentation: false, expected: true },

            // Regular non-private windows
            Case { exe: "code", title: "App.tsx - drip", presentation: false, expected: false },
            Case { exe: "chrome", title: "GitHub - mohammedila812-NIM/drip", presentation: false, expected: false },
            Case { exe: "msedge", title: "Documentation", presentation: false, expected: false },
            Case { exe: "explorer", title: "Downloads", presentation: false, expected: false },
            Case { exe: "spotify", title: "Spotify Free", presentation: false, expected: false },
        ];

        for c in cases {
            let actual = is_private(c.exe, c.title, c.presentation);
            assert_eq!(
                actual, c.expected,
                "Failed case: exe='{}', title='{}', presentation={}",
                c.exe, c.title, c.presentation
            );
        }
    }
}
