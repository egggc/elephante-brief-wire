// healthchecks.io (HEALTHCHECKS_URL, the check's ping address). Each triage pass that completes pings it, so
// the check goes down when passes stop; a model call the provider refuses for money (402: out of credit;
// 403: the key's credit limit) pings its /fail at once, at most every ten minutes while the refusals last.
const FAIL_EVERY_MS = 10 * 60_000;
let lastFail = 0;

const base = () => process.env.HEALTHCHECKS_URL?.trim().replace(/\/+$/, "") || null;

async function ping(path: string, body: string): Promise<void> {
  const url = base();
  if (!url) return;
  try {
    await fetch(`${url}${path}`, { method: "POST", body: body.slice(0, 10_000), signal: AbortSignal.timeout(10_000) });
  } catch (error) {
    console.error(`healthchecks ping ${path || "/"} failed: ${String(error)}`);
  }
}

export function pingSuccess(message: string): Promise<void> {
  return ping("", message);
}

/** A refusal for money: the check fails now. */
export async function pingCreditRefusal(service: string, status: number, message: string): Promise<void> {
  if (Date.now() - lastFail < FAIL_EVERY_MS) return;
  lastFail = Date.now();
  await ping("/fail", `${service} refused a model call with HTTP ${status} (${status === 402 ? "out of credit" : "key or credit limit"}): ${message}`);
}
