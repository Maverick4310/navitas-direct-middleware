/**
 * Vendors Route
 *
 * Returns the full list of asset vendors from the Navitas Connect API.
 * The full list is returned on every call — filtering happens client-side
 * in the LWC.
 *
 * GET /api/vendors
 *
 * The partner's Navitas API token is forwarded via the X-Api-Key request
 * header (sourced from Navitas_Direct_Config__c.API_Key__c in Salesforce)
 * and passed as Api-Token to the Navitas Connect API.
 *
 * Response:
 *   [ { "vendor_number": "12345", "vendor_name": "Vendor Name", ... }, ... ]
 */

const express = require('express');
const router  = express.Router();
const navitas = require('../services/navitasClient');

router.get('/', async (req, res) => {
    try {

        // ─── Validate token ────────────────────────────────────────────
        const navitasToken = req.headers['x-api-key'];

        if (!navitasToken) {
            return res.status(400).json({
                error: 'Missing token',
                message: 'X-Api-Key header is required.'
            });
        }

        // ─── Check config ──────────────────────────────────────────────
        if (!navitas.isAttachConfigured()) {
            return res.status(503).json({
                error: 'Service not configured',
                message: 'Navitas API credentials are not set on the server'
            });
        }

        // ─── Call Navitas ──────────────────────────────────────────────
        const fullUrl = `${navitas.attachBaseUrl}/v1/asset_vendors`;
        console.log('═══ NAVITAS VENDOR REQUEST ═══');
        console.log('URL        :', fullUrl);
        console.log('HMAC client:', navitas.clientId);
        console.log('Api-Token  :', navitasToken.substring(0, 8) + '...');
        console.log('══════════════════════════════');

        const result = await navitas.getAttach('/v1/asset_vendors', navitasToken);
        console.log(`Vendor response: HTTP ${result.status} | count: ${Array.isArray(result.data) ? result.data.length : 'n/a'}`);

        const vendors = Array.isArray(result.data) ? result.data : [];
        res.json(vendors);

    } catch (err) {
        console.error('Vendor lookup error:', err.message);
        res.status(err.status || 500).json({
            error: 'Vendor lookup failed',
            message: err.message,
            isCloudflare: err.isCloudflare || false
        });
    }
});

module.exports = router;
