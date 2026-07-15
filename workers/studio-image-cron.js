const CHECK_URLS = [
    'https://design-request-dingtalk.pages.dev/api/studio-check-overdue?rpaOnly=1',
    'https://design-request-dingtalk.pages.dev/api/studio-check-overdue?imageOnly=1'
];

export default {
    async scheduled(_controller, _env, ctx) {
        ctx.waitUntil(runImageCheck());
    },

    async fetch() {
        return runImageCheck();
    }
};

async function runImageCheck() {
    const results = [];
    let status = 200;

    for (const url of CHECK_URLS) {
        try {
            const response = await fetch(url, {
                headers: { 'User-Agent': 'design-request-auto-cron/2.0' }
            });
            const body = await response.text();
            status = Math.max(status, response.status);
            results.push({ url, status: response.status, body: parseBody(body) });
        } catch (error) {
            status = 502;
            results.push({ url, status: 502, body: { ok: false, error: String(error?.message || error) } });
        }
    }

    return new Response(JSON.stringify({ ok: status < 400, results }), {
        status,
        headers: { 'Content-Type': 'application/json; charset=utf-8' }
    });
}

function parseBody(body) {
    try {
        return JSON.parse(body);
    } catch {
        return { raw: body.slice(0, 500) };
    }
}
