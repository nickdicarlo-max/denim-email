# Security

## Threat Model

We read users' email. Every security decision starts from: "What if this gets breached?"

## OAuth Token Handling

- Tokens stored encrypted at rest (env: `TOKEN_ENCRYPTION_KEY`)
- Never log tokens or include in error messages
- Token refresh server-side only, never exposed to client
- Scopes: `gmail.readonly` first. `calendar.events` added progressively. Never `gmail.send`.

## Row Level Security (RLS)

- Enable Supabase RLS on ALL tables
- Every query scoped by userId (via schema -> user chain)
- Service role key used ONLY in server-side services, never in client code

## API Security

- All routes require authenticated Supabase session
- Rate limiting on AI-heavy endpoints
- Input validation via Zod on every route
- CORS configured for extension origin only in production
- No sensitive data in error responses

## Data Handling

- Email bodies NOT stored (summary + metadata only)
- Attachment bytes NOT stored (metadata + extraction summary only)
- Account deletion cascades all data
- Per-user data isolation enforced at query level

## Future Security (plan for, not MVP)

- SOC 2 Type I readiness
- Google CASA Tier 2 assessment
- CSP headers, SRI for extension scripts
