/**
 * Prefill Route
 *
 * Proxies application prefill requests from partner Salesforce orgs
 * to the Navitas home org REST endpoint, which calls LW LoadApp
 * and returns a mapped prefill payload.
 *
 * This route exists because Salesforce Sites guest user context cannot
 * make outbound HTTP callouts — the same constraint that drove document
 * fetch and upload through Render. The home org endpoint is deployed as
 * a standard authenticated REST resource (not under a Site), so Render
 * can reach it directly.
 *
 * GET /api/prefill?lwAppId={lw_app_id}
 *
 * Auth:
 *   Inbound  — X-Api-Key validated by authMiddleware against PARTNER_API_KEYS.
 *   Outbound — X-Api-Key forwarded as-is to the home org, which validates it
 *              against API_Rest_Credential__mdt (same as document route).
 *
 * Required env vars:
 *   SF_HOME_ORG_PREFILL_URL — Full URL to NavitasApplicationPrefillResource, e.g.:
 *                             https://navitascredit.my.salesforce.com/services/apexrest/navitas/seller-app-prefill
 *                             (no trailing slash, no query params)
 *
 * Success Response (HTTP 200) — mirrors NavitasApplicationPrefillResource:
 *   {
 *     "success": true,
 *     "data": {
 *       "customer":       { name, phone, federal_tax_id, doing_business_as,
 *                           company_type, number_of_employees, years_in_business,
 *                           street, city, state, zip },
 *       "contact":        { name, phone, email },
 *       "guarantors":     [ { firstName, lastName, street, city, state, zip, phone, email } ],
 *       "assets":         [ { description, cost, streetaddress, city, state, zip } ],
 *       "corpGuarantors": [ { name, street, city, state, zip, phone, email } ]
 *     }
 *   }
 *
 * Error Responses:
 *   400  { success: false, error: "lwAppId query parameter is required." }
 *   401  { success: false, error: "..." }   — forwarded from home org
 *   404  { success: false, error: "..." }   — forwarded from home org
 *   500  { success: false, error: "..." }
 *   502  { success: false, error: "..." }   — forwarded from home org
 */

const express = require('express');
const router  = express.Router();

// ─────────────────────────────────────────────────────────────────────
//  GET /api/prefill?lwAppId={lw_app_id}
// ─────────────────────────────────────────────────────────────────────

router.get('/', async (req, res) => {
    try {

        // ── 1. Validate lwAppId ───────────────────────────────────────
        const { lwAppId } = req.query;

        if (!lwAppId || !lwAppId.trim()) {
            return res.status(400).json({
                success: false,
                error: 'lwAppId query parameter is required.'
            });
        }

        // ── 2. Resolve home org URL ───────────────────────────────────
        const homeOrgUrl = (process.env.SF_HOME_ORG_PREFILL_URL || '').replace(/\/+$/, '');

        if (!homeOrgUrl) {
            console.error('SF_HOME_ORG_PREFILL_URL env var is not configured');
            return res.status(500).json({
                success: false,
                error: 'Prefill service is not configured on the server.'
            });
        }

        // ── 3. Forward to home org ────────────────────────────────────
        // X-Api-Key forwarded as-is — home org validates against
        // API_Rest_Credential__mdt.Client_Id__c, same as document route.
        const url = `${homeOrgUrl}?lwAppId=${encodeURIComponent(lwAppId.trim())}`;

        console.log('═══ NAVITAS PREFILL REQUEST ═══');
        console.log('App ID:',    lwAppId.trim());
        console.log('Home org:', url);
        console.log('X-Api-Key:', req.headers['x-api-key']
            ? req.headers['x-api-key'].substring(0, 8) + '...'
            : 'MISSING');
        console.log('═══════════════════════════════');

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
            body = {
                success: false,
                error: `Unexpected response from home org: ${text.substring(0, 200)}`
            };
        }

        console.log(`Home org prefill response: HTTP ${sfResponse.status}`);

        if (!sfResponse.ok) {
            console.warn('Home org prefill error:', JSON.stringify(body));
        }

        // Mirror the home org status code and body back to the partner org
        return res.status(sfResponse.status).json(body);

    } catch (err) {
        console.error('═══ PREFILL ROUTE ERROR ═══');
        console.error('Message:', err.message);
        console.error('Stack:',   err.stack);
        console.error('═══════════════════════════');

        return res.status(500).json({
            success: false,
            error: 'Prefill service encountered an unexpected error: ' + err.message
        });
    }
});

module.exports = router;
