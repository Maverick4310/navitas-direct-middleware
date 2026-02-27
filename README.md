# Navitas Direct Middleware

Express service that bridges Salesforce partner orgs to the Navitas Credit API. Handles HMAC-SHA256 authentication, locality lookups, and credit application submissions.

## Architecture

```
Salesforce (LWC + Apex)  →  Render (this service)  →  Navitas Connect API
```

- **Salesforce** collects the credit application data via LWC
- **Render** handles all Navitas API authentication (HMAC signing)
- **Navitas** processes the credit application

## Endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/health` | None | Service health check |
| GET | `/api/localities?zipcode=10471` | X-Api-Key | Zip → city/state/county |
| POST | `/api/submit` | X-Api-Key | Submit credit application |

## Setup on Render

1. Create a **Web Service** connected to this GitHub repo
2. Render auto-detects Node.js — build command: `npm install`, start: `node server.js`
3. Set these **Environment Variables** in the Render dashboard:

| Variable | Description | Example |
|----------|-------------|---------|
| `NAVITAS_BASE_URL` | Navitas Connect API base URL | `https://connect-demo2.navitascredit.com` |
| `NAVITAS_HMAC_CLIENT_ID` | HMAC client identifier | `your-client-id` |
| `NAVITAS_HMAC_SECRET` | HMAC signing secret | `your-secret` |
| `NAVITAS_API_TOKEN` | Api-Token header value | `your-token` |
| `PARTNER_API_KEYS` | Comma-separated partner keys | `key1,key2,key3` |
| `NODE_ENV` | Environment | `production` |

## Salesforce Integration

Partner orgs need:
- **One Remote Site Setting** → your Render URL (e.g., `https://navitas-direct-middleware.onrender.com`)
- **Apex callout class** that sends requests to Render with `X-Api-Key` header

### Example Apex (Locality Lookup)

```apex
HttpRequest req = new HttpRequest();
req.setEndpoint('https://your-service.onrender.com/api/localities?zipcode=' + zipCode);
req.setMethod('GET');
req.setHeader('X-Api-Key', 'partner-api-key-here');
HttpResponse res = new Http().send(req);
```

### Example Apex (Submit Application)

```apex
HttpRequest req = new HttpRequest();
req.setEndpoint('https://your-service.onrender.com/api/submit');
req.setMethod('POST');
req.setHeader('Content-Type', 'application/json');
req.setHeader('X-Api-Key', 'partner-api-key-here');
req.setBody(JSON.serialize(new Map<String, Object>{
    'channel' => 'Indirect',
    'payload' => applicationPayload
}));
HttpResponse res = new Http().send(req);
```

## Local Development

```bash
npm install
# Create .env file with the env vars above, then:
node server.js
```
