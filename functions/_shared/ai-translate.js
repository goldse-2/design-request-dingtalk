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

export async function translateProgramFieldsForRpa(env, fields) {
    const original = {
        productName: cleanField(fields?.productName),
        title: cleanField(fields?.title),
        subtitle: cleanField(fields?.subtitle),
        otherText: cleanField(fields?.otherText)
    };
    if (!Object.values(original).some(value => /\p{Script=Han}/u.test(value))) return original;
    if (!env?.AI_API_KEY) throw new Error('程序模式英文翻译未配置');

    try {
        const raw = await generateAiText(env, {
            system: 'Translate the values in the provided JSON object into concise, natural English for an image-generation workflow. Keep the JSON keys exactly as productName, title, subtitle, and otherText. Preserve product model numbers, quantities, punctuation separators, and literal text. A value containing only "-" must remain "-". Return only one valid JSON object with string values, without Markdown or explanation.',
            user: JSON.stringify(original),
            temperature: 0.1,
            maxTokens: 1000,
            timeoutMs: 35000
        });
        const translated = parseTranslatedFields(raw);
        if (!translated || Object.values(translated).some(value => /\p{Script=Han}/u.test(value))) {
            throw new Error('英文翻译结果无效');
        }
        return translated;
    } catch (error) {
        console.error('Program RPA translation failed:', error?.name === 'AbortError' ? 'timeout' : String(error?.message || error));
        throw new Error('程序模式英文翻译失败，请稍后重试');
    }
}

export function taskNeedsRpaTranslation(task) {
    const userText = [task?.desc, task?.want, task?.note, task?.scene, task?.productName, task?.title, task?.subtitle, task?.otherText]
        .filter(Boolean)
        .join(' ');
    return /\p{Script=Han}/u.test(userText);
}

function parseTranslatedFields(value) {
    const text = String(value || '').replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
    let parsed;
    try { parsed = JSON.parse(text); }
    catch {
        const match = text.match(/\{[\s\S]*\}/);
        if (!match) return null;
        try { parsed = JSON.parse(match[0]); }
        catch { return null; }
    }
    if (!parsed || typeof parsed !== 'object') return null;
    return {
        productName: cleanField(parsed.productName),
        title: cleanField(parsed.title),
        subtitle: cleanField(parsed.subtitle),
        otherText: cleanField(parsed.otherText)
    };
}

function cleanField(value) {
    return String(value || '-').replace(/[\r\n]+/g, ' ').replace(/\s{2,}/g, ' ').trim().slice(0, 500) || '-';
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
