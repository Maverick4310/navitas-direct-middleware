/**
 * OCR Prefill Route
 *
 * POST /api/ocr  — read a credit application / vendor invoice / email body
 *      and return prefill JSON for the Navitas Connect wizard.
 *
 *      Proxies to the Navitas credit-app OCR service (creditapp-ocr-dev),
 *      the same service the home org's navitasCreditApp OCR modal uses.
 *      Partner orgs never hold the OCR service token: they authenticate
 *      here with their partner key (X-Api-Key, checked by authMiddleware),
 *      and this route adds the shared token on the way out.
 *
 *      Body (passed through unchanged):
 *        { creditApp: { media_type, data } | null,
 *          invoice:   { media_type, data } | null,
 *          emailText: string, instructions: string }
 *
 *      200  { ok: true,  data: { customer, guarantors, corpGuarantors,
 *                                contacts, assets, vendorHint, term,
 *                                dealStory, flags } }
 *      4xx/5xx { ok: false, error }
 *
 * Required env vars (Render):
 *   OCR_SERVICE_URL   — e.g. https://creditapp-ocr-dev.onrender.com
 *   OCR_SHARED_TOKEN  — the OCR service's SHARED_TOKEN (sent as X-Navitas-Token)
 *
 * Documents carry SSNs and tax IDs: only sizes and outcomes are logged here,
 * never the request or response body.
 */

const express = require('express');
const router = express.Router();

// Apex callouts time out at 120s; answer before the partner org gives up.
const OCR_TIMEOUT_MS = 115000;

// Top-level keys of a valid extraction.
const EXTRACTION_KEYS = ['customer', 'guarantors', 'corpGuarantors', 'contacts', 'assets', 'vendorHint', 'flags'];

/**
 * The model occasionally wraps its tool input one level deep under an
 * invented key ({ "parameter name": { customer, ... } }). Accept the top
 * level, or unwrap exactly one level matched by shape, never by key name.
 * Returns null when neither level looks like an extraction.
 */
function normalizeExtraction(raw) {
    const isObj = v => v && typeof v === 'object' && !Array.isArray(v);
    const hasKnown = o => isObj(o) && EXTRACTION_KEYS.some(k => k in o);

    if (hasKnown(raw)) return raw;
    if (isObj(raw)) {
        const keys = Object.keys(raw);
        if (keys.length === 1 && hasKnown(raw[keys[0]])) return raw[keys[0]];
    }
    return null;
}

function describeFile(f) {
    if (!f || !f.data) return 'none';
    return `${f.media_type || '?'} (${Math.round(f.data.length * 3 / 4 / 1024)} KB)`;
}

router.post('/', async (req, res) => {
    const baseUrl = (process.env.OCR_SERVICE_URL || '').trim().replace(/\/+$/, '');
    if (!baseUrl) {
        console.error('OCR_SERVICE_URL is not configured');
        return res.status(503).json({
            ok: false,
            error: 'Document scanning is not configured on the server.'
        });
    }

    const { creditApp, invoice, emailText, instructions } = req.body || {};
    if (!creditApp && !invoice && !(emailText && String(emailText).trim())) {
        return res.status(400).json({
            ok: false,
            error: 'Add a credit application, an invoice, or an email before scanning.'
        });
    }

    const partner = String(req.headers['x-api-key'] || '').substring(0, 8);
    console.log('═══ OCR PREFILL ═══');
    console.log('Partner key :', `${partner}...`);
    console.log('Credit app  :', describeFile(creditApp));
    console.log('Invoice     :', describeFile(invoice));
    console.log('Email chars :', emailText ? String(emailText).length : 0);
    console.log('═══════════════════');

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), OCR_TIMEOUT_MS);

    try {
        const headers = {
            'Content-Type': 'application/json',
            'Accept':       'application/json',
            'User-Agent':   'NavitasDirectMiddleware/1.0'
        };
        if (process.env.OCR_SHARED_TOKEN) {
            headers['X-Navitas-Token'] = process.env.OCR_SHARED_TOKEN;
        }

        const response = await fetch(`${baseUrl}/ocr`, {
            method: 'POST',
            headers,
            body: JSON.stringify({
                creditApp:    creditApp || null,
                invoice:      invoice || null,
                emailText:    emailText || '',
                instructions: instructions || ''
            }),
            signal: controller.signal
        });

        const text = await response.text();
        let parsed;
        try { parsed = text ? JSON.parse(text) : {}; } catch (e) { parsed = {}; }

        if (!response.ok || parsed.ok !== true) {
            console.warn(`OCR service returned HTTP ${response.status}`);
            const status = response.status === 401 ? 502 : (response.status >= 400 ? response.status : 502);
            return res.status(status).json({
                ok: false,
                error: parsed.error || 'The document could not be read. Please retry.'
            });
        }

        const data = normalizeExtraction(parsed.data);
        if (!data) {
            console.warn('OCR service returned an unrecognizable extraction shape');
            return res.status(502).json({
                ok: false,
                error: 'The document was read, but the result came back in an unexpected shape. Please retry.'
            });
        }

        console.log('OCR prefill: success');
        return res.json({ ok: true, data });

    } catch (error) {
        const timedOut = error.name === 'AbortError';
        console.error('OCR proxy error:', timedOut ? 'timeout' : error.message);
        return res.status(timedOut ? 504 : 502).json({
            ok: false,
            error: timedOut
                ? 'Reading the document took too long. Try a smaller file or fewer pages.'
                : 'Could not reach the document scanning service. Please retry.'
        });
    } finally {
        clearTimeout(timer);
    }
});

module.exports = router;
