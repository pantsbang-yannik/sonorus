// 无证书过渡期（发布准备①设计稿拍板）：electron-builder 无签名身份时会整体跳过签名，
// 导致 asar/extraResources 注入后包签名失效——此钩子在打包后整包 ad-hoc 重签兜底。
// 证书到位后换正式身份签名+公证，本钩子随之移除。
const { execFileSync } = require('node:child_process')
const path = require('node:path')

exports.default = async function (context) {
  if (context.electronPlatformName !== 'darwin') return
  const app = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`)
  execFileSync('codesign', ['--force', '--deep', '--sign', '-', app], { stdio: 'inherit' })
}
