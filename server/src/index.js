import express from 'express';
import cors from 'cors';
import session from 'express-session';
import dotenv from 'dotenv';
import crypto from 'crypto';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

// Validate required environment variables
const requiredEnvVars = ['SPOTIFY_CLIENT_ID', 'SPOTIFY_CLIENT_SECRET', 'SPOTIFY_REDIRECT_URI', 'SESSION_SECRET'];
for (const envVar of requiredEnvVars) {
  if (!process.env[envVar]) {
    console.error(`Missing required environment variable: ${envVar}`);
    process.exit(1);
  }
}

// Token storage (in-memory for single host)
let hostTokens = {
  accessToken: null,
  refreshToken: null,
  expiresAt: null,
};

// Rate limiting storage: Map<IP, { count: number, windowStart: number }>
const rateLimitStore = new Map();
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000; // 1 hour
const RATE_LIMIT_MAX_REQUESTS = 10;

// OAuth state storage (avoids session issues on Render free tier)
// Map<state, { codeVerifier: string, createdAt: number }>
const oauthStateStore = new Map();

// =============================================================================
// VIBE FILTERING SYSTEM
// =============================================================================

// Vibe presets with audio feature thresholds
const VIBE_PRESETS = {
  off: {
    name: 'Off',
    description: 'No vibe filtering - all songs allowed',
    enabled: false,
  },
  match: {
    name: 'Match Now Playing',
    description: 'Match the vibe of whatever is currently playing',
    enabled: true,
    dynamic: true, // Special flag indicating this uses now-playing as reference
    tolerance: {
      energy: 0.25,
      valence: 0.25,
      danceability: 0.25,
      tempo: 20, // BPM tolerance
    },
  },
  chill: {
    name: 'Chill Vibes',
    description: 'Relaxed, mellow tracks for a laid-back atmosphere',
    enabled: true,
    energy: { min: 0.1, max: 0.6 },
    valence: { min: 0.2, max: 0.8 },
    tempo: { min: 60, max: 120 },
    danceability: { min: 0.3, max: 0.8 },
  },
  party: {
    name: 'Party Mode',
    description: 'High energy, danceable tracks to keep the party going',
    enabled: true,
    energy: { min: 0.6, max: 1.0 },
    valence: { min: 0.4, max: 1.0 },
    tempo: { min: 100, max: 150 },
    danceability: { min: 0.6, max: 1.0 },
  },
  romantic: {
    name: 'Romantic',
    description: 'Smooth, emotional tracks perfect for Valentine\'s Day',
    enabled: true,
    energy: { min: 0.1, max: 0.6 },
    valence: { min: 0.2, max: 0.7 },
    tempo: { min: 60, max: 120 },
    danceability: { min: 0.2, max: 0.7 },
  },
  hype: {
    name: 'Hype',
    description: 'Maximum energy bangers only',
    enabled: true,
    energy: { min: 0.75, max: 1.0 },
    valence: { min: 0.5, max: 1.0 },
    tempo: { min: 110, max: 180 },
    danceability: { min: 0.65, max: 1.0 },
  },
  custom: {
    name: 'Custom',
    description: 'Your own vibe settings',
    enabled: true,
    energy: { min: 0.0, max: 1.0 },
    valence: { min: 0.0, max: 1.0 },
    tempo: { min: 0, max: 300 },
    danceability: { min: 0.0, max: 1.0 },
  },
};

// Current vibe settings (in-memory, will reset on restart)
let currentVibe = {
  preset: 'off',
  settings: { ...VIBE_PRESETS.off },
};

// Fetch audio features for a track
async function getAudioFeatures(trackId) {
  try {
    const response = await spotifyFetch(`/audio-features/${trackId}`);
    if (!response.ok) {
      console.error('Failed to fetch audio features:', response.status);
      return null;
    }
    return await response.json();
  } catch (err) {
    console.error('Error fetching audio features:', err);
    return null;
  }
}

// Get currently playing track ID
async function getCurrentlyPlayingTrackId() {
  try {
    const response = await spotifyFetch('/me/player/currently-playing');
    if (response.status === 204 || !response.ok) {
      return null;
    }
    const data = await response.json();
    return data?.item?.id || null;
  } catch (err) {
    console.error('Error getting currently playing track:', err);
    return null;
  }
}

