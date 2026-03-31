/**
 * Prefill Route
 *
 * Calls the LW LoadApp API directly and maps the response to the
 * prefill shape expected by navitasCreditAppSubmission LWC.
 *
 * This route exists because Salesforce Sites guest user context
 * cannot make outbound HTTP callouts — the same constraint that
 * drove document fetch and upload through Render.
 *
 * GET /api/prefill?lwAppId={lw_app_id}
 *
 * Auth:
 *   Inbound — X-Api-Key header validated by authMiddleware against
 *             PARTNER_API_KEYS env var (same as /api/submit).
 *
 * Required env vars:
 *   LW_BASE_URL    — LW REST endpoint base, e.g. https://yourorg.lwapprestjsonex.ashx
 *   LW_AUTH_KEY    — BASIC auth key for LW
 *   LW_CLIENT_CD   — LW ClientCd
 *
 * Success Response (HTTP 200):
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
 *   500  { success: false, error: "..." }
 *   502  { success: false, error: "LW returned an error: ..." }
 */

const express = require('express');
const router  = express.Router();

// ─── LW company type codes → submission form picklist labels ─────────────
const COMPANY_TYPE_MAP = {
    SP: 'Sole Proprietorship',
    PT: 'Partnership',
    LC: 'LLC',
    C:  'Corporation',
    CP: 'Corporation'
};

// ─────────────────────────────────────────────────────────────────────────
//  GET /api/prefill?lwAppId={lw_app_id}
// ─────────────────────────────────────────────────────────────────────────

