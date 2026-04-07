/**
 * Vendors Route
 *
 * Returns the full list of asset vendors from the Navitas Connect API.
 * The full list is returned on every call — filtering happens client-side
 * in the LWC.
 *
 * GET /api/vendors
 *
 * Response:
 *   [ { "vendor_number": "12345", "name": "Vendor Name", ... }, ... ]
 */

const express = require('express');
const router  = express.Router();
const navitas = require('../services/navitasClient');

router.get('/', async (req, res) => {
    try {

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
        console.log('══════════════════════════════');
        const result = await navitas.getAttach('/v1/asset_vendors');
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
