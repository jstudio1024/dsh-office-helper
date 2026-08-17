/** dsh-office-helper host half: 无 Node 侧逻辑，功能全部在 client 半（浏览器侧 UI）。 */
export const name = 'dsh-office-helper'

/** 空 apply：cordis 需要 host 半入口，本插件不注册任何 Node 侧行为。 */
export function apply(): void {
  // no-op
}
