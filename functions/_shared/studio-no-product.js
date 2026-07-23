export function createProgramRpaParams({ task, productName, title, subtitle, otherText, referenceUrl, productUrls, sizeRequirement }) {
    const noProductImage = task?.noProductImage === true;
    const firstProductUrl = productUrls?.[0]?.url || '-';
    const secondProductUrl = productUrls?.[1]?.url || firstProductUrl;
    return {
        "产品名称": noProductImage ? '-' : (productName || '-'),
        "标题": title || '-',
        "副标题": subtitle || '-',
        "其他文案": otherText || '-',
        "竞品参考图链接": referenceUrl || '-',
        "任务ID": task?.id || '',
        "尺寸要求": sizeRequirement || '2K 自动识别',
        "白底参考图链接一": noProductImage ? '-' : firstProductUrl,
        "白底参考图链接二": noProductImage ? '-' : secondProductUrl
    };
}
