export async function onRequestGet(context) {
    const { env } = context;
    if (!env.SUBMISSION_FILES) {
        return Response.json({ ok: false, error: 'R2 not configured' }, { status: 500 });
    }
    try {
        const list = await env.SUBMISSION_FILES.list({ prefix: 'library/' });
        const categories = {};

        for (const obj of list.objects) {
            const rel = obj.key.replace('library/', '');
            const parts = rel.split('/');

            let category, product, fileName;
            if (parts.length >= 3) {
                category = decodeURIComponent(parts[0]);
                product = decodeURIComponent(parts[1]);
                fileName = decodeURIComponent(parts.slice(2).join('/'));
            } else if (parts.length === 2) {
                category = '未分类';
                product = decodeURIComponent(parts[0]);
                fileName = decodeURIComponent(parts[1]);
            } else {
                continue;
            }

            if (!categories[category]) categories[category] = {};
            if (!categories[category][product]) categories[category][product] = [];
            categories[category][product].push({
                key: obj.key,
                name: fileName,
                size: obj.size,
                version: obj.etag || (obj.uploaded ? new Date(obj.uploaded).getTime() : obj.size)
            });
        }

        for (const cat of Object.values(categories)) {
            for (const files of Object.values(cat)) {
                files.sort((a, b) => a.name.localeCompare(b.name));
            }
        }

        return Response.json({ ok: true, categories });
    } catch (err) {
        return Response.json({ ok: false, error: err.message }, { status: 500 });
    }
}
