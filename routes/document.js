/**
 * Document Route
 *
 * Receives a document fetch request from a partner org Salesforce
 * callout and forwards it to the Navitas home org regular REST API.
 *
 * This route exists because the home org's NavitasDocumentResource
 * must make outbound callouts to Leaseworks — which is not permitted
 * in the Salesforce Sites guest user context. Routing through Render
 * avoids that restriction entirely.
 *
 * GET /api/document?appId={lw_app_id}
 *
 * Auth:
 *   Inbound  — X-Api-Key header validated by authMiddleware against
 *              PARTNER_API_KEYS env var (same as all other routes).
 *   Outbound — X-Api-Key forwarded as-is to the home org, where it
 *              is validated against API_Rest_Credential__mdt
 *              Client_Secret__c (per-partner, multi-vendor safe).
 *
 * Required env vars:
 *   SF_HOME_ORG_URL  — e.g. https://navitascredit.my.salesforce.com
 *                      (no trailing slash)
 *
 * Response mirrors NavitasDocumentResource exactly:
 *   200  { success: true,  fileName, mimeType, bytes }
 *   400  { success: false, error: "..." }
 *   401  { success: false, error: "..." }
 *   404  { success: false, error: "..." }
 *   502  { success: false, error: "..." }
 */

const express = require('express');
const router  = express.Router();

const SF_DOCUMENT_PATH = '/services/apexrest/navitas/documents';

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
                'X-Api-Key': req.headers['x-api-key'],
                'Accept':    'application/json',
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

module.exports = router;
