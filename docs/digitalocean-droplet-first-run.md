# DigitalOcean Droplet First Run

This is the exact first-run sequence for deploying the full aurAlpha platform stack on a fresh Ubuntu Droplet with Docker Compose.

Use it with:
- [docker-platform-stack.md](/Users/apple/Documents/Project/Backend/aurAlpha/docs/docker-platform-stack.md)
- [platform-production-env-matrix.md](/Users/apple/Documents/Project/Backend/aurAlpha/docs/platform-production-env-matrix.md)
- [production-env-checklist.md](/Users/apple/Documents/Project/Backend/aurAlpha/docs/production-env-checklist.md)

## Assumptions

- You already created managed MySQL, PostgreSQL, and Redis on DigitalOcean.
- DNS for `APP_DOMAIN`, `API_DOMAIN`, and `DISCOVERY_DOMAIN` already points at the Droplet.
- You have git access to all four repos.
- You are deploying on Ubuntu 24.04 or a similar recent Ubuntu release.

## Required repo layout

The Docker Compose file uses relative build contexts, so keep this exact layout on the server:

```text
/opt/auralpha
├── Backend
│   ├── aurAlpha
│   ├── aurAlphaSchedulerWorker
│   └── discovery-engine
└── Frontend
    └── aurAlphaApp
```

## 1. Install Docker and git

```bash
sudo apt-get update
sudo apt-get install -y ca-certificates curl git gnupg

sudo install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
sudo chmod a+r /etc/apt/keyrings/docker.gpg

echo \
  "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu \
  $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | \
  sudo tee /etc/apt/sources.list.d/docker.list > /dev/null

sudo apt-get update
sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

sudo usermod -aG docker "$USER"
newgrp docker
docker --version
docker compose version
```

## 2. Create the platform workspace and clone repos

```bash
sudo mkdir -p /opt/auralpha/Backend /opt/auralpha/Frontend
sudo chown -R "$USER:$USER" /opt/auralpha

git clone <backend-repo-url> /opt/auralpha/Backend/aurAlpha
git clone <worker-repo-url> /opt/auralpha/Backend/aurAlphaSchedulerWorker
git clone <discovery-repo-url> /opt/auralpha/Backend/discovery-engine
git clone <frontend-repo-url> /opt/auralpha/Frontend/aurAlphaApp

cd /opt/auralpha/Backend/aurAlpha
```

## 3. Create the production env files

Environment directory naming is intentionally split across repos:
- backend: `environments/production`
- scheduler worker: `environments/production`
- discovery engine: `environments/production`
- frontend: `environment/production`

For the Docker platform stack, you usually create only the backend, worker, discovery, and platform env files manually. The frontend production file is generated during the Docker build from `deploy/.env.platform`.

For an IP-only Droplet with self-hosted databases, use the one-command launcher instead of manual copying/editing:

```bash
cd /opt/auralpha/Backend/aurAlpha
bash scripts/deploy/platform-launch-ip-selfhosted.sh 168.144.66.167
```

If you already have a real LLM key:

```bash
cd /opt/auralpha/Backend/aurAlpha
LLM_API_KEY=your_real_llm_key bash scripts/deploy/platform-launch-ip-selfhosted.sh 168.144.66.167
```

The launcher creates the four env files with the correct folder names, HTTP IP-only URLs, self-hosted database hosts, and generated strong secrets. It then validates the config, starts the database containers, builds images, runs backend migrations, launches the platform, and runs smoke checks.

If you are using domain-based routing or managed databases, create the files manually:

```bash
cp environments/production/.env.example environments/production/.env
cp ../aurAlphaSchedulerWorker/environments/production/.env.example ../aurAlphaSchedulerWorker/environments/production/.env
cp ../discovery-engine/environments/production/.env.example ../discovery-engine/environments/production/.env
cp deploy/.env.platform.example deploy/.env.platform
```

If you want to create the frontend production file manually too, the correct path is:

```bash
cp ../../Frontend/aurAlphaApp/environment/production/.env.example ../../Frontend/aurAlphaApp/environment/production/.env
```

Fill the real values using:
- [platform-production-env-matrix.md](/Users/apple/Documents/Project/Backend/aurAlpha/docs/platform-production-env-matrix.md)

Once the env files are filled, the fastest full launch path is:

```bash
npm run deploy:platform:launch
```

To include the email worker:

```bash
npm run deploy:platform:launch -- --with-email
```

Before continuing, make sure no dev hosts remain:

```bash
grep -R -nE 'localhost|127\.0\.0\.1' \
  environments/production/.env \
  ../aurAlphaSchedulerWorker/environments/production/.env \
  ../discovery-engine/environments/production/.env \
  deploy/.env.platform
```

That command should return nothing before a real production launch.

## 4. Render and validate the compose config

Before the stack is rendered, run the env audit:

```bash
npm run deploy:platform:env-audit
```

The helper script below wraps the same validation and is the fastest operator check:

```bash
npm run deploy:platform:validate
```

The underlying manual command is:

```bash
docker compose \
  --env-file ./deploy/.env.platform \
  -f docker-compose.platform.yml \
  config > /tmp/auralpha-platform.compose.rendered.yml
```

Check the rendered file for the expected domains and managed database hosts:

