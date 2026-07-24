export async function composePdfImage({ PDFDocument, BlendMode, pdfBytes, imageBytes, imageType, targetPage, placement, blendMode = 'normal' }) {
    if (!PDFDocument || !pdfBytes || !imageBytes || !placement) {
        throw new Error('PDF 合成参数不完整');
    }
    const document = await PDFDocument.load(pdfBytes.slice());
    const page = document.getPages()[Number(targetPage) - 1];
    if (!page) throw new Error('所选 PDF 页面不存在');

    const embeddedImage = imageType === 'image/jpeg'
        ? await document.embedJpg(imageBytes)
        : await document.embedPng(imageBytes);
    const { width: pageWidth, height: pageHeight } = page.getSize();
    const widthRatio = clampUnit(placement.width);
    const heightRatio = clampUnit(placement.height);
    const xRatio = clamp(Number(placement.x) || 0, 0, 1 - widthRatio);
    const yRatio = clamp(Number(placement.y) || 0, 0, 1 - heightRatio);

    const drawOptions = {
        x: xRatio * pageWidth,
        y: pageHeight - ((yRatio + heightRatio) * pageHeight),
        width: widthRatio * pageWidth,
        height: heightRatio * pageHeight,
        opacity: clampUnit(placement.opacity ?? 1)
    };
    if (blendMode === 'multiply') drawOptions.blendMode = BlendMode?.Multiply || 'Multiply';
    page.drawImage(embeddedImage, drawOptions);
    return document.save({ useObjectStreams: true });
}

export async function composePageImagesPdf({ PDFDocument, pages }) {
    if (!PDFDocument || !Array.isArray(pages) || !pages.length) {
        throw new Error('文档合成参数不完整');
    }
    const document = await PDFDocument.create();
    for (const source of pages) {
        const width = Math.max(1, Number(source.width) || 1);
        const height = Math.max(1, Number(source.height) || 1);
        const page = document.addPage([width, height]);
        const image = source.type === 'image/png'
            ? await document.embedPng(source.bytes)
            : await document.embedJpg(source.bytes);
        page.drawImage(image, { x: 0, y: 0, width, height });
    }
    return document.save({ useObjectStreams: true });
}

function clampUnit(value) {
    return clamp(Number(value) || 0, 0, 1);
}

function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
}