// Check if a track matches the current vibe (with dynamic support)
async function checkVibeMatch(audioFeatures) {
  if (!currentVibe.settings.enabled) {
    return { matches: true, reason: null };
  }

  let thresholds;
  let referenceFeatures = null;

  // Handle dynamic "match" mode
  if (currentVibe.settings.dynamic) {
    const nowPlayingId = await getCurrentlyPlayingTrackId();
    if (!nowPlayingId) {
      // Nothing playing, allow the song
      return { matches: true, reason: null, note: 'Nothing currently playing' };
    }

    referenceFeatures = await getAudioFeatures(nowPlayingId);
    if (!referenceFeatures) {
      // Can't get reference features, allow the song
      return { matches: true, reason: null, note: 'Could not get reference track features' };
    }

    // Build thresholds dynamically from now-playing track
    const tol = currentVibe.settings.tolerance;
    thresholds = {
      energy: {
        min: Math.max(0, referenceFeatures.energy - tol.energy),
        max: Math.min(1, referenceFeatures.energy + tol.energy),
      },
      valence: {
        min: Math.max(0, referenceFeatures.valence - tol.valence),
        max: Math.min(1, referenceFeatures.valence + tol.valence),
      },
      danceability: {
        min: Math.max(0, referenceFeatures.danceability - tol.danceability),
        max: Math.min(1, referenceFeatures.danceability + tol.danceability),
      },
      tempo: {
        min: Math.max(0, referenceFeatures.tempo - tol.tempo),
        max: referenceFeatures.tempo + tol.tempo,
      },
    };
  } else {
    // Use preset thresholds
    thresholds = {
      energy: currentVibe.settings.energy,
      valence: currentVibe.settings.valence,
      tempo: currentVibe.settings.tempo,
      danceability: currentVibe.settings.danceability,
    };
  }

  const mismatches = [];

  if (thresholds.energy && (audioFeatures.energy < thresholds.energy.min || audioFeatures.energy > thresholds.energy.max)) {
    const level = audioFeatures.energy < thresholds.energy.min ? 'too mellow' : 'too intense';
    mismatches.push(`Energy is ${level}`);
  }

  if (thresholds.valence && (audioFeatures.valence < thresholds.valence.min || audioFeatures.valence > thresholds.valence.max)) {
    const level = audioFeatures.valence < thresholds.valence.min ? 'too sad' : 'too upbeat';
    mismatches.push(`Mood is ${level}`);
  }

  if (thresholds.tempo && (audioFeatures.tempo < thresholds.tempo.min || audioFeatures.tempo > thresholds.tempo.max)) {
    const level = audioFeatures.tempo < thresholds.tempo.min ? 'too slow' : 'too fast';
    mismatches.push(`Tempo is ${level}`);
  }

  if (thresholds.danceability && (audioFeatures.danceability < thresholds.danceability.min || audioFeatures.danceability > thresholds.danceability.max)) {
    const level = audioFeatures.danceability < thresholds.danceability.min ? 'not danceable enough' : 'too dancey';
    mismatches.push(`Track is ${level}`);
  }

  if (mismatches.length > 0) {
    return {
      matches: false,
      reason: mismatches[0], // Return first mismatch as primary reason
      allReasons: mismatches,
      audioFeatures: {
        energy: audioFeatures.energy,
        valence: audioFeatures.valence,
        tempo: audioFeatures.tempo,
        danceability: audioFeatures.danceability,
      },
      referenceFeatures: referenceFeatures ? {
        energy: referenceFeatures.energy,
        valence: referenceFeatures.valence,
        tempo: referenceFeatures.tempo,
        danceability: referenceFeatures.danceability,
      } : null,
      thresholds,
    };
  }

  return { matches: true, reason: null };
}

// Middleware
app.use(express.json());
// CORS configuration - accepts comma-separated origins
const corsOrigins = (process.env.FRONTEND_URL || 'http://localhost:3000')
  .split(',')
  .map(origin => origin.trim());

app.use(cors({
  origin: corsOrigins.length === 1 ? corsOrigins[0] : corsOrigins,
  credentials: true,
}));
app.use(session({
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true,
    maxAge: 24 * 60 * 60 * 1000, // 24 hours
  },
}));

// PKCE helper functions
function generateCodeVerifier() {
  return crypto.randomBytes(32).toString('base64url');
}

function generateCodeChallenge(verifier) {
  return crypto.createHash('sha256').update(verifier).digest('base64url');
}

function generateState() {
  return crypto.randomBytes(16).toString('hex');
}

