// Plain text whose https addresses are links (the reason line: an editor's pick names the post it came from).
// Raised above a card's whole-card link so they stay clickable.

export function LinkedText({ text }: { text: string }) {
  return (
    <>
      {text.split(/(https:\/\/[^\s]+)/).map((part, i) =>
        i % 2 ? <a key={i} href={part} target="_blank" rel="noopener noreferrer nofollow" className="relative z-10 underline underline-offset-2 break-all hover:text-accent">{part}</a> : part)}
    </>
  );
}
