const DEFAULT_API_BASE = 'https://jojocode.com';
const DEFAULT_MODEL = 'claude-opus-4-7';

const RPA_TRANSLATION_PROMPT = [
    'Translate the supplied Chinese image-generation instruction into natural, accurate English.',
    'Preserve every URL, filename, product or brand name, number, unit, dimension, task ID, and @ reference exactly.',
    'Do not add, remove, improve, summarize, or explain any requirement.',
    'Return only the translated instruction, without a title, quotes, or Markdown.'
].join(' ');

export async function translateForRpa(env, text) {
    const original = String(text || '').trim();
    if (!original || !env?.AI_API_KEY) return original;

    const protectedInput = protectExactValues(original);

    const apiBase = String(env.AI_API_BASE || DEFAULT_API_BASE).replace(/\/+$/, '');
    const model = String(env.AI_TEXT_MODEL || DEFAULT_MODEL);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 45000);

    try {
        const response = await fetch(`${apiBase}/v1/chat/completions`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${env.AI_API_KEY}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                model,
                temperature: 0.1,
                max_tokens: 10000,
                messages: [
                    { role: 'system', content: RPA_TRANSLATION_PROMPT },
                    { role: 'user', content: protectedInput.text }
                ]
            }),
            signal: controller.signal
        });

        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
            console.error('RPA translation upstream error:', response.status, data?.error?.message || data?.message || '');
            return original;
        }

        const translated = extractText(data).trim();
        return translated ? protectedInput.restore(translated) : original;
    } catch (error) {
        console.error('RPA translation failed:', error?.name === 'AbortError' ? 'timeout' : String(error?.message || error));
        return original;
    } finally {
        clearTimeout(timeout);
    }
}

function protectExactValues(text) {
    const values = [];
    const protectedText = text.replace(
        /https?:\/\/[^\s]+|\b\d{3,5}\s*[xX×*]\s*\d{3,5}(?:px)?\b|@[\p{L}\p{N}_-]+|"[^"\r\n]+"/gu,
        value => {
            const token = `__RPA_EXACT_${values.length}__`;
            values.push({ token, value });
            return token;
        }
    );

    return {
        text: protectedText,
        restore(translated) {
            if (values.some(({ token }) => !translated.includes(token))) return text;
            return values.reduce((result, { token, value }) => result.replaceAll(token, value), translated);
        }
    };
}

function extractText(data) {
    const content = data?.choices?.[0]?.message?.content;
    if (typeof content === 'string') return content;
    if (Array.isArray(content)) {
        return content.map(part => part?.text || part?.content || '').join('');
    }
    return '';
}
