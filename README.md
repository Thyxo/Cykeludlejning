# Cykeludlejning

PWA til Samsø Cykeludlejning med lynkontrakter, lagerstyring, prisberegner, signaturfelt og kodelås-oversigt.

## Stack

- `apps/web`: Vite + React PWA til Vercel
- `apps/api`: Express + Prisma API til Railway
- Database: PostgreSQL på Railway

## Lokal kørsel

```bash
npm install
cp apps/api/.env.example apps/api/.env
npm run db:push -w apps/api
npm run db:seed -w apps/api
npm run dev:api
npm run dev:web
```

Standard login lokalt er `cykel` og den kode, du sætter i `APP_PASSWORD`.

## Railway miljøvariabler

- `DATABASE_URL`
- `JWT_SECRET`
- `APP_USERNAME`
- `APP_PASSWORD`
- `APP_ORIGIN` med Vercel-domænet

## Vercel miljøvariabler

- `VITE_API_URL` med Railway API URL
