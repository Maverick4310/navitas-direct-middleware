/**
 * Prefill Route
 *
 * Proxies application prefill requests from partner Salesforce orgs
 * to the Navitas home org REST endpoint. Auth header is forwarded
 * transparently — same pattern as document.js.
 *
 * GET /api/prefill?lwAppId={lw_app_id}
 *
 * Auth:
 *   Inbound  — X-Api-Key header (Adoption_Api_Key__c from partner config)
 *   Outbound — same X-Api-Key header forwarded to home org
 *              Home org validates against API_Rest_Credential__mdt
 *              (Type_of_Integration__c = 'Partner Dashboard')
 *
 * Required env vars:
 *   SF_HOME_ORG_PREFILL_URL — Full REST endpoint URL, e.g.:
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

        // ── 2. Forward inbound X-Api-Key to home org ──────────────────
        // CreditAppPrefillService sends Adoption_Api_Key__c as X-Api-Key.
        // NavitasApplicationPrefillResource validates it against
        // API_Rest_Credential__mdt.Client_Secret__c — Render is transparent.
        const apiKey = req.headers['x-api-key'];

        if (!apiKey) {
            return res.status(401).json({
                success: false,
                error: 'X-Api-Key header is required.'
            });
        }

        // ── 3. Resolve home org URL ───────────────────────────────────
        const homeOrgUrl = (process.env.SF_HOME_ORG_PREFILL_URL || '').replace(/\/+$/, '');

        if (!homeOrgUrl) {
            console.error('SF_HOME_ORG_PREFILL_URL env var is not configured');
            return res.status(500).json({
                success: false,
                error: 'Prefill service is not configured on the server.'
            });
        }

        // ── 4. Forward to home org ────────────────────────────────────
        const url = `${homeOrgUrl}?lwAppId=${encodeURIComponent(lwAppId.trim())}`;

        console.log('═══ NAVITAS PREFILL REQUEST ═══');
        console.log('App ID:  ', lwAppId.trim());
        console.log('Home org:', url);
        console.log('═══════════════════════════════');

        const sfResponse = await fetch(url, {
            method: 'GET',
            headers: {
                'Accept':     'application/json',
                'X-Api-Key':  apiKey,
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
