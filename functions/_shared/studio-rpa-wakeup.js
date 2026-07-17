export function wakeStudioRpaQueue(request, waitUntil) {
    const origin = new URL(request.url).origin;
    const wake = fetch(`${origin}/api/studio-check-overdue?rpaOnly=1`, {
        headers: { 'User-Agent': 'design-request-result-wakeup/1.0' }
    }).then(async response => {
        if (!response.ok) throw new Error(`HTTP ${response.status}: ${(await response.text()).slice(0, 200)}`);
    }).catch(error => {
        console.error('Wake next RPA task failed:', error.message);
    });
    if (waitUntil) waitUntil(wake);
    return wake;
}