// Spotify API helper
async function spotifyFetch(endpoint, options = {}) {
  // Check if we need to refresh the token
  if (hostTokens.expiresAt && Date.now() >= hostTokens.expiresAt - 60000) {
    await refreshAccessToken();
  }

  if (!hostTokens.accessToken) {
    throw new Error('Not authenticated');
  }

  const response = await fetch(`https://api.spotify.com/v1${endpoint}`, {
    ...options,
    headers: {
      'Authorization': `Bearer ${hostTokens.accessToken}`,
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });

  if (response.status === 401) {
    // Token expired, try to refresh
    await refreshAccessToken();
    // Retry the request
    return fetch(`https://api.spotify.com/v1${endpoint}`, {
      ...options,
      headers: {
        'Authorization': `Bearer ${hostTokens.accessToken}`,
        'Content-Type': 'application/json',
        ...options.headers,
      },
    });
  }

  return response;
}

// Refresh access token
async function refreshAccessToken() {
  if (!hostTokens.refreshToken) {
    throw new Error('No refresh token available');
  }

  const response = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Authorization': `Basic ${Buffer.from(`${process.env.SPOTIFY_CLIENT_ID}:${process.env.SPOTIFY_CLIENT_SECRET}`).toString('base64')}`,
    },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: hostTokens.refreshToken,
    }),
  });

  if (!response.ok) {
    const error = await response.json();
    console.error('Failed to refresh token:', error);
    hostTokens = { accessToken: null, refreshToken: null, expiresAt: null };
    throw new Error('Failed to refresh token');
  }

  const data = await response.json();
  hostTokens.accessToken = data.access_token;
  if (data.refresh_token) {
    hostTokens.refreshToken = data.refresh_token;
  }
  hostTokens.expiresAt = Date.now() + data.expires_in * 1000;

  console.log('Access token refreshed successfully');
}

// Rate limiting middleware for queue additions
function checkRateLimit(req, res, next) {
  const ip = req.ip || req.connection.remoteAddress || 'unknown';
  const now = Date.now();

  let userLimit = rateLimitStore.get(ip);

  if (!userLimit || now - userLimit.windowStart >= RATE_LIMIT_WINDOW_MS) {
    // Start new window
    userLimit = { count: 0, windowStart: now };
  }

  if (userLimit.count >= RATE_LIMIT_MAX_REQUESTS) {
    const resetTime = userLimit.windowStart + RATE_LIMIT_WINDOW_MS;
    const minutesRemaining = Math.ceil((resetTime - now) / 60000);
    return res.status(429).json({
      error: 'Rate limit exceeded',
      message: `You can only add ${RATE_LIMIT_MAX_REQUESTS} songs per hour. Try again in ${minutesRemaining} minute(s).`,
      resetAt: new Date(resetTime).toISOString(),
      remaining: 0,
    });
  }

  // Store for later increment (will be incremented on successful queue addition)
  req.rateLimit = { ip, userLimit };
  next();
}

// =============================================================================
// AUTH ROUTES
// =============================================================================

// GET /api/auth/login - Redirect to Spotify OAuth
app.get('/api/auth/login', (req, res) => {
  const codeVerifier = generateCodeVerifier();
  const codeChallenge = generateCodeChallenge(codeVerifier);
  const state = generateState();

  // Store in memory (more reliable than session on Render free tier)
  oauthStateStore.set(state, { codeVerifier, createdAt: Date.now() });

  // Clean up old states (older than 10 minutes)
  const TEN_MINUTES = 10 * 60 * 1000;
  for (const [key, value] of oauthStateStore.entries()) {
    if (Date.now() - value.createdAt > TEN_MINUTES) {
      oauthStateStore.delete(key);
    }
  }

  const scopes = [
    'user-read-playback-state',
    'user-modify-playback-state',
    'user-read-currently-playing',
  ].join(' ');

  const authUrl = new URL('https://accounts.spotify.com/authorize');
  authUrl.searchParams.set('client_id', process.env.SPOTIFY_CLIENT_ID);
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('redirect_uri', process.env.SPOTIFY_REDIRECT_URI);
  authUrl.searchParams.set('scope', scopes);
  authUrl.searchParams.set('state', state);
  authUrl.searchParams.set('code_challenge_method', 'S256');
  authUrl.searchParams.set('code_challenge', codeChallenge);

  res.redirect(authUrl.toString());
});

