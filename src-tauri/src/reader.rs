use std::io::BufRead;

/// Reads a line from `reader`, capped at `cap` bytes.
/// - Uses `read_until(b'\n')`
/// - Converts bytes using `String::from_utf8_lossy`
/// - Drops the remainder of any oversized line up to the newline
/// - Strips trailing CRLF / LF
/// - Handles EOF without a trailing newline
pub fn read_line_capped<R: BufRead>(reader: &mut R, cap: usize) -> std::io::Result<Option<String>> {
    let mut buf = Vec::new();
    let n = reader.read_until(b'\n', &mut buf)?;
    if n == 0 {
        return Ok(None);
    }

    let ends_with_nl = buf.last() == Some(&b'\n');

    // If buffer exceeds cap, truncate it and discard any remaining bytes of this line
    if buf.len() > cap {
        buf.truncate(cap);
        if !ends_with_nl {
            let mut discard = Vec::new();
            while reader.read_until(b'\n', &mut discard)? > 0 {
                if discard.last() == Some(&b'\n') {
                    break;
                }
                discard.clear();
            }
        }
    }

    // Strip trailing CRLF or LF
    while buf.last() == Some(&b'\n') || buf.last() == Some(&b'\r') {
        buf.pop();
    }

    Ok(Some(String::from_utf8_lossy(&buf).into_owned()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Cursor;

    #[test]
    fn test_valid_utf8() {
        let mut cursor = Cursor::new(b"hello world\nline two\n");
        assert_eq!(read_line_capped(&mut cursor, 16384).unwrap(), Some("hello world".into()));
        assert_eq!(read_line_capped(&mut cursor, 16384).unwrap(), Some("line two".into()));
        assert_eq!(read_line_capped(&mut cursor, 16384).unwrap(), None);
    }

    #[test]
    fn test_invalid_bytes() {
        // 0x82 is invalid UTF-8 and should be lossily converted to replacement char U+FFFD
        let mut cursor = Cursor::new(b"hello \x82 world\n");
        let line = read_line_capped(&mut cursor, 16384).unwrap();
        assert_eq!(line, Some("hello \u{FFFD} world".into()));
    }

    #[test]
    fn test_over_cap_line() {
        // Line exceeds 10 bytes: first line has 16 bytes followed by newline
        let mut cursor = Cursor::new(b"0123456789abcdef\nnext line\n");
        // With cap=10, the line should be truncated to "0123456789"
        let line1 = read_line_capped(&mut cursor, 10).unwrap();
        assert_eq!(line1, Some("0123456789".into()));

        // The second line must read correctly from after the newline of the oversized line
        let line2 = read_line_capped(&mut cursor, 10).unwrap();
        assert_eq!(line2, Some("next line".into()));
    }

    #[test]
    fn test_crlf() {
        let mut cursor = Cursor::new(b"first\r\nsecond\r\n");
        assert_eq!(read_line_capped(&mut cursor, 16384).unwrap(), Some("first".into()));
        assert_eq!(read_line_capped(&mut cursor, 16384).unwrap(), Some("second".into()));
        assert_eq!(read_line_capped(&mut cursor, 16384).unwrap(), None);
    }

    #[test]
    fn test_eof_without_newline() {
        let mut cursor = Cursor::new(b"no trailing newline");
        assert_eq!(read_line_capped(&mut cursor, 16384).unwrap(), Some("no trailing newline".into()));
        assert_eq!(read_line_capped(&mut cursor, 16384).unwrap(), None);
    }
}
