# Bring-your-own examples

Each folder is a small app plus a `Dockerfile` that meets the container contract in
[docs/byo.md](../../docs/byo.md): read `PORT`, bind `0.0.0.0`, answer a health route.
Register one in a Flisk project with:

```bash
flisk resource orders-api --type bring-your-own --stack shop --dockerfile ./Dockerfile --yes
```

Check one (needs Docker; builds the image, runs it with `PORT=4000`, expects HTTP 200):

```bash
tests/e2e/resource-types/bring-your-own/verify-byo-example.sh fastify          # health path /health
scripts/sync-byo-templates.sh vue && tests/e2e/resource-types/bring-your-own/verify-byo-example.sh create-vue /   # synced template; Vite apps answer on /
```

`create-vue`, `create-next-app`, `create-adonisjs`, `create-analog` and `create-bati` live in their own repositories,
[flisk-template-vue](https://github.com/flisk-sh/flisk-template-vue), [flisk-template-next-app](https://github.com/flisk-sh/flisk-template-next-app),
[flisk-template-adonisjs](https://github.com/flisk-sh/flisk-template-adonisjs), [flisk-template-analog](https://github.com/flisk-sh/flisk-template-analog)
and [flisk-template-bati](https://github.com/flisk-sh/flisk-template-bati), each with its own `verify` and `flisk up` `e2e` checks. [`templates.json`](templates.json) pins each one to a release tag, and `scripts/sync-byo-templates.sh` copies it
here; the copies are git-ignored. Change a template in its repository, then bump its tag in `templates.json`.

An app that needs another resource (a database server, for example [turso-app](turso-app/README.md) with [turso](turso/README.md))
cannot run alone. Check the pair in one project, through a real `flisk up`:

```bash
tests/e2e/resource-types/bring-your-own/verify-byo-pair.sh turso 4500 /health turso-app LIBSQL_URL /health
```

An app that needs Flisk's own Postgres cannot run alone either. Check it through a real `flisk up` and Traefik instead, which gives it Flisk's
Postgres and `DATABASE_URL`:

```bash
tests/e2e/resource-types/bring-your-own/verify-byo-flisk.sh full-stack-fastapi-template /api/v1/utils/health-check/
```

Every folder has its own `README.md` with its stack, notes and the exact check command, so adding an
example only adds a folder and never edits a shared table.

These check the container only. Through `flisk up`, a bring-your-own service is routed at
`http://api.<project>.localhost/api/<name without -api>/...` with the prefix stripped, so a
frontend served under that path needs its `base` set. Resource names must be unique across
Flisk projects that share one Docker daemon: Traefik watches every container.
