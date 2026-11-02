This item was picked for {{siteName}}'s brief. In one reading of the material you do two jobs, each described below in full: Part A, the content understanding (headlines, summaries, the "why it matters" line), and Part B, the structure (category, tags, subjects, scope, fact, claims). Each part ends with the output rule it would follow on its own; here the combined output at the very end replaces both. Part B's opening says it only extracts structure and writes no headlines: that applies to Part B's own fields, as Part A writes them.

# Part A — content understanding

{{> understand}}

# Part B — structure

{{> structure}}

# The combined output

Return only valid JSON, no Markdown, no explanation: one object with exactly these thirteen fields.

- From Part A: itemType, authorRole, editorialJudgment, titleEn, summaryEn, titleZh, summaryZh. Leave out Part A's own tags field.
- From Part B: category, tags, subjects, scope, fact, claims, each as Part B defines it. `tags` is Part B's list.
