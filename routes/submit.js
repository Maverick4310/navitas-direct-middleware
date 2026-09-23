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
 *
 * The partner's Navitas API token is forwarded via the
 * X-Navitas-Token request header, sourced from the partner's
 * Navitas_Direct_Config__c.API_Key__c field in Salesforce.
 *
 * Direct channel goes to the Navitas Salesforce home org instead of
 * LeaseWorks: POST {SF_CREDITAPP_URL} (CreditApplicationAPI, /newcreditapp).
 * The partner's X-Navitas-Token is sent as x-api-key and must match an
 * active 'Credit App' API_Rest_Credential__mdt client_Id__c in the home org.
 *
 * Required env var (Direct only):
 *   SF_CREDITAPP_URL — e.g. https://navitascredit.my.salesforce-sites.com/creditapp/services/apexrest/newcreditapp
 */
const express = require('express');
const router = express.Router();
const navitas = require('../services/navitasClient');

// LeaseWorks submission path (Indirect only — Direct goes to the SF home org)
const INDIRECT_PATH = '/v1/application/submit';

/**
 * Posts a CreditApplicationRequest payload to the SF home org and maps its
 * 201 { creditApplicationName, recordID } into the shape the package expects.
 * Errors come back as { error } with 400/401/500 and are thrown like navitasClient.
 */
async function submitDirect(payload, apiKey) {
    const url = (process.env.SF_CREDITAPP_URL || '').trim();

    const response = await fetch(url, {
        method: 'POST',
        headers: {
            'x-api-key':    apiKey,
            'Content-Type': 'application/json',
            'Accept':       'application/json',
            'User-Agent':   'NavitasDirectMiddleware/1.0'
        },
        body: JSON.stringify(payload)
    });

    const text = await response.text();
    let data;
    try { data = text ? JSON.parse(text) : {}; } catch (e) { data = { error: text.substring(0, 300) }; }

    if (!response.ok) {
        const error = new Error(`Navitas home org error: HTTP ${response.status}`);
        error.status = response.status;
        error.data = { error: data.error || 'Submission failed', message: data.message || data.error };
        throw error;
    }

    return {
        status: response.status,
        data: {
            app_number: data.creditApplicationName || null,
            record_id:  data.recordID || null,
            result:     `Successfully created credit application ${data.creditApplicationName || ''}`.trim()
        }
    };
}

router.post('/', async (req, res) => {
    try {
        const { channel, payload } = req.body;
        const navitasToken = req.headers['x-navitas-token'];

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

        if (!navitasToken) {
            return res.status(400).json({
                error: 'Missing Navitas token',
                message: 'X-Navitas-Token header is required'
            });
        }

        // ─── Direct → SF home org ───
        if (channel === 'Direct') {
            if (!process.env.SF_CREDITAPP_URL) {
                return res.status(503).json({
                    error: 'Service not configured',
                    message: 'SF_CREDITAPP_URL is not set on the server'
                });
            }
        }

        // ─── Check config ───
        else if (!navitas.isConfigured()) {
            return res.status(503).json({
                error: 'Service not configured',
                message: 'Navitas API credentials are not set on the server'
            });
        }

        // ─── Forward to Navitas ───
        const path = channel === 'Direct' ? process.env.SF_CREDITAPP_URL : INDIRECT_PATH;
        console.log(`\u2550\u2550\u2550 SUBMITTING ${channel.toUpperCase()} APPLICATION \u2550\u2550\u2550`);
        console.log('Navitas path:', path);
        console.log('Payload:', JSON.stringify(payload, null, 2));
        console.log('\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550');

        const result = channel === 'Direct'
            ? await submitDirect(payload, navitasToken)
            : await navitas.post(path, payload, navitasToken);

        console.log(`Submission successful: HTTP ${result.status}`);
        console.log('Navitas response:', JSON.stringify(result.data, null, 2));

        // Extract app number — Navitas may return it under different keys
        const responseData = result.data || {};
        const appNumber = responseData.app_number
            || responseData.app_id
            || responseData.appNumber
            || null;

        if (appNumber) {
            console.log('App number extracted:', appNumber);
        } else {
            console.warn('No app number found in Navitas response. Keys:', Object.keys(responseData));
        }

        res.json({
            success: true,
            status: result.status,
            appNumber: appNumber,
            data: result.data
        });

    } catch (err) {
        console.error('\u2550\u2550\u2550 SUBMISSION ERROR \u2550\u2550\u2550');
        console.error('Message:', err.message);
        console.error('Status:', err.status);
        console.error('Navitas response:', JSON.stringify(err.data, null, 2));
        console.error('\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550');

        // Pass through Navitas error fields when available
        const navitasData = err.data || {};
        res.status(err.status || 500).json({
            success: false,
            error: navitasData.error || 'Submission failed',
            message: navitasData.message || err.message,
            explanation: navitasData.explanation || null,
            details: navitasData.details || null
        });
    }
});

module.exports = router;
