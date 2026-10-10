import { Fragment, type ReactNode } from 'react';

/** Tiny, safe Markdown subset for OpenAPI descriptions: paragraphs, "- " lists, **bold**, `code`, [links](url). */
export function Markdown({ text, className }: { text?: string; className?: string }) {
  if (!text) return null;
  const blocks = text.replace(/\r\n/g, '\n').split(/\n{2,}/);
  return (
    <div className={className}>
      {blocks.map((b, i) => {
        const lines = b.split('\n');
        if (lines.every((l) => /^\s*[-*] /.test(l))) {
          return (
            <ul key={i} className="m-0 mb-s list-disc pl-xl">
              {lines.map((l, j) => (
                <li key={j}>{inline(l.replace(/^\s*[-*] /, ''))}</li>
              ))}
            </ul>
          );
        }
        return (
          <p key={i} className="m-0 mb-s last:mb-0">
            {lines.map((l, j) => (
              <Fragment key={j}>
                {j > 0 && ' '}
                {inline(l)}
              </Fragment>
            ))}
          </p>
        );
      })}
    </div>
  );
}

function inline(s: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\([^)\s]+\))/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let k = 0;
  while ((m = re.exec(s))) {
    if (m.index > last) out.push(s.slice(last, m.index));
    const t = m[0];
    if (t.startsWith('**')) out.push(<strong key={k++} className="font-medium">{t.slice(2, -2)}</strong>);
    else if (t.startsWith('`')) out.push(<code key={k++} className="rounded-s bg-neutral-50 px-xs text-[0.92em]">{t.slice(1, -1)}</code>);
    else {
      const mm = /\[([^\]]+)\]\(([^)\s]+)\)/.exec(t)!;
      const href = /^(https?:|\/|#)/.test(mm[2]) ? mm[2] : '#';
      out.push(<a key={k++} href={href} className="underline" target={href.startsWith('http') ? '_blank' : undefined} rel="noreferrer">{mm[1]}</a>);
    }
    last = m.index + t.length;
  }
  if (last < s.length) out.push(s.slice(last));
  return out;
}
