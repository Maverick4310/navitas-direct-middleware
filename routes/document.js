/**
 * Document Route
 *
 * Handles document fetch and upload requests from partner org
 * Salesforce callouts and forwards them to the appropriate
 * Navitas endpoint.
 *
 * GET  /api/document?appId={lw_app_id}   — fetch Dealer Call Letter
 *      Proxies to the Navitas home org regular REST API.
 *      (Home org required here because the Sites guest-user context
 *      cannot make outbound callouts to Leaseworks.)
 *
 * POST /api/document/upload              — attach a document to a deal
 *      Calls the Navitas Connect attachment API directly:
 *      POST {NAVITAS_ATTACH_BASE_URL}/v1/application/attachment?app_id={lwAppId}
 *      Body: { file_name, data }
 *      Auth: HMAC Authorization + Api-Token (per-partner, from X-Navitas-Token).
 *
 * Inbound auth (both routes):
 *   X-Api-Key header — validated by authMiddleware against PARTNER_API_KEYS.
 *
 * Required env vars:
 *   SF_HOME_ORG_URL         — Full URL to NavitasDocumentResource (GET route only)
 *   NAVITAS_ATTACH_BASE_URL — Base URL for the Navitas attachment API,
 *                             e.g. https://partner.navitascredit.com
 *   NAVITAS_HMAC_CLIENT_ID  — HMAC signing client ID
 *   NAVITAS_HMAC_SECRET     — HMAC signing secret
 *
 * GET response mirrors NavitasDocumentResource exactly:
 *   200  { success: true,  fileName, mimeType, bytes }
 *   400  { success: false, error: "..." }
 *   401  { success: false, error: "..." }
 *   404  { success: false, error: "..." }
 *   502  { success: false, error: "..." }
 *
 * POST response:
 *   200  { success: true }
 *   400  { success: false, error: "..." }
 *   401  { success: false, error: "..." }
 *   500  { success: false, error: "..." }
 */

const express = require('express');
const router  = express.Router();
const navitas = require('../services/navitasClient');

// ─────────────────────────────────────────────────────────────────────
//  GET /api/document?appId={lw_app_id}
//  Fetch Dealer Call Letter for an approved application.
// ─────────────────────────────────────────────────────────────────────

router.get('/', async (req, res) => {
    try {

        // ─── Validate appId ───────────────────────────────────────────
        const { appId } = req.query;

        if (!appId || !appId.trim()) {
            return res.status(400).json({
                success: false,
                error: 'appId query parameter is required.'
            });
        }

        // ─── Resolve home org URL ─────────────────────────────────────
        const homeOrgUrl = (process.env.SF_HOME_ORG_URL || '').replace(/\/+$/, '');

        if (!homeOrgUrl) {
            console.error('SF_HOME_ORG_URL env var is not configured');
            return res.status(500).json({
                success: false,
                error: 'Document service is not configured on the server.'
            });
        }

        // ─── Forward request to home org ──────────────────────────────
        // X-Api-Key is forwarded as-is — home org validates it against
        // API_Rest_Credential__mdt.Client_Secret__c for per-partner auth.
        const url = `${homeOrgUrl}?appId=${encodeURIComponent(appId.trim())}`;

        console.log('═══ NAVITAS DOCUMENT REQUEST ═══');
        console.log('App ID:', appId);
        console.log('Home org URL:', url);
        console.log('X-Api-Key received from partner:', req.headers['x-api-key'] ? req.headers['x-api-key'].substring(0, 8) + '...' : 'MISSING');
        console.log('Full X-Api-Key being forwarded:', req.headers['x-api-key'] || 'MISSING');
        console.log('════════════════════════════════');

        const sfResponse = await fetch(url, {
            method: 'GET',
            headers: {
                'X-Api-Key':  req.headers['x-api-key'],
                'Accept':     'application/json',
                'User-Agent': 'NavitasDirectMiddleware/1.0'
            }
        });

        const contentType = sfResponse.headers.get('content-type') || '';
        let body;

        if (contentType.includes('application/json')) {
            body = await sfResponse.json();
        } else {
            const text = await sfResponse.text();
            body = { success: false, error: `Unexpected response from home org: ${text.substring(0, 200)}` };
        }

        console.log(`Home org response: HTTP ${sfResponse.status}`);

        if (!sfResponse.ok) {
            console.warn('Home org error:', JSON.stringify(body));
        }

        // Mirror the home org status code and body back to the partner org
        return res.status(sfResponse.status).json(body);

    } catch (err) {
        console.error('═══ DOCUMENT ROUTE ERROR ═══');
        console.error('Message:', err.message);
        console.error('════════════════════════════');

        return res.status(500).json({
            success: false,
            error: 'Document service encountered an unexpected error: ' + err.message
        });
    }
});

