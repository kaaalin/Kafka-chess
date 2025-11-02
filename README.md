# Chrysalis Chess (React + Vite + Tailwind)

## Run locally
```bash
npm i
npm run dev
```

## Build
```bash
npm run build && npm run preview
```

## Deploy to Vercel
1. Push to GitHub.
2. Import the repo in Vercel → Framework **Vite** → Build `npm run build` → Output `dist`.
3. Add your custom domain in Vercel → Settings → Domains, and point DNS:
   - Apex A record → `76.76.21.21`
   - `www` CNAME → `cname.vercel-dns.com`
```
