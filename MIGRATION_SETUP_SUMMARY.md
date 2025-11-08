# Database Migration Setup - Implementation Summary

## ✅ What Was Implemented

This document summarizes the database migration setup that was added to ensure migrations run automatically during deployment.

---

## Changes Made

### 1. **package.json** - Added Deployment Scripts

Added three new npm scripts to handle production deployments with automatic migrations:

```json
"postbuild": "prisma generate",
"deploy": "prisma migrate deploy && npm start",
"deploy:worker": "prisma migrate deploy && npm run worker"
```

**What they do:**
- `postbuild`: Automatically generates Prisma Client after TypeScript compilation
- `deploy`: Runs database migrations, then starts the HTTP server
- `deploy:worker`: Runs database migrations, then starts the BullMQ worker

**Usage:**
```bash
npm run build
npm run deploy          # For web service
npm run deploy:worker   # For worker service
```

### 2. **Dockerfile** - Automatic Migration on Container Start

Updated the CMD instruction to run migrations before starting the application:

```dockerfile
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/http/server.js"]
```

**What it does:**
- When the Docker container starts, it automatically runs `prisma migrate deploy`
- If migrations succeed, it starts the application
- If migrations fail, the container won't start (fail-fast behavior)

### 3. **DEPLOYMENT.md** - Comprehensive Deployment Guide

Created a complete deployment guide covering:
- Database migration strategies (3 options)
- Platform-specific instructions for:
  - Render.com
  - Railway
  - Heroku
  - AWS ECS/Fargate
  - Google Cloud Run
- Environment variables checklist
- Post-deployment verification steps
- Troubleshooting guide
- Rollback procedures
- Best practices

### 4. **.render.yaml** - Render Blueprint

Created a Render.com blueprint file for one-click deployment:
- Defines web service (HTTP API)
- Defines worker service (BullMQ)
- Configures PostgreSQL database
- Configures Redis instance
- Sets up environment variables
- Configures health checks

### 5. **README.md** - Updated Documentation

Updated the main README to:
- Add new `deploy` and `deploy:worker` scripts to the NPM Scripts table
- Add a Deployment section linking to DEPLOYMENT.md
- Include quick deployment commands

---

## How It Works

### Option A: Using npm deploy script (Recommended for PaaS)

```bash
# Build the application
npm run build

# Deploy with automatic migrations
npm run deploy
```

**Flow:**
1. `npm run build` compiles TypeScript → JavaScript
2. `postbuild` hook runs `prisma generate` automatically
3. `npm run deploy` runs:
   - `prisma migrate deploy` (applies pending migrations)
   - `npm start` (starts the server)

### Option B: Using Docker (Recommended for containers)

```bash
docker build -t alis-eyewatch .
docker run -p 8080:8080 --env-file ./.env alis-eyewatch
```

**Flow:**
1. Docker builds the image (includes `npm run build`)
2. Container starts and runs the CMD:
   - `npx prisma migrate deploy` (applies pending migrations)
   - `node dist/http/server.js` (starts the server)

### Option C: Manual (for custom setups)

```bash
npm run build
npm run prisma:migrate
npm start
```

---

## Platform-Specific Setup

### Render.com

**Option 1: Using render.yaml (One-Click)**
1. Push `.render.yaml` to your repository
2. Connect repository to Render
3. Render automatically creates all services

**Option 2: Manual Setup**
1. Create Web Service
2. Set Build Command: `npm run build`
3. Set Start Command: `npm run deploy`
4. Add environment variables
5. Create Worker Service with start command: `npm run deploy:worker`

### Railway

1. Connect repository (auto-detects Dockerfile)
2. Add PostgreSQL and Redis plugins
3. Set environment variables
4. Deploy automatically runs migrations via Dockerfile

### Heroku

1. Create `Procfile`:
   ```
   web: npm run deploy
   worker: npm run deploy:worker
   ```
2. Deploy with `git push heroku main`
3. Scale worker: `heroku ps:scale worker=1`

---

## Verification Steps

After deployment, verify migrations ran successfully:

### 1. Check Application Logs

Look for this output:
```
✔ Prisma Migrate applied 1 migration(s)
```

### 2. Test Health Endpoint

```bash
curl https://your-app.com/health
curl https://your-app.com/health/deps
```

### 3. Check Database

Connect to your database and verify the migrations table:

```sql
SELECT * FROM "_prisma_migrations" ORDER BY finished_at DESC;
```

You should see:
- `migration_name`: `0001_init`
- `finished_at`: Recent timestamp
- `success`: `true`

---

## Migration Files

Your existing migrations are preserved in:
```
prisma/
  ├── migrations/
  │   ├── 0001_init/
  │   │   └── migration.sql
  │   └── migration_lock.toml
  └── schema.prisma
```

**Important:** 
- Never modify existing migration files
- Always create new migrations for schema changes
- Use `npm run prisma:migrate:dev` for development
- Use `npm run prisma:migrate` (or `deploy` script) for production

---

## Troubleshooting

### Problem: Migrations fail on startup

**Solution:**
1. Check `DATABASE_URL` is correct
2. Verify database user has CREATE/ALTER permissions
3. Check migration files are included in deployment
4. Review error logs for specific migration issues

### Problem: "Prisma Client not generated"

**Solution:**
1. Ensure `postbuild` script runs after build
2. Manually run `npm run prisma:generate`
3. Verify `prisma/schema.prisma` is included in build

### Problem: Worker can't connect to database

**Solution:**
1. Ensure worker uses same `DATABASE_URL` as web service
2. Verify migrations ran before worker started
3. Check network connectivity between services

---

## Best Practices

✅ **DO:**
- Always run migrations before starting the application
- Test migrations in staging before production
- Backup database before deploying schema changes
- Monitor logs during deployment
- Use the `deploy` scripts for production

❌ **DON'T:**
- Modify existing migration files
- Skip migrations in production
- Run migrations manually unless necessary
- Deploy without testing migrations first

---

## Next Steps

1. **Review DEPLOYMENT.md** for detailed platform instructions
2. **Set up staging environment** to test migrations
3. **Configure environment variables** for your platform
4. **Deploy using one of the methods above**
5. **Verify migrations** using the verification steps
6. **Monitor application** after deployment

---

## Summary

✅ Database migrations are now **fully automated** for deployment
✅ Multiple deployment options available (npm scripts, Docker, platform-specific)
✅ Comprehensive documentation provided (DEPLOYMENT.md)
✅ Platform-specific configurations included (render.yaml)
✅ Fail-fast behavior ensures database is ready before app starts

Your application is now ready for production deployment with automatic database migration support! 🚀

