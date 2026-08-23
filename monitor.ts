import { appendFile, readFile, writeFile } from "node:fs/promises";

const BASE_URL = process.env.PIXL_BASE_URL ?? "https://pixl.hackclub.com";
const PAGES = ["/", "/play", "/explore", "/shop", "/docs", "/ideas"];
const TIMEOUT_MS = 10_000;
const NTFY_URL = process.env.NTFY_URL ?? "https://ntfy.sh";
const TOPIC = process.env.NTFY_TOPIC ?? "";
const STATE_FILE = new URL("./state.json", import.meta.url);

type PageState = { down: boolean; since: string | null };
type State = Record<string, PageState>;
type CheckResult = { path: string; ok: boolean; detail: string };

async function loadState(): Promise<State> {
  try {
    return JSON.parse(await readFile(STATE_FILE, "utf8")) as State;
  } catch {
    return {};
  }
}

async function checkPage(path: string): Promise<CheckResult> {
  try {
    const res = await fetch(`${BASE_URL}${path}`, {
      redirect: "follow",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (res.status >= 400) {
      return { path, ok: false, detail: `HTTP ${res.status}` };
    }
    return { path, ok: true, detail: `HTTP ${res.status}` };
  } catch (err) {
    const detail = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
    return { path, ok: false, detail };
  }
}

function formatDuration(sinceIso: string): string {
  const mins = Math.max(1, Math.round((Date.now() - Date.parse(sinceIso)) / 60_000));
  if (mins < 60) return `${mins}m`;
  const h = Math.floor(mins / 60);
  return `${h}h ${mins % 60}m`;
}

async function notify(opts: { title: string; message: string; priority: number; tags: string[] }) {
  if (!TOPIC) throw new Error("NTFY_TOPIC is not set");
  const res = await fetch(NTFY_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ topic: TOPIC, click: BASE_URL, ...opts }),
  });
  if (!res.ok) throw new Error(`ntfy publish failed: HTTP ${res.status}`);
}

async function main() {
  const state = await loadState();
  const needsSeed = Object.keys(state).length < PAGES.length;
  const now = new Date().toISOString();
  const results = await Promise.all(PAGES.map(checkPage));

  const downs: CheckResult[] = [];
  const recoveries: { result: CheckResult; duration: string }[] = [];

  for (const r of results) {
    const prev = state[r.path];
    if (!r.ok && prev?.down !== true) {
      downs.push(r);
      state[r.path] = { down: true, since: now };
    } else if (r.ok && prev?.down === true) {
      recoveries.push({ result: r, duration: formatDuration(prev.since ?? now) });
      state[r.path] = { down: false, since: null };
    } else if (!prev) {
      state[r.path] = { down: false, since: null };
    }
  }

  const stateChanged = downs.length > 0 || recoveries.length > 0;

  let notifyFailed = false;
  try {
    if (downs.length > 0) {
      const title =
        downs.length === 1
          ? `Pixl is DOWN: ${downs[0].path}`
          : `Pixl is DOWN: ${downs.length} pages failing`;
      const message = downs.map((d) => `${d.path} -> ${d.detail}`).join("\n") + `\n\nchecked ${now}`;
      await notify({ title, message, priority: 5, tags: ["rotating_light"] });
    }
    if (recoveries.length > 0) {
      const title =
        recoveries.length === 1
          ? `Pixl back UP: ${recoveries[0].result.path}`
          : `Pixl back UP: ${recoveries.length} pages recovered`;
      const message =
        recoveries.map((r) => `${r.result.path} (down for ${r.duration})`).join("\n") +
        `\n\nchecked ${now}`;
      await notify({ title, message, priority: 3, tags: ["white_check_mark"] });
    }
  } catch (err) {
    console.error(err instanceof Error ? err.message : err);
    notifyFailed = true;
  }

  if (notifyFailed) {
    console.error("Keeping previous state so the alert retries on the next run.");
  } else if (stateChanged || needsSeed) {
    await writeFile(STATE_FILE, `${JSON.stringify(state, null, 2)}\n`);
  }

  const summaryPath = process.env.GITHUB_STEP_SUMMARY;
  if (summaryPath) {
    const rows = results
      .map((r) => `| \`${r.path}\` | ${r.ok ? "up" : "**DOWN**"} | ${r.detail} |`)
      .join("\n");
    await appendFile(
      summaryPath,
      `## Uptime check - ${now}\n\n| page | status | detail |\n| --- | --- | --- |\n${rows}\n`,
    );
  }

  for (const r of results) {
    console.log(`${r.ok ? "UP  " : "DOWN"} ${r.path} ${r.detail}`);
  }

  if (notifyFailed) process.exit(1);
}

await main();
