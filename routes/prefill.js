/**
 * Prefill Route
 *
 * Proxies application prefill requests from partner Salesforce orgs
 * to the Navitas home org Sites REST endpoint. Auth is handled entirely
 * by the home org via clientId query param — Render is a transparent proxy.
 *
 * GET /api/prefill?lwAppId={lw_app_id}
 *
 * Auth:
 *   Inbound  — none (no authMiddleware — home org handles auth)
 *   Outbound — clientId appended as query param from SF_PREFILL_CLIENT_ID
 *              env var. Home org validates against API_Rest_Credential__mdt.
 *
 * Required env vars:
 *   SF_HOME_ORG_PREFILL_URL — Sites URL to NavitasApplicationPrefillResource, e.g.:
 *                             https://navitascredit.my.salesforce-sites.com/onboarding/services/apexrest/navitas/seller-app-prefill
 *                             (no trailing slash, no query params)
 *   SF_PREFILL_CLIENT_ID    — Client_Id__c value from API_Rest_Credential__mdt
 *                             Partner Dashboard record (e.g. 28548)
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

        // ── 2. Resolve home org URL and clientId ──────────────────────
        const homeOrgUrl = (process.env.SF_HOME_ORG_PREFILL_URL || '').replace(/\/+$/, '');
        const clientId   = process.env.SF_PREFILL_CLIENT_ID || '';

        if (!homeOrgUrl) {
            console.error('SF_HOME_ORG_PREFILL_URL env var is not configured');
            return res.status(500).json({
                success: false,
                error: 'Prefill service is not configured on the server.'
            });
        }

        if (!clientId) {
            console.error('SF_PREFILL_CLIENT_ID env var is not configured');
            return res.status(500).json({
                success: false,
                error: 'Prefill service is not configured on the server.'
            });
        }

        // ── 3. Forward to home org ────────────────────────────────────
        // clientId authenticates with NavitasApplicationPrefillResource
        // via API_Rest_Credential__mdt — Sites strips headers so auth
        // must go via query param, same pattern as seller-deals.
        const url = `${homeOrgUrl}?clientId=${encodeURIComponent(clientId)}&lwAppId=${encodeURIComponent(lwAppId.trim())}`;

        console.log('═══ NAVITAS PREFILL REQUEST ═══');
        console.log('App ID:   ', lwAppId.trim());
        console.log('Home org:', url);
        console.log('═══════════════════════════════');

        const sfResponse = await fetch(url, {
            method: 'GET',
            headers: {
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
