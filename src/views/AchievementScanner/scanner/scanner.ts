import { cvTranslateError, getCV, ICVMat, toIMat, fromIMat } from '@/utils/cv'
import type { Mat, Rect } from '@/utils/opencv'
import { cvDiffImage, cvGetRect, cvSplitAchievement, cvSplitImage } from '../cvUtils'
import { recognize, init as getOCR } from '@/modules/ocr'
import { Achievement } from '@/typings/Achievements'
import { achievementTitles, achievementEC } from './achievementsList'
import { textBestmatch } from '@/utils/textMatch'

export let lastImage: Mat | null = null
export let rect: Rect | null = null

export function getRect() {
    return rect
}

export function reset() {
    if (lastImage) {
        try {
            lastImage.delete()
        } catch (e) {}
    }
    lastImage = null
    rect = null
}

export interface IAScannerBase {
    result?: {
        title: Awaited<ReturnType<typeof recognize>>
        subtitle: Awaited<ReturnType<typeof recognize>>
        status: Awaited<ReturnType<typeof recognize>>
        date: Awaited<ReturnType<typeof recognize>>
    }
    images?: Record<string, string>
}
export interface IAScannerFaild extends IAScannerBase {
    success: false
}
export interface IAScannerData extends IAScannerBase {
    success: true
    achievement: Achievement
    status: string
    date: string
}

export interface IAScannerLine {
    image: ICVMat
    blocks: {
        name: string
        rect: Rect
        image: ICVMat
    }[]
}

export async function scannerOnImage(data: ICVMat, keepLastRow = false) {
    const cv = await getCV()
    try {
        /* cut rect */
        const raw = fromIMat(cv, data)
        if (!rect) {
            rect = await cvGetRect(raw)
        }
        if (!rect) {
            rect = new cv.Rect(0, 0, raw.cols, raw.rows)
        }
        let src = raw.roi(rect)
        raw.delete()
        /* get rows & remove last row */
        if (!keepLastRow) {
            const rows = await cvSplitImage(src)
            let k = rows.length - 1
            while (src.rows - rows[k] < 10) {
                k--
            }
            const tmp = src.roi(new cv.Rect(0, 0, src.cols, Math.min(rows[k] + 10, src.rows)))
            src.delete()
            src = tmp
        }
        let img = src.clone()
        /* diff */
        if (lastImage) {
            const diff = await cvDiffImage(lastImage, img)
            if (!diff) {
                // 滚动太小，不处理
                src.delete()
                img.delete()
                return []
            }
            img.delete()
            img = diff
            lastImage.delete()
        }
        /* get new rows */
        const rows = await cvSplitImage(img)
        const results: IAScannerLine[] = []
        rows.forEach((i, index) => {
            const y = index === 0 ? 0 : rows[index - 1]
            const h = index === 0 ? i : i - rows[index - 1]
            const rect = new cv.Rect(0, y, img.cols, h)
            const tmp = img.roi(rect)
            const tmpData = toIMat(cv, tmp)
            results.push({
                image: tmpData,
                blocks: cvSplitAchievement(cv, tmp).map((e) => {
                    const tmpData = toIMat(cv, e.roi)
                    e.roi.delete()
                    return {
                        name: e.name,
                        rect: e.rect,
                        image: tmpData,
                    }
                }),
            })
            try {
                tmp.delete()
            } catch (e) {}
        })
        img.delete()
        lastImage = src
        return results
    } catch (e) {
        throw cvTranslateError(cv, e)
    }
}

export async function recognizeAchievement(line: IAScannerLine): Promise<IAScannerData | IAScannerFaild> {
    let res: Achievement | null = null
    const title = line.blocks.find((e) => e.name === 'title')
    const subtitle = line.blocks.find((e) => e.name === 'subtitle')
    const result = {
        title: {},
        subtitle: {},
        status: {},
        date: {},
    } as Exclude<IAScannerData['result'], undefined>
    if (title && subtitle) {
        const titleText = await recognize(title.image)
        result.title = titleText
        const titleObj = !isNaN(titleText.confidence) ? achievementTitles.find((e) => e.str === titleText.text) : false
        if (
            titleObj &&
            titleText.confidence > 85 &&
            !/.*[0-9]{1,}.*/.test(titleObj.obj.desc) &&
            !titleObj.obj.desc.includes('次')
        ) {
            res = titleObj.obj
        } else {
            const subtitleText = await recognize(subtitle.image)
            result.subtitle = subtitleText
            const ecStr = `${titleText.text}-${subtitleText.text}`
            const matched = textBestmatch('str', ecStr, achievementEC, ecStr.length / 3)
            if (matched) {
                res = matched.obj
            }
        }
    }
    if (res) {
        const status = line.blocks.find((e) => e.name === 'status')
        const date = line.blocks.find((e) => e.name === 'date')
        if (status) {
            result.status = await recognize(status.image)
        }
        if (date) {
            result.date = await recognize(date.image)
        }
        return {
            success: true,
            achievement: res,
            status: result.status?.text ?? '',
            date: result.date?.text ?? '',
            result,
        }
    } else {
        return { success: false, result }
    }
}

export async function init() {
    await getOCR()
    await getCV()
}