/**
 * Asset Types Route
 *
 * Returns the full list of asset types from the Navitas Connect API.
 * The full list is returned on every call — filtering happens client-side
 * in the LWC.
 *
 * GET /api/asset-types
 *
 * Response:
 *   [ { "code": "SERV", "description": "Servers" }, ... ]
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
        const fullUrl = `${navitas.attachBaseUrl}/v1/asset_types`;
        console.log('═══ NAVITAS ASSET TYPES REQUEST ═══');
        console.log('URL        :', fullUrl);
        console.log('HMAC client:', navitas.clientId);
        console.log('═══════════════════════════════════');

        const result = await navitas.getAttach('/v1/asset_types');
        const assetTypes = Array.isArray(result.data) ? result.data : [];

        console.log(`Asset types response: HTTP ${result.status} | count: ${assetTypes.length}`);

        res.json(assetTypes);

    } catch (err) {
        console.error('Asset type lookup error:', err.message);
        res.status(err.status || 500).json({
            error: 'Asset type lookup failed',
            message: err.message,
            isCloudflare: err.isCloudflare || false
        });
    }
});

module.exports = router;
