/**
 * Document Route
 *
 * Handles document fetch and upload requests from partner org
 * Salesforce callouts and forwards them to the Navitas home org
 * regular REST API.
 *
 * This route exists because the home org's NavitasDocumentResource
 * must make outbound callouts to Leaseworks — which is not permitted
 * in the Salesforce Sites guest user context. Routing through Render
 * avoids that restriction entirely.
 *
 * GET  /api/document?appId={lw_app_id}   — fetch Dealer Call Letter
 * POST /api/document/upload              — attach a document to a deal
 *
 * Auth:
 *   Inbound  — X-Api-Key header forwarded as-is to the home org.
 *   Outbound — Home org validates X-Api-Key against
 *              API_Rest_Credential__mdt.Client_Secret__c
 *              (per-partner, multi-vendor safe).
 *
 * Required env vars:
 *   SF_HOME_ORG_URL         — Full URL to NavitasDocumentResource, e.g.:
 *                             https://navitascredit.my.salesforce.com/services/apexrest/navitas/documents
 *                             (no trailing slash)
 *   SF_HOME_ORG_UPLOAD_URL  — Full URL to NavitasDocumentUploadResource, e.g.:
 *                             https://navitascredit.my.salesforce.com/services/apexrest/navitas/documents/upload
 *                             (no trailing slash)
 *
 * GET response mirrors NavitasDocumentResource exactly:
 *   200  { success: true,  fileName, mimeType, bytes }
 *   400  { success: false, error: "..." }
 *   401  { success: false, error: "..." }
 *   404  { success: false, error: "..." }
 *   502  { success: false, error: "..." }
 *
 * POST response mirrors NavitasDocumentUploadResource exactly:
 *   200  { success: true }
 *   400  { success: false, error: "..." }
 *   401  { success: false, error: "..." }
 *   500  { success: false, error: "..." }
 */

const express = require('express');
const router  = express.Router();

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
//  Accept a file from the partner org and forward to the home org,
//  which stages it and queues the LW ImportFile callout.
//
//  Expected JSON body (sent by AppDocumentUploadCalloutService):
//    { lwAppId: string, fileName: string, bytes: string (base64) }
// ─────────────────────────────────────────────────────────────────────

router.post('/upload', async (req, res) => {
    try {

        // ─── Validate body ────────────────────────────────────────────
        const { lwAppId, fileName, bytes } = req.body || {};

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

        // ─── Resolve home org upload URL ──────────────────────────────
        const uploadUrl = (process.env.SF_HOME_ORG_UPLOAD_URL || '').replace(/\/+$/, '');

        if (!uploadUrl) {
            console.error('SF_HOME_ORG_UPLOAD_URL env var is not configured');
            return res.status(500).json({
                success: false,
                error: 'Upload service is not configured on the server.'
            });
        }

        // ─── Forward to home org ──────────────────────────────────────
        // X-Api-Key forwarded as-is — home org validates against
        // API_Rest_Credential__mdt.Client_Secret__c, same as GET route.
        console.log('═══ NAVITAS UPLOAD REQUEST ═══');
        console.log('App ID   :', lwAppId);
        console.log('File     :', fileName);
        console.log('Bytes len:', bytes.length);
        console.log('Home org :', uploadUrl);
        console.log('X-Api-Key:', req.headers['x-api-key'] ? req.headers['x-api-key'].substring(0, 8) + '...' : 'MISSING');
        console.log('══════════════════════════════');

        const sfResponse = await fetch(uploadUrl, {
            method: 'POST',
            headers: {
                'X-Api-Key':    req.headers['x-api-key'],
                'Content-Type': 'application/json',
                'Accept':       'application/json',
                'User-Agent':   'NavitasDirectMiddleware/1.0'
            },
            body: JSON.stringify({
                lwAppId:  lwAppId.trim(),
                fileName: fileName.trim(),
                bytes:    bytes.trim()
            })
        });

        const contentType = sfResponse.headers.get('content-type') || '';
        let body;

        if (contentType.includes('application/json')) {
            body = await sfResponse.json();
        } else {
            const text = await sfResponse.text();
            body = { success: false, error: `Unexpected response from home org: ${text.substring(0, 200)}` };
        }

        console.log(`Home org upload response: HTTP ${sfResponse.status}`);

        if (!sfResponse.ok) {
            console.warn('Home org upload error:', JSON.stringify(body));
        }

        // Mirror the home org status code and body back to the partner org
        return res.status(sfResponse.status).json(body);

    } catch (err) {
        console.error('═══ UPLOAD ROUTE ERROR ═══');
        console.error('Message:', err.message);
        console.error('══════════════════════════');

        return res.status(500).json({
            success: false,
            error: 'Upload service encountered an unexpected error: ' + err.message
        });
    }
});

module.exports = router;