```bash
sed -n '1,240p' /tmp/auralpha-platform.compose.rendered.yml
```

## 5. Build the images

```bash
docker compose \
  --env-file ./deploy/.env.platform \
  -f docker-compose.platform.yml \
  build
```

If you plan to enable the email worker too:

```bash
docker compose \
  --env-file ./deploy/.env.platform \
  -f docker-compose.platform.yml \
  --profile email \
  build
```

## 6. Run backend migrations

Run backend migrations before the first public launch:

```bash
docker compose \
  --env-file ./deploy/.env.platform \
  -f docker-compose.platform.yml \
  run --rm --no-deps auralpha-api npm run db:migrate
```

Discovery migrations are handled automatically by the discovery container entrypoint on startup.

## 7. Start the platform stack

The helper script below performs the first build, backend migration, and bring-up:

```bash
npm run deploy:platform:first-run
```

To include the email worker:

```bash
npm run deploy:platform:first-run -- --with-email
```

The underlying manual command sequence is:

Start the default stack:

```bash
docker compose \
  --env-file ./deploy/.env.platform \
  -f docker-compose.platform.yml \
  up -d
```

If you need the email worker:

```bash
docker compose \
  --env-file ./deploy/.env.platform \
  -f docker-compose.platform.yml \
  --profile email \
  up -d
```

## 8. Verify container health

```bash
docker compose \
  --env-file ./deploy/.env.platform \
  -f docker-compose.platform.yml \
  ps
```

If any service is unhealthy, check logs:

```bash
docker compose \
  --env-file ./deploy/.env.platform \
  -f docker-compose.platform.yml \
  logs --tail=200 auralpha-api auralpha-scheduler-worker discovery-engine caddy
```

## 9. Verify public endpoints

Replace the example domains with your real ones:

The helper smoke script is:

```bash
npm run deploy:platform:smoke
```

The underlying manual curl checks are:

```bash
curl -fsSL https://api.example.com/api/v1/health
curl -fsSL https://api.example.com/api/v1/health/worker
curl -fsSL https://discovery.example.com/health/ready
curl -fsSL https://app.example.com/health
```

Notes:
- `caddy` will provision TLS automatically once the domains resolve correctly to the Droplet.
- `/api/v1/health/worker` verifies the backend-to-worker path, not just the API container itself.

## 10. Post-bootstrap data initialization

After the stack is healthy, initialize runtime-generated data in this order:

1. `exchange-assets-sync`
2. `broker-assets-sync`
3. `asset-price-sync`
4. `funds-sync`
5. `positions-sync`
6. `orders-sync`
7. `risk-recompute-sync`

Then rebuild the backend read models:

The helper script is:

```bash
npm run deploy:platform:post-bootstrap
```

The underlying manual commands are:

```bash
docker compose \
  --env-file ./deploy/.env.platform \
  -f docker-compose.platform.yml \
  exec auralpha-api npm run rebuild:positions-read-model

docker compose \
  --env-file ./deploy/.env.platform \
  -f docker-compose.platform.yml \
  exec auralpha-api npm run rebuild:risk-normalized-storage
```

## 11. Routine update sequence

The helper script is:

```bash
npm run deploy:platform:update
```

To pull all four repos first and include the email worker:

```bash
npm run deploy:platform:update -- --with-pull --with-email
```

The underlying manual sequence is:

For later updates on the same Droplet:

```bash
cd /opt/auralpha/Backend/aurAlpha && git pull
cd /opt/auralpha/Backend/aurAlphaSchedulerWorker && git pull
cd /opt/auralpha/Backend/discovery-engine && git pull
cd /opt/auralpha/Frontend/aurAlphaApp && git pull
cd /opt/auralpha/Backend/aurAlpha

docker compose \
  --env-file ./deploy/.env.platform \
  -f docker-compose.platform.yml \
  build

docker compose \
  --env-file ./deploy/.env.platform \
  -f docker-compose.platform.yml \
  run --rm --no-deps auralpha-api npm run db:migrate

docker compose \
  --env-file ./deploy/.env.platform \
  -f docker-compose.platform.yml \
  up -d
```

## 12. Important DigitalOcean note

DigitalOcean blocks outbound SMTP ports on Droplets. Only enable the `auralpha-email-worker` profile if your production email provider works over an allowed API or an approved relay path.

Reference:
- [Why is SMTP blocked?](https://docs.digitalocean.com/support/why-is-smtp-blocked/)

## Copy-paste launch block

After the four real production env files are filled, this is the exact copy-paste sequence to run from the backend repo on the Droplet:

```bash
cd /opt/auralpha/Backend/aurAlpha
npm run deploy:platform:launch
```

If your production deployment includes the email worker:

```bash
cd /opt/auralpha/Backend/aurAlpha
npm run deploy:platform:launch -- --with-email
```

## Day-2 operations

Common operator commands from the backend repo on the Droplet:

```bash
cd /opt/auralpha/Backend/aurAlpha
npm run deploy:platform:status
npm run deploy:platform:logs
npm run deploy:platform:restart
npm run deploy:platform:stop
```

Examples:

```bash
npm run deploy:platform:logs -- --follow --tail 500 auralpha-api
npm run deploy:platform:restart -- auralpha-api discovery-engine
npm run deploy:platform:stop -- --with-email
```
