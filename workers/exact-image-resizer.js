const MAX_IMAGE_BYTES = 20 * 1024 * 1024;

export default {
    async fetch(request, env) {
        if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 });
        if (!env.IMAGES?.input || !env.IMAGES?.info) {
            return new Response('Images binding not configured', { status: 500 });
        }

        const url = new URL(request.url);
        const width = Number.parseInt(url.searchParams.get('width'), 10);
        const height = Number.parseInt(url.searchParams.get('height'), 10);
        const gravity = normalizeGravity(url.searchParams.get('gravity'));
        if (!isValidDimension(width) || !isValidDimension(height)) {
            return new Response('Invalid target dimensions', { status: 400 });
        }

        const contentLength = Number(request.headers.get('Content-Length') || 0);
        if (contentLength > MAX_IMAGE_BYTES) return new Response('Image is too large', { status: 413 });
        if (!request.body) return new Response('Image body is required', { status: 400 });

        const transformed = await env.IMAGES
            .input(request.body)
            .transform({ width, height, fit: 'cover', ...(gravity ? { gravity } : {}) })
            .output({ format: 'image/jpeg', quality: 95 });
        const response = transformed.response();
        if (!response.ok) return new Response('Image resize failed', { status: 502 });

        const bytes = await response.arrayBuffer();
        const info = await env.IMAGES.info(new Blob([bytes], { type: 'image/jpeg' }).stream());
        if (info.width !== width || info.height !== height) {
            return new Response('Image dimensions do not match target', { status: 502 });
        }

        return new Response(bytes, {
            headers: {
                'Content-Type': 'image/jpeg',
                'X-Image-Width': String(info.width),
                'X-Image-Height': String(info.height)
            }
        });
    }
};

function isValidDimension(value) {
    return Number.isInteger(value) && value >= 100 && value <= 5000;
}

function normalizeGravity(value) {
    return ['top', 'bottom'].includes(String(value || '').toLowerCase())
        ? String(value).toLowerCase()
        : '';
}
