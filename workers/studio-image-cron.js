const IMAGE_CHECK_URL = 'https://design-request-dingtalk.pages.dev/api/studio-check-overdue?imageOnly=1';

export default {
    async scheduled(_controller, _env, ctx) {
        ctx.waitUntil(runImageCheck());
    },

    async fetch() {
        return runImageCheck();
    }
};

async function runImageCheck() {
    const response = await fetch(IMAGE_CHECK_URL, {
        headers: { 'User-Agent': 'design-request-image-cron/1.0' }
    });
    const body = await response.text();
    return new Response(body, {
        status: response.status,
        headers: { 'Content-Type': 'application/json; charset=utf-8' }
    });
}
