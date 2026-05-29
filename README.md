# ThumbGen — YouTube Thumbnail Generator Setup

> ⚠️ **After every fresh `git clone` or `git pull` on a new machine:**
> `.env.local` and `.thumbgen-settings.json` are **gitignored** — they are never in GitHub.
> You must re-fill `.env.local` with your API keys (see Step 4 below) before the app will work.

## Quick Start

### 1. Google Cloud Console Setup

1. Go to [console.cloud.google.com](https://console.cloud.google.com)
2. Create a new project (or use existing) — enable **YouTube Data API v3**
3. Go to **Credentials → Create Credentials → OAuth 2.0 Client ID**
   - Application type: **Web application** ← must be Web, not Desktop
   - Authorized redirect URIs — add BOTH:
     - `http://127.0.0.1:3001/api/auth/callback`
     - `http://localhost:3001/api/auth/callback`
4. Go to **OAuth consent screen → Test users** → add your Gmail address
5. Copy **Client ID** (ends in `.apps.googleusercontent.com`) and **Client Secret** (starts with `GOCSPX-`)

### 2. Gemini API Key

1. Go to [aistudio.google.com](https://aistudio.google.com)
2. Click **Get API Key** → copy it (starts with `AIzaSy`)

### 3. fal.ai API Key (Background Removal)

1. Sign up at [fal.ai](https://fal.ai/dashboard/keys)
2. Copy your API key

### 4. Fill in `.env.local` ← DO THIS AFTER EVERY FRESH CLONE

```env
YOUTUBE_CLIENT_ID=your-client-id.apps.googleusercontent.com
YOUTUBE_CLIENT_SECRET=GOCSPX-...
YOUTUBE_REDIRECT_URI=http://127.0.0.1:3001/api/auth/callback

GEMINI_API_KEY=AIzaSy...

FAL_API_KEY=your-fal-ai-key
```

### 5. Run (Electron desktop app)

```bash
npm run electron
```

---

## How It Works

1. **Connect** your YouTube channel via OAuth2
2. **Dashboard** shows all your videos — missing thumbnails highlighted in amber
3. **Click "Generate Thumbnail"** on any video
4. **Upload a still** of the preacher (screenshot from the video)
5. **Gemini analyzes** which direction the face is looking
6. **Layout is auto-set**: face left → preacher on right, text on left (and vice versa)
7. **Optionally remove background** via remove.bg
8. **Pick a gradient** from 7 presets (Ocean, Royal Blue, Slate, etc.)
9. **Generate** — sharp composites the final 1280×720 JPEG
10. **Preview → Upload** directly to YouTube

---

## Gradient Presets

| Name | Colors | Best For |
|------|--------|---------|
| Slate | Dark slate → steel blue | General (Grace Community style) |
| Ocean | Teal → cyan | Upbeat messages |
| Royal | Navy → royal blue | Traditional/formal |
| Midnight | Dark navy → indigo | Evening services |
| Forest | Deep green → lime | Hope/growth topics |
| Sunset | Dark orange → amber | Evangelism |
| Crimson | Dark red → rose | Urgency/warning topics |

---

## Production Deployment

1. Update `YOUTUBE_REDIRECT_URI` to your production URL
2. Add production URL to Google OAuth authorized redirect URIs
3. Deploy to Vercel: `vercel deploy`
