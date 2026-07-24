export async function composePdfImage({ PDFDocument, pdfBytes, imageBytes, imageType, targetPage, placement }) {
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

    page.drawImage(embeddedImage, {
        x: xRatio * pageWidth,
        y: pageHeight - ((yRatio + heightRatio) * pageHeight),
        width: widthRatio * pageWidth,
        height: heightRatio * pageHeight,
        opacity: clampUnit(placement.opacity ?? 1)
    });
    return document.save({ useObjectStreams: true });
}

function clampUnit(value) {
    return clamp(Number(value) || 0, 0, 1);
}

function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
}
