/**
 * 构建 client 半产物：把 src/client/index.tsx 打包成浏览器可用的
 * lib/client.js —— window.__ModuleLoader__.load({ id, factory }) 包裹的
 * 单文件 CJS 闭包（与官方 DSH client-bundle 预设一致）。
 *
 * - react / react/jsx-runtime 由运行时模块表提供，保持 external；
 * - 其余代码（含 utc-string 纯函数）全部内联进产物。
 */
import { build } from 'esbuild'
import { fileURLToPath } from 'node:url'

const PLUGIN_ID = 'dsh-office-helper'

await build({
  entryPoints: [fileURLToPath(new URL('../src/client/index.tsx', import.meta.url))],
  outfile: fileURLToPath(new URL('../lib/client.js', import.meta.url)),
  bundle: true,
  format: 'cjs',
  platform: 'browser',
  target: 'es2020',
  jsx: 'automatic',
  external: ['react', 'react/jsx-runtime'],
  banner: { js: `var module = { exports: {} }; var exports = module.exports; window.__ModuleLoader__.load({ id: ${JSON.stringify(PLUGIN_ID)}, factory: (require) => {` },
  footer: { js: 'return module.exports; } });' },
})

console.log('[build-client] lib/client.js written')