router.get('/', async (req, res) => {
    try {

        // ── 1. Validate input ─────────────────────────────────────────
        const { lwAppId } = req.query;

        if (!lwAppId || !lwAppId.trim()) {
            return res.status(400).json({
                success: false,
                error: 'lwAppId query parameter is required.'
            });
        }

        // ── 2. Validate LW config ─────────────────────────────────────
        const lwBaseUrl  = (process.env.LW_BASE_URL  || '').replace(/\/+$/, '');
        const lwAuthKey  = process.env.LW_AUTH_KEY  || '';
        const lwClientCd = process.env.LW_CLIENT_CD || '';

        if (!lwBaseUrl || !lwAuthKey || !lwClientCd) {
            console.error('LW env vars not fully configured (LW_BASE_URL, LW_AUTH_KEY, LW_CLIENT_CD)');
            return res.status(500).json({
                success: false,
                error: 'Prefill service is not configured on the server.'
            });
        }

        // ── 3. Call LW LoadApp ────────────────────────────────────────
        const lwBody = `RID=LoadApp&APPID=${encodeURIComponent(lwAppId.trim())}&webFlag=N`;

        console.log('═══ NAVITAS PREFILL REQUEST ═══');
        console.log('App ID:', lwAppId.trim());
        console.log('LW URL:', lwBaseUrl);
        console.log('═══════════════════════════════');

        const lwResponse = await fetch(lwBaseUrl, {
            method: 'POST',
            headers: {
                'Authorization': `Basic ${lwAuthKey}`,
                'Content-Type':  'application/x-www-form-urlencoded',
                'Accept':        'application/json',
                'User-Agent':    'NavitasDirectMiddleware/1.0'
            },
            body: lwBody
        });

        if (!lwResponse.ok) {
            console.error(`LW HTTP error: ${lwResponse.status}`);
            return res.status(502).json({
                success: false,
                error: `LW returned HTTP ${lwResponse.status}`
            });
        }

        const lwData = await lwResponse.json();

        console.log('LW response status:', lwData.Status);

        // ── 4. Check LW error array ───────────────────────────────────
        const lwErrors = (lwData.Error || []).map(e => e.ErrorMsg).filter(Boolean).join(' ');
        if (lwErrors) {
            console.warn('LW error:', lwErrors);
            return res.status(502).json({
                success: false,
                error: `LW returned an error: ${lwErrors}`
            });
        }

        if (lwData.Status !== 'SUCCESS') {
            return res.status(502).json({
                success: false,
                error: `LW returned status: ${lwData.Status}`
            });
        }

        const dataList = lwData.Data || [];
        if (!dataList.length) {
            return res.status(404).json({
                success: false,
                error: `No application data found for App ID: ${lwAppId}`
            });
        }

        // ── 5. Map LW response → prefill shape ────────────────────────
        const prefill = mapToPrefill(dataList[0]);

        console.log('Prefill mapped successfully for App ID:', lwAppId.trim());

        return res.status(200).json({
            success: true,
            data: prefill
        });

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

// ─────────────────────────────────────────────────────────────────────────
//  Mapper — LW LoadApp Data[0] → prefill shape
//  Field names on the output object match navitasCreditAppSubmission
//  LWC internal form keys exactly.
//  SSN and DateOfBirth are intentionally excluded.
// ─────────────────────────────────────────────────────────────────────────

function mapToPrefill(d) {
    const c = d.custApp || {};

    return {
        customer: {
            name:                clean(c.CustNm),
            phone:               cleanPhone(c.BillingPhone),
            federal_tax_id:      cleanEin(c.FedTaxId),
            doing_business_as:   clean(c.DoingBusAsNm),
            company_type:        mapCompanyType(c.FormOfBusCd),
            number_of_employees: clean(c.NumberOfEmployee),
            years_in_business:   clean(c.YearsInBus),
            street:              clean(c.BillingStr1),
            city:                clean(c.BillingCity),
            state:               clean(c.BillingState),
            zip:                 cleanZip(c.BillingZip)
            // SSN intentionally excluded
        },

        contact: {
            name:  clean(c.BillingContactNm),
            phone: cleanPhone(c.BillingContactPhone),
            email: clean(c.BillingEmail)
        },

        // SSN and DateOfBirth intentionally excluded from all guarantors
        guarantors: (d.guarantor || []).map(g => ({
            firstName: clean(g.FirstName),
            lastName:  clean(g.LastName),
            street:    buildStreet(g.StreetNumber, g.StreetName, g.StreetType, g.SuiteNumber),
            city:      clean(g.City),
            state:     clean(g.State),
            zip:       cleanZip(g.Zip),
            phone:     cleanPhone(g.s1stPriorPhn || g.PhoneNum),
            email:     clean(g.s1stPriorEmail || g.EmailAddr)
        })),

        assets: (d.asset || []).map(a => ({
            description:   clean(a.AssetDesc),
            cost:          cleanDecimal(a.AssetCost),
            streetaddress: clean(a.AssetStr1),   // note: no underscore — matches LWC field key
            city:          clean(a.AssetCity),
            state:         clean(a.AssetState),
            zip:           cleanZip(a.AssetZip)
        })),

        corpGuarantors: (d.corpguarantor || []).map(cg => ({
            name:   clean(cg.CorpName),
            street: clean(cg.Street1),
            city:   clean(cg.City),
            state:  clean(cg.State),
            zip:    cleanZip(cg.Zip),
            phone:  cleanPhone(cg.PhoneNum),
            email:  clean(cg.EmailAddr)
        }))
    };
}

// ─────────────────────────────────────────────────────────────────────────
//  Helpers
// ─────────────────────────────────────────────────────────────────────────

/** Trims and converts LW sentinel '0' to empty string. */
function clean(val) {
    if (val == null) return '';
    const s = String(val).trim();
    return (s === '0' || s === '0.00') ? '' : s;
}

/** Strips non-digits, returns empty if not exactly 10 digits. */
function cleanPhone(val) {
    if (!val) return '';
    const digits = String(val).replace(/[^0-9]/g, '');
    return digits.length === 10 ? digits : '';
}

/** Strips non-digits from EIN, returns empty for all-zero values. */
function cleanEin(val) {
    if (!val) return '';
    const digits = String(val).replace(/[^0-9]/g, '');
    return (digits === '000000000' || digits === '0') ? '' : digits;
}

/** Returns first 5 digits of zip code. */
function cleanZip(val) {
    if (!val) return '';
    const digits = String(val).replace(/[^0-9]/g, '');
    return digits.length >= 5 ? digits.substring(0, 5) : digits;
}

/** Formats decimal cost — returns empty string for zero values. */
function cleanDecimal(val) {
    if (!val) return '';
    const n = parseFloat(String(val).trim());
    if (isNaN(n) || n === 0) return '';
    return n.toFixed(2);
}

/** Concatenates LW street components into a single address string. */
function buildStreet(num, name, type, suite) {
    return [num, name, type, suite]
        .map(p => (p || '').trim())
        .filter(Boolean)
        .join(' ');
}

/** Maps LW FormOfBusCd to the submission form's company_type picklist value. */
function mapCompanyType(code) {
    if (!code) return null;
    return COMPANY_TYPE_MAP[String(code).trim().toUpperCase()] || null;
}

module.exports = router;