// GET /api/auth/callback - Handle OAuth callback
app.get('/api/auth/callback', async (req, res) => {
  const { code, state, error } = req.query;
  const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';

  if (error) {
    console.error('OAuth error:', error);
    return res.redirect(`${frontendUrl}?error=${encodeURIComponent(error)}`);
  }

  if (!code) {
    return res.redirect(`${frontendUrl}?error=missing_code`);
  }

  // Verify state and get code verifier from memory store
  const storedAuth = oauthStateStore.get(state);
  if (!storedAuth) {
    console.error('State mismatch or expired. State:', state, 'Store size:', oauthStateStore.size);
    return res.redirect(`${frontendUrl}?error=state_mismatch`);
  }

  const { codeVerifier } = storedAuth;

  // Clean up used state
  oauthStateStore.delete(state);

  try {
    // Exchange code for tokens
    const tokenResponse = await fetch('https://accounts.spotify.com/api/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': `Basic ${Buffer.from(`${process.env.SPOTIFY_CLIENT_ID}:${process.env.SPOTIFY_CLIENT_SECRET}`).toString('base64')}`,
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: process.env.SPOTIFY_REDIRECT_URI,
        code_verifier: codeVerifier,
      }),
    });

    if (!tokenResponse.ok) {
      const errorData = await tokenResponse.json();
      console.error('Token exchange failed:', errorData);
      return res.redirect(`${frontendUrl}?error=token_exchange_failed`);
    }

    const tokenData = await tokenResponse.json();

    // Store tokens
    hostTokens = {
      accessToken: tokenData.access_token,
      refreshToken: tokenData.refresh_token,
      expiresAt: Date.now() + tokenData.expires_in * 1000,
    };

    console.log('Successfully authenticated with Spotify');
    res.redirect(`${frontendUrl}?authenticated=true`);
  } catch (err) {
    console.error('OAuth callback error:', err);
    res.redirect(`${frontendUrl}?error=server_error`);
  }
});

// GET /api/auth/status - Check authentication status
app.get('/api/auth/status', (req, res) => {
  const isAuthenticated = !!(hostTokens.accessToken && hostTokens.expiresAt);
  const expiresAt = hostTokens.expiresAt;

  res.json({
    authenticated: isAuthenticated,
    expiresAt: expiresAt ? new Date(expiresAt).toISOString() : null,
  });
});

// POST /api/auth/logout - Clear tokens
app.post('/api/auth/logout', (req, res) => {
  hostTokens = { accessToken: null, refreshToken: null, expiresAt: null };
  res.json({ success: true, message: 'Logged out successfully' });
});

// =============================================================================
// SPOTIFY API ROUTES
// =============================================================================

