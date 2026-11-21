//! HTML から、題と、全文検索の索引に入れる字を取り出す。
//! 索引用なので、正しい HTML の解釈までは要らない。tag を除き、script と style の中身を捨てる。

/// `<title>` の中身。無ければ空。
pub fn title(html: &str) -> String {
    let Some(open) = find_tag(html, "title", 0) else {
        return String::new();
    };
    let Some(start) = html[open..].find('>').map(|i| open + i + 1) else {
        return String::new();
    };
    let end = find_ci(html, "</title", start).unwrap_or(html.len());
    squeeze(&decode(&html[start..end]))
}

/// tag・script・style・comment を除いた字。空白は 1 つにまとめる。
pub fn plain(html: &str) -> String {
    let mut out = String::with_capacity(html.len() / 2);
    let mut rest = html;
    while let Some(lt) = rest.find('<') {
        out.push_str(&rest[..lt]);
        out.push(' ');
        rest = &rest[lt..];
        if let Some(body) = rest.strip_prefix("<!--") {
            rest = body.find("-->").map_or("", |i| &body[i + 3..]);
            continue;
        }
        let skip = ["script", "style"]
            .into_iter()
            .find(|name| find_tag(rest, name, 0) == Some(0));
        let Some(gt) = rest.find('>') else {
            rest = "";
            break;
        };
        rest = &rest[gt + 1..];
        if let Some(name) = skip {
            let close = format!("</{name}");
            rest = match find_ci(rest, &close, 0) {
                Some(i) => rest[i..].find('>').map_or("", |j| &rest[i + j + 1..]),
                None => "",
            };
        }
    }
    out.push_str(rest);
    squeeze(&decode(&out))
}

/// `<name` で始まり、名がそこで終わっている所（`<style>` は合い、`<styles>` は合わない）。
fn find_tag(s: &str, name: &str, from: usize) -> Option<usize> {
    let open = format!("<{name}");
    let mut at = from;
    while let Some(i) = find_ci(s, &open, at) {
        match s.as_bytes().get(i + open.len()) {
            Some(b) if b.is_ascii_alphanumeric() || *b == b'-' => at = i + 1,
            _ => return Some(i),
        }
    }
    None
}

/// ASCII の大文字・小文字を分けずに探す。`needle` は ASCII の小文字で渡す。
fn find_ci(s: &str, needle: &str, from: usize) -> Option<usize> {
    let (hay, needle) = (s.as_bytes(), needle.as_bytes());
    if needle.is_empty() || hay.len() < needle.len() {
        return None;
    }
    (from..=hay.len() - needle.len())
        .find(|&i| hay[i..i + needle.len()].eq_ignore_ascii_case(needle))
}

fn decode(s: &str) -> String {
    if !s.contains('&') {
        return s.to_owned();
    }
    // &amp; を最後に戻す（&amp;lt; を < にしないため）。
    s.replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&#39;", "'")
        .replace("&nbsp;", " ")
        .replace("&amp;", "&")
}

fn squeeze(s: &str) -> String {
    s.split_whitespace().collect::<Vec<_>>().join(" ")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn title_is_taken_from_the_title_tag() {
        let html =
            "<html><head><TITLE lang=\"ja\">\n SKILLS-14 計画: A &amp; B\n</TITLE></head></html>";
        assert_eq!(title(html), "SKILLS-14 計画: A & B");
    }

    #[test]
    fn title_is_empty_when_missing() {
        assert_eq!(title("<h1>題</h1>"), "");
        assert_eq!(title("<title"), "");
    }

    #[test]
    fn plain_drops_tags_scripts_styles_and_comments() {
        let html = "<style>body{color:red}</style><h1>一覧の UI</h1><!-- 隠す --><p>絞り込み<br>並べ替え</p>\
                    <SCRIPT type=\"module\">let a = '<p>x</p>';</SCRIPT><styles>残る</styles>";
        assert_eq!(plain(html), "一覧の UI 絞り込み 並べ替え 残る");
    }

    #[test]
    fn plain_decodes_entities_once() {
        assert_eq!(plain("<p>a &lt; b &amp;lt; c&nbsp;d</p>"), "a < b &lt; c d");
    }

    #[test]
    fn plain_survives_broken_html() {
        assert_eq!(plain("字 <p"), "字");
        assert_eq!(plain("字 <script>let a"), "字");
        assert_eq!(plain("字 <!-- 閉じない"), "字");
    }
}