// ─────────────────────────────────────────────────────────────────────
//  POST /api/document/upload
//  Accept a file from the partner org and POST it directly to the
//  Navitas Connect attachment API.
//
//  Expected JSON body (sent by AppDocumentUploadCalloutService):
//    { lwAppId: string, fileName: string, bytes: string (base64) }
//
//  X-Navitas-Token header carries the per-partner Navitas API token
//  (API_Key__c from partner org config) — forwarded as Api-Token to
//  the Navitas attachment API.
// ─────────────────────────────────────────────────────────────────────

router.post('/upload', async (req, res) => {
    try {

        // ─── Validate body ────────────────────────────────────────────
        const { lwAppId, fileName, bytes } = req.body || {};
        const navitasToken = req.headers['x-navitas-token'];

        if (!lwAppId || !lwAppId.trim()) {
            return res.status(400).json({
                success: false,
                error: 'lwAppId is required.'
            });
        }

        if (!fileName || !fileName.trim()) {
            return res.status(400).json({
                success: false,
                error: 'fileName is required.'
            });
        }

        if (!bytes || !bytes.trim()) {
            return res.status(400).json({
                success: false,
                error: 'bytes (base64 file content) is required.'
            });
        }

        if (!navitasToken) {
            return res.status(400).json({
                success: false,
                error: 'X-Navitas-Token header is required.'
            });
        }

        // ─── Check client config ──────────────────────────────────────
        if (!navitas.isAttachConfigured()) {
            console.error('NAVITAS_ATTACH_BASE_URL or HMAC credentials are not configured');
            return res.status(503).json({
                success: false,
                error: 'Attachment service is not configured on the server.'
            });
        }

        // ─── Build path and body for Navitas attachment API ───────────
        // app_id goes in the query string; body carries file_name + data.
        const path        = `/v1/application/attachment?app_id=${encodeURIComponent(lwAppId.trim())}`;
        const attachBody  = {
            file_name: fileName.trim(),
            data:      bytes.trim()
        };

        console.log('═══ NAVITAS ATTACHMENT REQUEST ═══');
        console.log('App ID   :', lwAppId);
        console.log('File     :', fileName);
        console.log('Bytes len:', bytes.length);
        console.log('Path     :', path);
        console.log('Api-Token:', navitasToken.substring(0, 8) + '...');
        console.log('══════════════════════════════════');

        // ─── Forward to Navitas Connect attachment API ────────────────
        const result = await navitas.postAttachment(path, attachBody, navitasToken);

        console.log(`Navitas attachment response: HTTP ${result.status}`);

        return res.json({ success: true });

    } catch (err) {
        console.error('═══ ATTACHMENT UPLOAD ERROR ═══');
        console.error('Message:', err.message);
        console.error('Status :', err.status);
        console.error('Data   :', JSON.stringify(err.data));
        console.error('═══════════════════════════════');

        const navitasData = err.data || {};
        return res.status(err.status || 500).json({
            success: false,
            error:   navitasData.error   || navitasData.message || err.message
        });
    }
});

module.exports = router;
