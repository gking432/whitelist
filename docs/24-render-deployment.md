# Render test deployment

Northstar uses two public services:

- `northstar-app`: the web application, APIs, and Twilio webhooks.
- `northstar-voice-stream`: the WebSocket gateway for staff-assisted calls.

## Prerequisites

1. Create a hosted Supabase project and apply every migration in
   `supabase/migrations`.
2. Create an OpenAI project API key with billing enabled.
3. Create a Render account and connect the GitHub repository.

## Deploy

1. In Render, create a Blueprint from this repository's `render.yaml`.
2. Enter the requested Supabase and OpenAI values. Generate
   `SECRETS_ENCRYPTION_KEY` locally with `openssl rand -base64 32`.
3. After Render reserves both service names, set these values:
   - App `NEXT_PUBLIC_APP_URL`: the app's `https://...onrender.com` URL.
   - App `NORTHSTAR_VOICE_STREAM_URL`: the voice service URL using
     `wss://...onrender.com/twilio`.
   - Voice `NORTHSTAR_APP_URL`: the app's `https://...onrender.com` URL.
4. Redeploy both services after setting the URLs. Public Next.js variables are
   embedded during the app build, so the app must be rebuilt after they change.
5. Open `/partner/onboarding`, create the test client, and connect Twilio and
   Google Calendar from the client's Setup workspace.

Use paid always-on instances for phone testing. Sleeping services can add enough
cold-start delay for an inbound phone call to fail before the app answers.
