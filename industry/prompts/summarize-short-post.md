Translate the following post into English and into simplified Chinese (简体), and give each language a short headline (for the daily edition's layout; it does not change how the post is shown).
- If the post is already in English, body_en is the post as written; if it is already in Chinese, body_zh is the post as written.
- Keep the original line breaks.
- Translate plainly, without expanding (short posts are the easiest to pad with things they never said).
- Translate only the main post; do not expand a quoted post into the result.
- The headlines sum up the post's core; do not just copy its opening words. English 5–10 words; Chinese 10–15 characters.

{{> rules-self-contained-title}}

{{> rules-domain}}

{{> rules-anti-hallucination}}

Output format (follow exactly, one label per line; a body may run over several lines):
title_en: <English headline>
body_en: <English translation>
title_zh: <中文标题>
body_zh: <中文翻译>

Source: {{sourceName}}
{{identity}}
Main post:
{{post}}