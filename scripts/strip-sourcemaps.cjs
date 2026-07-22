// 打包后剥离 sourcemap（防信息泄漏）
const { execFileSync } = require('node:child_process')
const path = require('node:path')
const fs = require('node:fs')

exports.default = async function (context) {
  if (context.electronPlatformName !== 'darwin') return

  const asar = path.join(context.appOutDir, context.packager.appInfo.productFilename + '.app', 'Contents', 'Resources', 'app.asar')
  if (!fs.existsSync(asar)) return

  // 使用 asar 工具提取、删除 map、重新打包
  const tmpDir = path.join(context.appOutDir, '.asar-tmp')

  try {
    // 提取 asar
    execFileSync('npx', ['--yes', '@electron/asar', 'extract', asar, tmpDir], { stdio: 'inherit' })

    // 递归删除所有 .map 文件
    function removeMapFiles(dir) {
      const files = fs.readdirSync(dir)
      for (const file of files) {
        const fullPath = path.join(dir, file)
        const stat = fs.statSync(fullPath)
        if (stat.isDirectory()) {
          removeMapFiles(fullPath)
        } else if (file.endsWith('.map')) {
          fs.unlinkSync(fullPath)
        }
      }
    }
    removeMapFiles(tmpDir)

    // 重新打包 asar
    execFileSync('npx', ['--yes', '@electron/asar', 'pack', tmpDir, asar], { stdio: 'inherit' })

    // 删除临时目录
    fs.rmSync(tmpDir, { recursive: true, force: true })
  } catch (e) {
    console.error('Failed to strip sourcemaps:', e.message)
    throw e
  }
}
