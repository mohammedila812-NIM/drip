use std::path::{Component, Path, PathBuf};
use serde_json::Value;

/// Strips the UTF-8 Byte Order Mark (U+FEFF), if present at the start of `s`.
pub fn strip_bom(s: &str) -> &str {
    s.strip_prefix('\u{FEFF}').unwrap_or(s)
}

/// Checks whether a plugin directory ID is safe from path traversal and injection.
pub fn safe_id(id: &str) -> bool {
    !id.is_empty()
        && !id.starts_with('.')
        && !id.contains("..")
        && !id.contains('/')
        && !id.contains('\\')
        && id.chars().all(|c| c.is_ascii_alphanumeric() || "-_.".contains(c))
}

/// Validates that a relative file path contains only normal path components
/// (no parent directory '..', no absolute root, no prefix).
pub fn safe_relative_path(file: &str) -> Result<PathBuf, String> {
    let p = Path::new(file);
    if p.as_os_str().is_empty() {
        return Err("empty file path".into());
    }
    for c in p.components() {
        match c {
            Component::Normal(_) => {}
            _ => return Err(format!("path traversal detected: invalid component in '{}'", file)),
        }
    }
    Ok(p.to_path_buf())
}

/// Deterministic 64-bit FNV-1a hash formatted as a 16-character hexadecimal string.
pub fn fnv1a_hash(parts: &[&str]) -> String {
    let mut hash: u64 = 0xcbf29ce484222325;
    for part in parts {
        for byte in part.as_bytes() {
            hash ^= *byte as u64;
            hash = hash.wrapping_mul(0x100000001b3);
        }
        hash ^= 0xff;
        hash = hash.wrapping_mul(0x100000001b3);
    }
    format!("{:016x}", hash)
}

/// Safely reads the code for a worker plugin, guaranteeing no directory traversal.
pub fn read_plugin_code_safe(plugins_dir: &Path, id: &str) -> Result<String, String> {
    if !safe_id(id) {
        return Err("invalid plugin id".into());
    }
    let plugin_dir = plugins_dir.join(id);
    let manifest_path = plugin_dir.join("plugin.json");
    let content = std::fs::read_to_string(&manifest_path).map_err(|e| e.to_string())?;
    let clean = strip_bom(&content);
    let m: Value = serde_json::from_str(clean).map_err(|e| e.to_string())?;
    let main = m["main"].as_str().ok_or("no main file specified in manifest")?;
    let rel_path = safe_relative_path(main)?;
    let target_path = plugin_dir.join(rel_path);
    std::fs::read_to_string(target_path).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_strip_bom() {
        assert_eq!(strip_bom("\u{FEFF}{\"name\": \"test\"}"), "{\"name\": \"test\"}");
        assert_eq!(strip_bom("{\"name\": \"test\"}"), "{\"name\": \"test\"}");
        assert_eq!(strip_bom(""), "");
    }

    #[test]
    fn test_safe_id() {
        assert!(safe_id("focus-timer"));
        assert!(safe_id("test_plugin.1"));
        assert!(!safe_id(""));
        assert!(!safe_id(".hidden"));
        assert!(!safe_id(".."));
        assert!(!safe_id("../escape"));
        assert!(!safe_id("foo/bar"));
        assert!(!safe_id("foo\\bar"));
    }

    #[test]
    fn test_safe_relative_path() {
        assert!(safe_relative_path("index.js").is_ok());
        assert!(safe_relative_path("src/index.js").is_ok());
        assert!(safe_relative_path("../index.js").is_err());
        assert!(safe_relative_path("a/../../index.js").is_err());
        assert!(safe_relative_path("/root/index.js").is_err());
        assert!(safe_relative_path("").is_err());
    }

    #[test]
    fn test_read_plugin_code_safe_path_traversal() {
        let temp = std::env::temp_dir().join(format!("drip_test_{}", std::process::id()));
        let plugin_dir = temp.join("good-plugin");
        let _ = std::fs::create_dir_all(&plugin_dir);

        // Good manifest and code
        std::fs::write(plugin_dir.join("plugin.json"), "{\"main\": \"index.js\"}").unwrap();
        std::fs::write(plugin_dir.join("index.js"), "console.log('hello');").unwrap();

        let code = read_plugin_code_safe(&temp, "good-plugin");
        assert_eq!(code.unwrap(), "console.log('hello');");

        // Traversal in id
        assert!(read_plugin_code_safe(&temp, "../good-plugin").is_err());

        // Traversal in manifest 'main'
        let bad_dir = temp.join("bad-plugin");
        let _ = std::fs::create_dir_all(&bad_dir);
        std::fs::write(bad_dir.join("plugin.json"), "{\"main\": \"../good-plugin/index.js\"}").unwrap();

        let err = read_plugin_code_safe(&temp, "bad-plugin");
        assert!(err.is_err());
        assert!(err.unwrap_err().contains("path traversal detected"));

        let _ = std::fs::remove_dir_all(&temp);
    }

    #[test]
    fn test_fnv1a_hash() {
        let h1 = fnv1a_hash(&["a", "b"]);
        let h2 = fnv1a_hash(&["a", "b"]);
        let h3 = fnv1a_hash(&["a", "c"]);
        assert_eq!(h1, h2);
        assert_ne!(h1, h3);
        assert_eq!(h1.len(), 16);
    }
}
