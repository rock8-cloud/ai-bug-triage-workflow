# Bugtriage — bug report triage

A Mastra demo built for a knowledge-sharing session on the theme *"when an agent
stops being an experiment and becomes a process"*. One believable use case
exercising agents, tools, workflows, branching, suspend/resume, streaming and
evals, with a **custom UI** alongside Mastra Studio.

[![The Bugtriage board: every report as a card, in columns from closed by the process to shipped. Click to deploy on Rock8Cloud.](bug-triage-ui.png)](https://app.rock8.cloud/login?redirect=%2Fnew-deployment%3Fblueprint%3Dbugtriage)

Someone files a bug report. The system always files it, then works through a
funnel where every stage costs more than the one before it and every stage's job
is to stop work reaching the next. If a rule says the fix is small and contained,
a coding agent on [Rock8Cloud](https://app.rock8.cloud/login?redirect=%2Fnew-deployment%3Fblueprint%3Dbugtriage) implements it and opens a
pull request with nobody watching. If any rule says otherwise, the workflow
**suspends** and asks a person.

```
report
  │
  ├─[1] createReport       persist it, always                     —
  ├─[2] findDuplicates     one embedding, against past reports    ~free
  │        └── duplicate ──▶ link and close
  ├─[3] analyse            docs retrieval + a read-only agent     minutes, real money
  ├─[4] classify           a rule, in the open                    free
  │        ├── not-a-bug ──▶ draft a reply citing the page
  │        ├── simple-fix ─▶ brief → coding agent → pull request
  │        └── needs-human ▶ SUSPEND, and wait
  └─[5] finalise           index it so the next report is checked against it
```

**The first thing this process does is try not to do anything.** That is the
whole argument. An agent loop handed the third report of the same bug would
cheerfully analyse it a third time.

## How it fits together

Three services of our own, and two external systems that are easy to confuse
because their names rhyme.

| | what it is | auth | used for |
| --- | --- | --- | --- |
| **rock8router** | an OpenAI-compatible model gateway | `r8_` token | what this app *thinks* with: the three agents and every embedding |
| **[Rock8Cloud](https://app.rock8.cloud/login?redirect=%2Fnew-deployment%3Fblueprint%3Dbugtriage)** | the PaaS holding the repository | `vhk_` API key | agents that *read and change code* and open pull requests |

They are separate keys, separate budgets and separate decisions. `CHAT_MODEL`
picks a model on rock8router; `ROCK8CLOUD_AGENT_MODEL_ID` picks one for the
coding agent. Getting them mixed up is the single most likely configuration
mistake here, which is why the Setup page labels them
*rock8router (models)* and *[Rock8Cloud](https://app.rock8.cloud/login?redirect=%2Fnew-deployment%3Fblueprint%3Dbugtriage) (agents)*.

Our own three, one image each:

| | port | what it does |
| --- | --- | --- |
| `@bugtriage/server` | 4111 | the brain: agents, tools, workflows, policy, storage |
| `@bugtriage/web` | 3000 | the custom UI: file a report, the board, the review queue |
| `@bugtriage/studio` | 3001 | Mastra Studio, configured entirely by `MASTRA_URL` |

Everything persists to one Postgres: reports, decisions, the three vector
indexes, Mastra Memory, workflow run state, and traces.

## The decision

`apps/server/src/mastra/classify.ts` is a pure function, and the constants it
reads live in `config.ts`:

| constant | default | what it guards |
| --- | --- | --- |
| `DUPLICATE_THRESHOLD` | 0.88 | above this, already filed |
| `STANDING_RECALL_FLOOR` | 0.45 | how close a report must sit to a remembered rule to be judged against it |
| `MAX_AUTOFIX_FILES` | 3 | how much blast radius may go unattended |
| `ANALYSIS_CONFIDENCE_FLOOR` | 0.6 | how sure the analysis must be to act on |
| `DOCS_INTENT_THRESHOLD` | 0.52 | how well the docs must say "intended" |

Four checks — `scope`, `behaviour`, `dependencies`, `analysis-confidence` — and
any one of them failing sends the report to a person, by name. Change a number,
run the same report, watch the branch flip. `bun run policy` prints every case
and the check that fired, with no model and no network:

```
  sidebar-overflow    expected=simple-fix   actual=simple-fix
  date-format         expected=needs-human  actual=needs-human   [behaviour]
  csv-export          expected=needs-human  actual=needs-human   [behaviour, dependencies]
  vague-slowness      expected=needs-human  actual=needs-human   [scope, analysis-confidence]
  wide-refactor       expected=needs-human  actual=needs-human   [scope, behaviour]
  preview-expiry      expected=not-a-bug    actual=not-a-bug
```

Note what the policy does **not** consult: how confident the analysing agent
sounded, how urgent the report was, or how much anyone wants it fixed. Only
facts a person could check by opening the repository.

**The thresholds are measured, not guessed.** Against the seeded index the eight
dataset reports score 0.301–0.474 on documentation coverage when they are real
defects, and 0.544–0.630 when the documentation genuinely settles them. That is
a band only 0.07 wide, which is worth saying out loud rather than hiding: 0.52
sits in the middle of it, and `bun run eval:freeze` fails loudly whenever a case
lands on the wrong side of it after a re-seed. The narrowness matters less than
it looks, because this is the *second* lock — the analysis has to independently
read the behaviour as intentional too.

## The human step: the agents propose, a person disposes

When the policy escalates, the run does one more cheap thing before it parks:
it writes the brief a coding agent would be given, and suspends holding it. So
the review page does not ask someone to imagine the work and describe it. It
shows the instruction, in full, and lets them edit it.

What they leave in the box is what runs, word for word. Nothing rewrites it
after they approve it, and there is no second draft. A Slack button sends the
same text the card displayed, because approving an instruction nobody read is
not a decision.

The draft costs one small model call per escalation, spent on reports that are
sometimes then declined. That is the right way round: the expensive mistake is
approving work unseen, not writing a brief nobody used.

## Memory: what the process has been taught

Declining a report on the review page offers a field, *remember this as a
rule*. Whatever is written there becomes a message in [Mastra Memory](https://mastra.ai/docs/memory/overview),
in the `standing-rules` thread of a resource shared by the whole team. The
policy agent carries that memory. When a new report reaches it, Mastra recalls
the closest rules into its context, the agent judges whether one covers the
report, and if so the report closes before anything reads the repository.

Recall nominates, the agent decides. "We do not change the primary colour of
buttons" sits close to "the save button is invisible" in embedding space and
means something entirely different, so a threshold alone would eventually close
a real defect. The agent is told the two mistakes are not equal and to lean
towards letting the report through.

The Memory page lists every rule with the report that produced it and a
*forget* button. Deleting is as prominent as anything else on purpose: a rule
that silently closes reports is only safe while someone can revoke it.

## Slack: the same decision from a thread

Optional, and off unless `SLACK_BOT_TOKEN`, `SLACK_SIGNING_SECRET` and
`SLACK_CHANNEL_ID` are all set. With them, the process narrates itself:

- Filing a report opens a thread in the channel with the report.
- Each gate posts one line as it finishes: duplicates, memory, analysis, policy.
- A report the policy would not act on alone posts a card with **Build it**,
  **Backlog it** and **Won't do** buttons. A reply in the thread works as well:
  "build it, only the header", "backlog, wait for the redesign", or "won't do,
  rule: we do not change button colours" saves the rule to memory.
- The outcome lands in the same thread: the pull request, or why it closed.

It is built on Mastra channels, which use the [Chat SDK](https://chat-sdk.dev/)
under the hood. The review agent (`agents/review-agent.ts`) owns the Slack
adapter; Mastra registers its webhook at
`/api/agents/review-agent/channels/slack/webhook`. Progress comes from the
workflow's `onStart`/`onFinish` callbacks and the run's own `watch()` stream
(`notify/observe-triage.ts`), so no step knows Slack exists. A Slack button and
the review page call the same `decideReport()`.

### Connecting it

The webhook must reach the **Mastra server on 4111**, not the web app on 3000.

**1. Expose the server.** Slack cannot call `localhost`.

```bash
bun x cloudflared tunnel --url http://localhost:4111
```

Copy the `https://….trycloudflare.com` host it prints. It changes every time
the tunnel restarts, and both URLs in the Slack app have to be updated when it
does.

**2. Create the app** at [api.slack.com/apps](https://api.slack.com/apps) with
**From a manifest**, replacing `YOUR-PUBLIC-URL` with that host:

```yaml
display_information:
  name: bugtriage
features:
  bot_user:
    display_name: bugtriage
    always_online: true
oauth_config:
  scopes:
    bot:
      - chat:write        # post the thread and the decision card
      - channels:history  # read replies in threads it opened
      - channels:read
      - users:read        # name whoever decided
settings:
  event_subscriptions:
    request_url: https://YOUR-PUBLIC-URL/api/agents/review-agent/channels/slack/webhook
    bot_events:
      - message.channels
  interactivity:
    is_enabled: true
    request_url: https://YOUR-PUBLIC-URL/api/agents/review-agent/channels/slack/webhook
  socket_mode_enabled: false
  org_deploy_enabled: false
  token_rotation_enabled: false
```

Direct messages and mentions are deliberately absent: the review agent answers
only in threads the process opened, so it needs no `im:*` scopes and no
`app_mention` event. For a private channel, swap the two `channels:` scopes for
`groups:history` and `groups:read`.

**3. Install to the workspace**, then copy two values into `.env`:
Basic Information → App Credentials → **Signing Secret**, and
OAuth & Permissions → **Bot User OAuth Token** (starts `xoxb-`).

**4. Add the channel.** Open it in Slack, click its name, and copy the id from
the bottom of the dialog (`C…`) into `SLACK_CHANNEL_ID`. Then invite the bot:

```
/invite @bugtriage
```

**5. Restart `bun run dev`.** The Setup page should read
*On. Threads open in channel C…*, and the next report you file opens a thread.

## Layout

Three services, three images, one Postgres. Each can be restarted, rolled back
or scaled without the other two noticing.

```
docker-compose.yml          postgres + pgvector, and pgweb for showing persisted state

apps/server/                @bugtriage/server — the brain, :4111
  src/config.ts               every policy constant, in one place
  src/mastra/classify.ts      THE decision, as a rule rather than a judgement
  src/mastra/index.ts         Mastra instance: agents, workflows, storage, vectors
  src/mastra/agents/          analyst (facts), reply (the reporter), spec (the brief)
  src/mastra/model.ts         the gateway: one key, model resolved per request
  src/mastra/tools/           duplicate search + documentation retrieval
  src/mastra/workflows/       bug-triage (two branches), index-docs, eval-classify
  src/mastra/store/           reports and the decision log
  src/rock8/client.ts         Rock8Cloud agent sessions over the REST API
  src/evals/                  the fixed report set, the scorers, the sweep
  src/scripts/                report · policy · eval · models · rock8 · seed

apps/web/                   @bugtriage/web — the custom UI, TanStack Start, :3000
  src/routes/index.tsx        file a report + live step timeline
  src/routes/review.tsx       the queue of reports a rule declined to act on
  src/routes/reports.tsx      the board: the funnel as columns
  src/routes/decisions.tsx    every escalation, and what a person decided
  src/routes/setup.tsx        measured connection state, and re-indexing the docs
  src/lib/run.ts              the stream reducer: every visible state comes from here

apps/studio/                @bugtriage/studio — Mastra Studio, :3001
  serve.ts                    static SPA + the server URL, injected at boot

packages/shared/            @bugtriage/shared — zod contracts shared by all three
```

## Setup

```bash
cp .env.example .env      # GATEWAY_API_KEY and ROCK8CLOUD_API_KEY
bun install
bun run db:up             # postgres + pgvector on :5489, pgweb on :8087
bun run docs:index              # ONCE, offline. Never ingest live on stage.
bun run dev               # UI :3000 · server :4111 · Studio :3001
```

Other commands:

```bash
bun run rock8cloud             # what the Rock8Cloud key can see, and past sessions
bun run models            # what the gateway can route to
bun run models --probe    # ...and one real call to each, with latency and cost
bun run policy            # every case through the policy. No model, no network.
bun run eval:freeze       # ONCE, after any re-seed. Freezes docs retrieval.
bun run eval              # the fixed report set against every model
bun run eval:studio       # the same run, persisted as experiments Studio can read
bun run eval:promote      # turn a real escalation into a regression test
bun run report "…" "…"    # file a report from the terminal (stage fallback)
bun run check             # typecheck every package
bun run db:reset          # drop the volume and start clean (re-seed after)
```

## Environment

Copy `.env.example` to `.env`. Only the two keys are secret; everything else has
a working default.

**rock8router — the model gateway**

| variable | required | default | what it does |
| --- | --- | --- | --- |
| `GATEWAY_API_KEY` | **yes** | — | `r8_` token. Chat and embeddings both use it. |
| `GATEWAY_BASE_URL` | no | `https://ai.rock8router.com/v1` | |
| `CHAT_MODEL` | no | `rock8router/gpt-4.1-mini` | What the agents reason with. `bun run eval` decides this. |
| `EMBEDDING_MODEL` | no | `rock8router/openai/text-embedding-3-small` | Must be permitted on the token, or retrieval and duplicate detection fail. |
| `EMBEDDING_DIMENSION` | no | `1536` | Must match the model, or the index is unreadable. |

**[Rock8Cloud](https://app.rock8.cloud/login?redirect=%2Fnew-deployment%3Fblueprint%3Dbugtriage) — the agent platform**

| variable | required | default | what it does |
| --- | --- | --- | --- |
| `ROCK8CLOUD_API_KEY` | **yes** | — | `vhk_` API key. Not an OAuth session — a server holds this. |
| `ROCK8CLOUD_API_URL` | no | `https://app.rock8.cloud` | |
| `ROCK8CLOUD_SERVICE_ID` | **yes** | — | The repo-backed service the agents work on. Without it the analyse step fails. |
| `ROCK8CLOUD_ORG_ID` | no | — | Informational; the API key is already org-scoped. |
| `ROCK8CLOUD_AGENT_MODEL_ID` | no | platform default | From `bun run rock8cloud`. Distinct from `CHAT_MODEL`. |

**Infrastructure**

| variable | required | default | what it does |
| --- | --- | --- | --- |
| `DATABASE_URL` | no | `postgres://bugtriage:bugtriage@localhost:5489/bugtriage` | `bun run db:up` serves exactly this. |
| `MASTRA_URL` | no | `http://localhost:4111` | How the UI and Studio reach the server. |
| `CORS_ORIGINS` | no | `http://localhost:3001` | Studio's origin. Cannot be `*` — its auth bootstrap sends credentials. |
| `DOCS_LLMS_URL` | no | `https://docs.rock8.cloud/llms-full.txt` | What `bun run docs:index` ingests. |

**Slack (optional)**

| variable | required | default | what it does |
| --- | --- | --- | --- |
| `SLACK_BOT_TOKEN` | no | — | `xoxb-` bot token. Read by the Chat SDK adapter. |
| `SLACK_SIGNING_SECRET` | no | — | Verifies that webhook calls come from Slack. |
| `SLACK_CHANNEL_ID` | no | — | Where report threads are opened. All three set turns Slack on. |

**Policy — the numbers the process decides on its own from**

| variable | default | what it guards |
| --- | --- | --- |
| `DUPLICATE_THRESHOLD` | `0.88` | Above this similarity, already filed. |
| `STANDING_RECALL_FLOOR` | `0.45` | Memory's recall threshold for standing rules. Measured: covered reports score 0.57 and up, near-miss defects 0.42 and below. |
| `MAX_AUTOFIX_FILES` | `3` | Files a fix may touch unattended. |
| `ANALYSIS_CONFIDENCE_FLOOR` | `0.6` | How sure the analysis must be to act on. |
| `DOCS_INTENT_THRESHOLD` | `0.52` | How well the docs must say "intended". Measured — see above. |
| `AGENT_POLL_INTERVAL_MS` | `15000` | How often a running agent is checked. |
| `AGENT_TIMEOUT_MS` | `900000` | How long triage waits before handing the report back. The agent run continues regardless. |

The Setup page shows all of these as *measured* state — whether each key actually
works, not what it is set to.

## Rock8Cloud

The agents that read the repository and write the fix live on [Rock8Cloud](https://app.rock8.cloud/login?redirect=%2Fnew-deployment%3Fblueprint%3Dbugtriage), not in
this process. This app decides *whether* to task them and *what* to ask for.

| agent type | used for | can write? |
| --- | --- | --- |
| `analyze` | reading the repo to establish the facts | no |
| `code-autonomous` | the automatic branch: implements, opens a PR | yes |
| `code-collab` | the escalated branch: interviews, then implements | yes |

Reached over the REST API with a scoped `vhk_` key rather than MCP — MCP clients
authenticate over OAuth, which a server process has no business holding.

**Attaching instead of starting.** Every agent-backed step takes an optional
session id. Supply one and it attaches to a session that already exists; omit it
and it starts a new one. That is what makes a rehearsed demo honest: the analysis
and the pull request are real, produced by a real agent run, just produced
earlier — and the code path on stage is the same one that made them.

```bash
bun run rock8cloud                                   # find a session id
bun run report --analyze-session <id> "…" "…"
```

## Storage

Everything lives in **one Postgres** (`pgvector/pgvector:pg17` on port 5489):

| what | where |
| --- | --- |
| workflow run state, incl. suspended runs | `mastra_workflow_snapshot` and friends |
| the documentation index | `rock8_docs`, built by `bun run docs:index` |
| the report index, for duplicate detection | `bug_reports`, grown as reports are triaged |
| reports | `reports` |
| escalations and what a person decided | `decisions` |
| traces, metrics, logs, feedback | `mastra_span_events` and friends, daily-partitioned |

**pgweb on http://localhost:8087** is there for the middle of the talk: when the
workflow suspends, open the run snapshot row and show that the paused state is
genuinely on disk, not held in a process.

**Why `PostgresStoreVNext`.** `PostgresStore`'s observability domain implements
neither feedback listing nor metrics; Studio says so on its Metrics page.
`mastra/storage.ts` swaps in `PostgresStoreVNext`, which extends it and replaces
only that one domain. It takes a **separate, required** observability connection
and warns on every boot when it points at the same instance as the application
database — this demo points it there deliberately, and the warning is the
framework naming the first thing you would change on the way to production.

## Evals — when the model becomes a decision

One gateway, one key, one env var. `CHAT_MODEL` is a string, and every model on
the token speaks the same protocol, so switching is trivial. That is exactly the
problem: when switching is trivial, it gets done on a hunch.

```bash
bun run models            # rock8router/gpt-4.1-mini, mistral-large, gemini-2.5-pro, …
bun run eval              # 8 reports × every model, one table
```

**What is measured is narrower than it looks.** `classify()` is pure — given the
same facts it always returns the same branch, and `bun run policy` checks that
for free. What a model changes is the *facts the rule is handed*, which is the
only place a model choice can send a report down the wrong branch. So the eval
holds the analysis text fixed and varies the model.

**Gates are not scores.** Averaging them is how you ship a classifier that
automates things nobody approved.

- **Gates** — `never-over-automates`, `never-wrongly-dismisses`. Must be **1.00**.
  Sending a small fix to a human is friction. Sending something that needed a
  human straight to a coding agent means unrequested changes land in a pull
  request with a plausible description and nobody remembers asking. A model that
  escalates everything scores 1.0 here and badly elsewhere — which is the correct
  shape: cautious is survivable, presumptuous is not.
- **Scores** — `agrees-with-label`, `extracts-facts`, `cites-real-files`.
- **Measures** — latency and cost per report. Tie-breakers only.

One decision rule, applied in this order and printed by the report: *disqualify
on any gate failure; among survivors clearing the quality bar, take the
cheapest.*

**The dataset grows from production.** Eight reports someone thought of in
advance is still a guess. The `decisions` table is the opposite: every row is a
report the policy would not act on alone and the judgement a person made.

```bash
bun run eval:promote        # escalations not already covered
bun run eval:promote 7      # promote one into the committed dataset
```

That is where the eval stops being a thing you run and becomes a thing that gets
*harder to break* — every judgement it has survived joins the set it has to keep
surviving. Deliberately explicit rather than automatic: a dataset that grows
while nobody is looking is one nobody trusts, and this way it lands in a pull
request.

**The same eval, inside Studio.** `bun run eval` prints a table and the table
scrolls away. `bun run eval:studio` writes the same run into Mastra's dataset
and experiment storage — what Studio's Datasets and Experiments tabs read — so
results persist, sit next to the traces that produced them, and can be compared
with last week's.

```bash
bun run eval           # the terminal sweep, with the decision rule
bun run eval:studio    # the same run, persisted as a Mastra experiment per model
```

Both call the same `extractAndClassify` over the same committed dataset with the
same scorers: two front ends onto one eval, not two evals. Items are synced by
`externalId`, so the file in this repository stays the source of truth and
Studio is a view of it rather than a second place to edit it.

That difference is the point of the exercise. A number you have to re-derive to
look at twice is a measurement; a number with a history is a baseline, and only
one of those can tell you something got worse.

**Cost, measured rather than looked up.** The AI SDK normalises usage down to
token counts, so `mastra/gateway-usage.ts` reads the router's own `cost` field
off the raw response. Comparing two models on quality is an opinion; comparing
quality against cost per report is something a person can sign off.

**How the switch happens.** `mastra/model.ts` resolves the routing id from the
request context, falling back to `CHAT_MODEL`. The agents are constructed once
and the model is a property of the *run*: the eval sweeps it, Studio's
request-context panel sets it by hand against the [deployed](https://app.rock8.cloud/login?redirect=%2Fnew-deployment%3Fblueprint%3Dbugtriage) workflow, and
production falls through to the environment.

## Indexing the documentation

Ingestion is **itself a workflow** (`index-docs`), so it is triggerable from
Studio and from the Setup page alongside `bug-triage`, and shows the same
step-by-step shape:

```
fetch-docs → chunk-docs → embed-chunks → upsert-vectors
```

Not "seeding": that word implies one-off starting data, and this is repeatable
ingestion. Point it at another product's docs, run it again, and the
"is this documented behaviour?" branch answers for that product.

The Setup page has the same thing behind a text field, which is the only honest
form of an editable docs URL — changing a config value that nobody re-indexes
would leave the field saying one thing and retrieval doing another.

```bash
bun run docs:index              # fetch → chunk → embed → upsert
bun run docs:index --dry        # parse and chunk only: no API calls, no writes
bun run docs:index <url>        # ingest a different llms-full.txt
```

`DOCS_LLMS_URL` points at whichever product this is triaging for.

## Deliberately cut

Suspending on [Rock8Cloud](https://app.rock8.cloud/login?redirect=%2Fnew-deployment%3Fblueprint%3Dbugtriage)'s event stream instead of polling for a finished agent
run — the better shape, and the obvious next step, but it needs a public endpoint
for the callback to reach. Driving the human-in-the-loop decision from Slack via
`@mastra/slack`, which the `/reports/:id/decide` seam is already shaped for.
Feeding merged pull requests back into the report index so a fixed bug recognises
its own regression.
