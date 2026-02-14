# Spotify Party Queue Interface

## Feature Overview

A minimal web app that lets party guests view what's currently playing, see the upcoming queue, search for songs, and add them to the queue — without giving them direct access to Spotify controls that could disrupt playback.

## Background

At house parties, sharing Spotify access often leads to accidental disruptions — people hitting play instead of queue, skipping songs, or changing the playlist entirely. This app acts as a controlled gateway: guests can only search and queue, nothing else.

## Requirements

### Functional
- **Now Playing**: Display currently playing track (title, artist, album art)
- **Queue Display**: Show upcoming queue (up to 20 songs — Spotify API limit)
- **Search**: Let guests search Spotify's catalog
- **Queue Songs**: Let guests add songs to the queue
- **Rate Limiting**: Max 10 songs per hour per user (tracked by browser/session)

### Non-Functional
- Mobile-friendly (primary use case: guests on phones)
- Low friction (no login required for guests)
- ~40 concurrent users
- Hosted on Render

## Architecture

### Auth Model: Host-Only

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│   Guest's   │     │   Our       │     │  Spotify    │
│   Phone     │────▶│   Server    │────▶│  API        │
│  (Browser)  │     │  (Node.js)  │     │             │
└─────────────┘     └─────────────┘     └─────────────┘
                          │
                          │ Host's access token
                          │ (authenticated once)
                          ▼
                    ┌─────────────┐
                    │   Host's    │
                    │   Spotify   │
                    │   Premium   │
                    └─────────────┘
```

- Host (party organizer) authenticates once with Spotify Premium account
- Server stores and refreshes the host's access token
- Guests interact through a web UI — no Spotify login required
- All Spotify API calls use the host's token server-side

### Why This Works
- Bypasses Spotify's 5-user dev mode limit (only 1 user authenticates)
- Zero friction for guests
- Server acts as gatekeeper — guests can only search and queue

## Assumptions

1. Host has Spotify Premium (required for queue API)
2. Host will authenticate before the party starts
3. Party size ~40 people (well within rate limits)
4. Guests have smartphones with modern browsers
5. Render free/starter tier sufficient for this scale
6. Queue showing next 20 songs is sufficient context

## Brainstorming & Investigation Findings

### Spotify API Capabilities

| Endpoint | Purpose | Scope Required | Premium? |
|----------|---------|----------------|----------|
| `GET /me/player` | Currently playing | `user-read-playback-state` | No |
| `GET /me/player/queue` | Get queue (max 20) | `user-read-playback-state` | No |
| `GET /v1/search` | Search tracks | None | No |
| `POST /me/player/queue` | Add to queue | `user-modify-playback-state` | **Yes** |

### Queue Behavior with Playlists

- When playing from a playlist, songs added via API play **before** the playlist continues
- Multiple rapid queue additions stack LIFO (last in, first out)
- For a casual party, this is acceptable — true fairness would require batching/shuffling submissions

### API Limitations Discovered

- `GET /me/player/queue` returns max 20 songs (no pagination)
- Rate limits: ~20 requests/second (sufficient for 40 users)
- Dev mode 5-user limit only applies to OAuth users (irrelevant with host-only auth)

## Options Explored

### Option A: Host-Only Auth (Selected)
- Host authenticates once, server holds token
- Guests need no Spotify account
- Bypasses dev mode limits

**Tradeoffs:**
- (+) Zero guest friction
- (+) Full control over what API calls happen
- (+) Can add rate limiting, duplicate prevention, etc.
- (-) If host token expires mid-party and refresh fails, app stops working

### Option B: Each Guest Authenticates
- Every guest logs into Spotify
- Limited to 5 users in dev mode

**Tradeoffs:**
- (+) Each user's actions tied to their account
- (-) Dealbreaker: 5 user limit in dev mode
- (-) Friction: guests need Spotify accounts
- (-) Complex: managing multiple tokens

### Option C: Client Credentials (No User Auth)
- Server uses app credentials only
- Can search but cannot access playback or queue

**Tradeoffs:**
- (-) Dealbreaker: Cannot queue songs or see playback state

## Selected Approach

**Option A: Host-Only Auth**

Tradeoffs accepted:
- Token refresh handled automatically by server
- If something goes wrong, host can re-authenticate (minor party interruption)

## Tech Stack

| Layer | Technology | Rationale |
|-------|------------|-----------|
| Frontend | React | Component-based, good for real-time UI updates |
| Backend | Node.js + Express | Simple, good Spotify SDK support |
| Hosting | Render | Available via MCP, easy deploy |
| Styling | Tailwind CSS | Fast to build mobile-friendly UI |

## Implementation Plan

### Backend (Node.js/Express)
Location: `/server`

**API Routes:**
- `GET /api/auth/login` — Redirect to Spotify OAuth
- `GET /api/auth/callback` — Handle OAuth callback, store tokens
- `GET /api/auth/status` — Check if authenticated
- `GET /api/now-playing` — Get currently playing track
- `GET /api/queue` — Get upcoming queue (max 20)
- `GET /api/search?q=` — Search Spotify catalog
- `POST /api/queue` — Add track to queue (with rate limiting)

**Rate Limiting:**
- 10 songs per hour per IP address
- Silent tracking, only shows error toast when exceeded

**Environment Variables:**
- SPOTIFY_CLIENT_ID
- SPOTIFY_CLIENT_SECRET
- SPOTIFY_REDIRECT_URI
- SESSION_SECRET
- NODE_ENV

### Frontend (React + Vite)
Location: `/client`

**Components:**
- NowPlaying — Album art with glow effects, track info, progress bar
- Queue — List of upcoming songs with glassmorphism cards
- SearchOverlay — Fullscreen search with results and add buttons
- Toast — Success/error notifications

**Polling:**
- Now playing: every 5 seconds
- Queue: every 10 seconds

### Infrastructure (Render)
Location: `/render.yaml`

**Services:**
- `electric-love-api` — Node.js web service (backend)
- `electric-love` — Static site (frontend)

### UI Design Decisions
- Single scrollable page (Now Playing → Queue)
- Search button in header (top right)
- No visible rate limit indicator (error only when exceeded)
- "Electric Love" logo in Nabla font (psychedelic/musical)
- Color palette: electric-pink, purple, blue, yellow on dark void background
- Animated blob background with floating particles

## Open Questions

None — implementation in progress.

## References

- [Spotify Add to Queue API](https://developer.spotify.com/documentation/web-api/reference/add-to-queue)
- [Spotify Get Queue API](https://developer.spotify.com/documentation/web-api/reference/get-queue)
- [Spotify Authorization Code with PKCE](https://developer.spotify.com/documentation/web-api/tutorials/code-pkce-flow)
- [Spotify Quota Modes](https://developer.spotify.com/documentation/web-api/concepts/quota-modes)
- [Spotify Scopes](https://developer.spotify.com/documentation/web-api/concepts/scopes)
