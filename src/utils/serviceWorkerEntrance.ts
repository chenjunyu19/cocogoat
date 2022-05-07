import { template } from '@/assets/mihoyoImages/characterIcon'
import characterAmos from '@/plugins/amos/characters'
import { ServiceWorker } from '@/utils/serviceWorker'
export const sw = new ServiceWorker(
    new URL(/* webpackChunkName: "sw" */ /* webpackEntryOptions: { filename: "sw.js" } */ '@/sw.ts', import.meta.url),
    {
        fallback: '/sw.js',
        manifest: window.$cocogoat.manifest || '',
        additionalCachedUrls: [...characterAmos.map((c) => template.replace('#', c.key))],
    },
)
if (location.href.includes('let-me-in')) {
    sw.uninstall()
} else if (process.env.NODE_ENV === 'production' || location.href.includes('force-sw')) {
    sw.install()
}
window.$cocogoat.sw = sw