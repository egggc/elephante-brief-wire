// A summary written in both languages (the English summary, a blank line, then the Chinese headline and summary
// on their own lines: bilingualCopy in the backend's editorial writing) shows as an English block and a Chinese
// one. Any other summary shows as it is.

export interface Bilingual {
  en: string;
  zhTitle: string | null;
  zh: string;
}

const HAN = /[一-鿿]/;

export function splitBilingual(summary: string): Bilingual | null {
  const at = summary.indexOf("\n\n");
  if (at < 0) return null;
  const rest = summary.slice(at + 2).trim();
  if (!HAN.test(rest) || HAN.test(summary.slice(0, at))) return null;
  const [first, ...more] = rest.split("\n");
  return { en: summary.slice(0, at).trim(), zhTitle: more.length ? first!.trim() : null, zh: (more.length ? more.join("\n") : first!).trim() };
}

export function BilingualSummary({ summary, className = "", zhTitleClassName = "", zhClassName = "" }: { summary: string; className?: string; zhTitleClassName?: string; zhClassName?: string }) {
  const parts = splitBilingual(summary);
  if (!parts) return <p className={className}>{summary}</p>;
  return (
    <>
      <p className={className}>{parts.en}</p>
      <div lang="zh-CN" className="mt-3 border-l-2 border-line pl-3">
        {parts.zhTitle && <p className={`font-semibold text-ink-2 ${zhTitleClassName}`}>{parts.zhTitle}</p>}
        <p className={zhClassName}>{parts.zh}</p>
      </div>
    </>
  );
}
