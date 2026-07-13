import { generateAiText } from './ai-text.js';

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

    try {
        const translated = await generateAiText(env, {
            system: RPA_TRANSLATION_PROMPT,
            user: protectedInput.text,
            temperature: 0.1,
            maxTokens: 10000
        });
        return translated ? protectedInput.restore(translated) : original;
    } catch (error) {
        console.error('RPA translation failed:', error?.name === 'AbortError' ? 'timeout' : String(error?.message || error));
        return original;
    }
}

export function taskNeedsRpaTranslation(task) {
    const userText = [task?.desc, task?.want, task?.note, task?.scene]
        .filter(Boolean)
        .join(' ');
    return /\p{Script=Han}/u.test(userText);
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
