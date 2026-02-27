/**
 * Submit Route
 * 
 * Receives a credit application payload from Salesforce
 * and forwards it to the Navitas Credit API with proper
 * HMAC authentication.
 * 
 * POST /api/submit
 * Body: { channel: "Indirect"|"Direct", payload: { ... } }
 * 
 * The LWC builds the payload (Indirect = LeaseWorks format,
 * Direct = CreditApplicationRequest format), and this route
 * forwards it to the appropriate Navitas endpoint.
 */

const express = require('express');
const router = express.Router();
const navitas = require('../services/navitasClient');

// Navitas submission paths by channel
const SUBMIT_PATHS = {
    Indirect: '/v1/applications',
    Direct:   '/v1/applications'
};

router.post('/', async (req, res) => {
    try {
        const { channel, payload } = req.body;

        // ─── Validate ───
        if (!channel || !['Indirect', 'Direct'].includes(channel)) {
            return res.status(400).json({
                error: 'Invalid channel',
                message: 'Channel must be "Indirect" or "Direct"'
            });
        }

        if (!payload || typeof payload !== 'object') {
            return res.status(400).json({
                error: 'Invalid payload',
                message: 'Request body must include a payload object'
            });
        }

        // ─── Check config ───
        if (!navitas.isConfigured()) {
            return res.status(503).json({
                error: 'Service not configured',
                message: 'Navitas API credentials are not set on the server'
            });
        }

        // ─── Forward to Navitas ───
        const path = SUBMIT_PATHS[channel];
        console.log(`Submitting ${channel} application to ${path}`);
        console.log('Payload keys:', Object.keys(payload));

        const result = await navitas.post(path, payload);

        console.log(`Submission successful: HTTP ${result.status}`);

        res.json({
            success: true,
            status: result.status,
            data: result.data
        });

    } catch (err) {
        console.error('Submission error:', err.message);
        console.error('Navitas response data:', err.data);

        res.status(err.status || 500).json({
            success: false,
            error: 'Submission failed',
            message: err.message,
            details: err.data || null
        });
    }
});

module.exports = router;