// GET /api/now-playing - Get currently playing track
app.get('/api/now-playing', async (req, res) => {
  try {
    const response = await spotifyFetch('/me/player/currently-playing');

    if (response.status === 204) {
      return res.json({ playing: false, track: null });
    }

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      return res.status(response.status).json({
        error: 'Failed to get currently playing track',
        details: error,
      });
    }

    const data = await response.json();

    if (!data || !data.item) {
      return res.json({ playing: false, track: null });
    }

    res.json({
      playing: data.is_playing,
      track: {
        id: data.item.id,
        name: data.item.name,
        artists: data.item.artists.map(a => ({ id: a.id, name: a.name })),
        album: {
          id: data.item.album.id,
          name: data.item.album.name,
          images: data.item.album.images,
        },
        duration_ms: data.item.duration_ms,
        progress_ms: data.progress_ms,
        uri: data.item.uri,
      },
    });
  } catch (err) {
    console.error('Error getting currently playing:', err);
    if (err.message === 'Not authenticated') {
      return res.status(401).json({ error: 'Not authenticated' });
    }
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/queue - Get upcoming queue
app.get('/api/queue', async (req, res) => {
  try {
    const response = await spotifyFetch('/me/player/queue');

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      return res.status(response.status).json({
        error: 'Failed to get queue',
        details: error,
      });
    }

    const data = await response.json();

    // Limit to max 20 tracks
    const queue = (data.queue || []).slice(0, 20).map(track => ({
      id: track.id,
      name: track.name,
      artists: track.artists.map(a => ({ id: a.id, name: a.name })),
      album: {
        id: track.album.id,
        name: track.album.name,
        images: track.album.images,
      },
      duration_ms: track.duration_ms,
      uri: track.uri,
    }));

    const currentlyPlaying = data.currently_playing ? {
      id: data.currently_playing.id,
      name: data.currently_playing.name,
      artists: data.currently_playing.artists.map(a => ({ id: a.id, name: a.name })),
      album: {
        id: data.currently_playing.album.id,
        name: data.currently_playing.album.name,
        images: data.currently_playing.album.images,
      },
      duration_ms: data.currently_playing.duration_ms,
      uri: data.currently_playing.uri,
    } : null;

    res.json({
      currentlyPlaying,
      queue,
      total: queue.length,
    });
  } catch (err) {
    console.error('Error getting queue:', err);
    if (err.message === 'Not authenticated') {
      return res.status(401).json({ error: 'Not authenticated' });
    }
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/search - Search Spotify catalog
app.get('/api/search', async (req, res) => {
  const { q, type = 'track' } = req.query;

  if (!q) {
    return res.status(400).json({ error: 'Missing search query parameter "q"' });
  }

  try {
    // Spotify API limit is now 0-10 (changed from 0-50)
    const searchUrl = `/search?q=${encodeURIComponent(q)}&type=${type}&limit=10`;

    const response = await spotifyFetch(searchUrl);

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      return res.status(response.status).json({
        error: 'Search failed',
        details: error,
      });
    }

    const data = await response.json();

    // Format tracks for easier frontend consumption
    const tracks = (data.tracks?.items || []).map(track => ({
      id: track.id,
      name: track.name,
      artists: track.artists.map(a => ({ id: a.id, name: a.name })),
      album: {
        id: track.album.id,
        name: track.album.name,
        images: track.album.images,
      },
      duration_ms: track.duration_ms,
      uri: track.uri,
      preview_url: track.preview_url,
    }));

    res.json({
      tracks,
      total: data.tracks?.total || 0,
    });
  } catch (err) {
    console.error('Error searching:', err);
    if (err.message === 'Not authenticated') {
      return res.status(401).json({ error: 'Not authenticated' });
    }
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/queue - Add track to queue (with vibe check)
app.post('/api/queue', checkRateLimit, async (req, res) => {
  const { uri } = req.body;

  if (!uri) {
    return res.status(400).json({ error: 'Missing track URI in request body' });
  }

  // Validate URI format
  if (!uri.startsWith('spotify:track:')) {
    return res.status(400).json({ error: 'Invalid track URI format. Must be spotify:track:...' });
  }

  // Extract track ID from URI
  const trackId = uri.replace('spotify:track:', '');

  try {
    // Check vibe if enabled
    if (currentVibe.settings.enabled) {
      const audioFeatures = await getAudioFeatures(trackId);

      if (audioFeatures) {
        const vibeCheck = await checkVibeMatch(audioFeatures);

        if (!vibeCheck.matches) {
          return res.status(403).json({
            error: 'vibe_mismatch',
            message: `This song doesn't match the ${currentVibe.settings.name} vibe`,
            reason: vibeCheck.reason,
            allReasons: vibeCheck.allReasons,
            audioFeatures: vibeCheck.audioFeatures,
            referenceFeatures: vibeCheck.referenceFeatures,
            currentVibe: currentVibe.preset,
          });
        }
      }
      // If we can't get audio features, allow the song (fail open)
    }

    const response = await spotifyFetch(`/me/player/queue?uri=${encodeURIComponent(uri)}`, {
      method: 'POST',
    });

    if (response.status === 204) {
      // Success - increment rate limit counter
      const { ip, userLimit } = req.rateLimit;
      userLimit.count++;
      rateLimitStore.set(ip, userLimit);

      const remaining = RATE_LIMIT_MAX_REQUESTS - userLimit.count;

      return res.json({
        success: true,
        message: 'Track added to queue',
        rateLimit: {
          remaining,
          resetAt: new Date(userLimit.windowStart + RATE_LIMIT_WINDOW_MS).toISOString(),
        },
      });
    }

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));

      // Handle common errors
      if (response.status === 404) {
        return res.status(404).json({
          error: 'No active device found',
          message: 'Please start playing something on Spotify first.',
        });
      }

      return res.status(response.status).json({
        error: 'Failed to add track to queue',
        details: error,
      });
    }

    res.json({ success: true, message: 'Track added to queue' });
  } catch (err) {
    console.error('Error adding to queue:', err);
    if (err.message === 'Not authenticated') {
      return res.status(401).json({ error: 'Not authenticated' });
    }
    res.status(500).json({ error: 'Internal server error' });
  }
});

// =============================================================================
// VIBE API ROUTES (Host only)
// =============================================================================

// GET /api/vibe - Get current vibe settings
app.get('/api/vibe', (req, res) => {
  res.json({
    currentPreset: currentVibe.preset,
    settings: currentVibe.settings,
    availablePresets: Object.entries(VIBE_PRESETS).map(([key, value]) => ({
      id: key,
      name: value.name,
      description: value.description,
    })),
  });
});

// POST /api/vibe - Set vibe preset
app.post('/api/vibe', (req, res) => {
  const { preset, customSettings } = req.body;

  if (!preset || !VIBE_PRESETS[preset]) {
    return res.status(400).json({
      error: 'Invalid preset',
      validPresets: Object.keys(VIBE_PRESETS)
    });
  }

  if (preset === 'custom' && customSettings) {
    currentVibe = {
      preset: 'custom',
      settings: {
        ...VIBE_PRESETS.custom,
        ...customSettings,
        enabled: true,
      },
    };
  } else {
    currentVibe = {
      preset,
      settings: { ...VIBE_PRESETS[preset] },
    };
  }

  console.log(`Vibe set to: ${currentVibe.settings.name}`);

  res.json({
    success: true,
    message: `Vibe set to ${currentVibe.settings.name}`,
    currentPreset: currentVibe.preset,
    settings: currentVibe.settings,
  });
});

// GET /api/vibe/check/:trackId - Check if a track matches the current vibe (for preview)
app.get('/api/vibe/check/:trackId', async (req, res) => {
  const { trackId } = req.params;

  if (!currentVibe.settings.enabled) {
    return res.json({ matches: true, vibeEnabled: false });
  }

  try {
    const audioFeatures = await getAudioFeatures(trackId);

    if (!audioFeatures) {
      return res.json({
        matches: true,
        vibeEnabled: true,
        note: 'Could not fetch audio features, allowing song'
      });
    }

    const vibeCheck = await checkVibeMatch(audioFeatures);

    res.json({
      matches: vibeCheck.matches,
      vibeEnabled: true,
      currentVibe: currentVibe.settings.name,
      isDynamic: currentVibe.settings.dynamic || false,
      reason: vibeCheck.reason,
      allReasons: vibeCheck.allReasons,
      audioFeatures: {
        energy: audioFeatures.energy,
        valence: audioFeatures.valence,
        tempo: Math.round(audioFeatures.tempo),
        danceability: audioFeatures.danceability,
      },
      referenceFeatures: vibeCheck.referenceFeatures,
      thresholds: vibeCheck.thresholds || {
        energy: currentVibe.settings.energy,
        valence: currentVibe.settings.valence,
        tempo: currentVibe.settings.tempo,
        danceability: currentVibe.settings.danceability,
      },
    });
  } catch (err) {
    console.error('Error checking vibe:', err);
    res.status(500).json({ error: 'Failed to check vibe' });
  }
});

// GET /api/rate-limit - Get rate limit status for current user
app.get('/api/rate-limit', (req, res) => {
  const ip = req.ip || req.connection.remoteAddress || 'unknown';
  const now = Date.now();

  const userLimit = rateLimitStore.get(ip);

  if (!userLimit || now - userLimit.windowStart >= RATE_LIMIT_WINDOW_MS) {
    return res.json({
      remaining: RATE_LIMIT_MAX_REQUESTS,
      limit: RATE_LIMIT_MAX_REQUESTS,
      resetAt: null,
    });
  }

  const remaining = Math.max(0, RATE_LIMIT_MAX_REQUESTS - userLimit.count);
  const resetAt = new Date(userLimit.windowStart + RATE_LIMIT_WINDOW_MS).toISOString();

  res.json({
    remaining,
    limit: RATE_LIMIT_MAX_REQUESTS,
    resetAt,
  });
});

// =============================================================================
// ERROR HANDLING
// =============================================================================

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// Global error handler
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

// =============================================================================
// START SERVER
// =============================================================================

app.listen(PORT, () => {
  console.log(`Spotify Party Queue server running on port ${PORT}`);
  console.log(`Frontend URL: ${process.env.FRONTEND_URL || 'http://localhost:3000'}`);
  console.log(`OAuth Redirect URI: ${process.env.SPOTIFY_REDIRECT_URI}`);
});
