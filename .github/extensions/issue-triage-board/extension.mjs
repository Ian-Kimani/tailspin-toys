import { createServer } from "node:http";
import { joinSession, createCanvas } from "@github/copilot-sdk/extension";

const servers = new Map();
const defaultRepository = { owner: "Ian-Kimani", repo: "tailspin-toys" };

const fallbackIssues = [
    {
        number: 7,
        title: "Allow users to filter games by category and publisher",
        body: "Add category and publisher filters to the game catalog.",
        labels: ["enhancement"],
        updated_at: "2026-09-27T12:12:14Z",
        html_url: "https://github.com/Ian-Kimani/tailspin-toys/issues/7",
    },
];

function escapeHtml(value) {
    return String(value ?? "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
}

async function loadIssues(repository) {
    try {
        const response = await fetch(
            `https://api.github.com/repos/${repository.owner}/${repository.repo}/issues?state=open&per_page=100`,
            { headers: { accept: "application/vnd.github+json", "user-agent": "copilot-issue-triage-board" } },
        );
        if (!response.ok) return fallbackIssues;
        const issues = await response.json();
        return issues.filter((issue) => !issue.pull_request);
    } catch {
        return fallbackIssues;
    }
}

function prioritizeIssues(issues) {
    const score = (issue) => {
        const labels = (issue.labels ?? []).map((label) => typeof label === "string" ? label : label.name);
        const urgent = labels.some((label) => /urgent|critical|blocked|bug/i.test(label)) ? 100 : 0;
        const stale = Date.now() - Date.parse(issue.updated_at);
        return urgent + Math.max(0, 30 - Math.floor(stale / 86400000));
    };
    return [...issues].sort((a, b) => score(b) - score(a) || a.number - b.number);
}

function issueCard(issue, top) {
    const labels = (issue.labels ?? []).map((label) => escapeHtml(typeof label === "string" ? label : label.name)).join(", ");
    const reason = top
        ? "Top priority because it is an open issue with the strongest urgency or recency signals."
        : "Open issue retained for follow-up after the highest-priority items.";
    return `<article class="card ${top ? "top" : ""}">
      <div class="card-head"><span class="number">#${escapeHtml(issue.number)}</span><span class="labels">${labels || "unlabeled"}</span></div>
      <h3><a href="${escapeHtml(issue.html_url)}" target="_blank" rel="noreferrer">${escapeHtml(issue.title)}</a></h3>
      <p>${escapeHtml(issue.body || "No description provided.")}</p>
      ${top ? `<p class="why"><strong>Why now:</strong> ${reason}</p>` : ""}
      <button data-issue="${escapeHtml(issue.number)}">Add to current context</button>
    </article>`;
}

function renderHtml(instanceId, repository, issues) {
    const prioritized = prioritizeIssues(issues);
    const top = prioritized.slice(0, 3);
    const remainder = prioritized.slice(3);
    return `<!doctype html>
<html>
  <head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" /><title>Issue triage board</title>
    <style>
      :root { color-scheme: light dark; }
      body { margin: 0; padding: 24px; background: var(--background-color-default, #fff); color: var(--text-color-default, #1f2328); font: 14px/1.5 var(--font-sans, system-ui, sans-serif); }
      h1 { margin: 0 0 4px; font-size: 24px; } h2 { margin-top: 28px; font-size: 18px; }
      .muted { color: var(--text-color-muted, #656d76); } .board { display: grid; gap: 12px; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); }
      .card { border: 1px solid var(--border-color-default, #d0d7de); border-radius: 10px; padding: 16px; background: var(--background-color-default, #fff); }
      .card.top { border-color: var(--true-color-blue, #0969da); box-shadow: 0 0 0 1px var(--true-color-blue, #0969da); }
      .card-head { display: flex; justify-content: space-between; gap: 8px; color: var(--text-color-muted, #656d76); font-size: 12px; }
      h3 { margin: 8px 0; font-size: 16px; } a { color: inherit; } p { margin: 8px 0; }
      .why { padding: 8px; border-left: 3px solid var(--true-color-blue, #0969da); background: var(--background-color-muted, #f6f8fa); }
      button { margin-top: 8px; border: 1px solid var(--border-color-default, #d0d7de); border-radius: 6px; padding: 7px 10px; background: var(--background-color-muted, #f6f8fa); color: inherit; cursor: pointer; }
      button:focus-visible { outline: 2px solid var(--color-focus-outline, #0969da); outline-offset: 2px; }
      #status { min-height: 20px; color: var(--text-color-muted, #656d76); }
    </style>
  </head>
  <body data-instance="${escapeHtml(instanceId)}">
    <h1>Issue triage board</h1>
    <p class="muted">${escapeHtml(repository.owner)}/${escapeHtml(repository.repo)} · ${prioritized.length} open issues</p>
    <p id="status" role="status" aria-live="polite"></p>
    <h2>Needs attention now</h2>
    <section class="board" aria-label="Top three issues">${top.map((issue) => issueCard(issue, true)).join("") || "<p>No open issues found.</p>"}</section>
    <h2>Everything else</h2>
    <section class="board" aria-label="Remaining issues">${remainder.map((issue) => issueCard(issue, false)).join("") || "<p>No remaining issues.</p>"}</section>
    <script>
      const status = document.querySelector("#status");
      document.querySelectorAll("button[data-issue]").forEach((button) => {
        button.addEventListener("click", async () => {
          button.disabled = true;
          try {
            const response = await fetch("/attach", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ number: button.dataset.issue }) });
            const result = await response.json();
            status.textContent = result.message || "Issue added to current context.";
          } catch {
            status.textContent = "Could not add the issue to the current context.";
            button.disabled = false;
          }
        });
      });
    </script>
  </body>
</html>`;
}

async function startServer(instanceId, repository, issues) {
    const server = createServer((req, res) => {
        if (req.method === "POST" && req.url === "/attach") {
            let body = "";
            req.on("data", (chunk) => { body += chunk; });
            req.on("end", async () => {
                try {
                    const number = JSON.parse(body).number;
                    const issue = issues.find((candidate) => String(candidate.number) === String(number));
                    if (!issue) throw new Error("Issue not found");
                    await session.send(`Add this GitHub issue to the current working context: ${issue.html_url}\n\nTitle: ${issue.title}\n\n${issue.body || "No description provided."}`);
                    res.writeHead(200, { "Content-Type": "application/json" });
                    res.end(JSON.stringify({ message: `Issue #${issue.number} added to the current context.` }));
                } catch (error) {
                    res.writeHead(400, { "Content-Type": "application/json" });
                    res.end(JSON.stringify({ message: error instanceof Error ? error.message : "Could not attach issue." }));
                }
            });
            return;
        }
        res.setHeader("Content-Type", "text/html; charset=utf-8");
        res.end(renderHtml(instanceId, repository, issues));
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    const port = typeof address === "object" && address ? address.port : 0;
    return { server, url: `http://127.0.0.1:${port}/` };
}

const session = await joinSession({
    canvases: [
        createCanvas({
            id: "issue-triage-board",
            displayName: "issue-triage-board",
            description: "A Kanban board that prioritizes open GitHub issues and attaches them to the current context.",
            inputSchema: {
                type: "object",
                properties: {
                    owner: { type: "string" },
                    repo: { type: "string" },
                },
            },
            actions: [
                {
                    name: "refresh",
                    description: "Refresh the issue list shown on the board.",
                    handler: async (ctx) => {
                        return { ok: true, message: "Reopen the board to refresh its issue list.", instanceId: ctx.instanceId };
                    },
                },
            ],
            open: async (ctx) => {
                let entry = servers.get(ctx.instanceId);
                if (!entry) {
                    const repository = {
                        owner: ctx.input?.owner || defaultRepository.owner,
                        repo: ctx.input?.repo || defaultRepository.repo,
                    };
                    const issues = prioritizeIssues(await loadIssues(repository));
                    entry = await startServer(ctx.instanceId, repository, issues);
                    servers.set(ctx.instanceId, entry);
                }
                return {
                    title: "Issue triage board",
                    url: entry.url,
                };
            },
            onClose: async (ctx) => {
                const entry = servers.get(ctx.instanceId);
                if (entry) {
                    servers.delete(ctx.instanceId);
                    await new Promise((resolve) => entry.server.close(() => resolve()));
                }
            },
        }),
    ],
});
