import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, basename } from 'node:path'
import { test, expect, createTask, modal, saved, confirm, storage } from './fixtures.mjs'

// Uses the real picker and handles; only a folder-name guard is wrapped around the picker.
// No mock filesystem or CDP permission grants in this suite.
// Only the user operates the OS picker and authorizes creation in our empty temp folder.
test('B 実ファイルAPI: ユーザー選択後の作成・保存・再読込・バックアップ復元', async ({ page }) => {
  const folder = await mkdtemp(join(tmpdir(), 'worklane-chrome-dummy-'))
  try {
    console.log(`実ファイル試験専用フォルダ: ${folder}`)
    console.log('このフォルダだけを選択してください。Chromeの保存先ボタンからOSダイアログを開き、Cmd+Shift+Gで上記パスを指定し、空データ作成を確認します。')
    await page.addInitScript(expectedName => {
      const nativePicker = window.showDirectoryPicker.bind(window)
      window.showDirectoryPicker = async options => {
        const handle = await nativePicker(options)
        if (handle.name !== expectedName) throw new DOMException('Select the test-only folder', 'AbortError')
        return handle
      }
    }, basename(folder))
    await page.goto('/')
    // Leave native confirmation to the human; do not auto-accept an unknown folder.
    const leaveToUser = () => {}
    page.on('dialog', leaveToUser)
    await expect.poll(async () => {
      try { return JSON.parse(await readFile(join(folder, 'data.json'), 'utf8')).tasks.length } catch { return -1 }
    }, { timeout: 120000 }).toBe(0)
    await expect(storage(page)).toContainText(`保存先：${basename(folder)}`)
    page.off('dialog', leaveToUser)
    await saved(page)
    await createTask(page, '実ファイル検証')
    await saved(page)
    const original = JSON.parse(await readFile(join(folder, 'data.json'), 'utf8'))
    expect(original.tasks[0].title).toBe('実ファイル検証')
    await page.getByRole('button', { name: '実ファイル検証', exact: true }).click()
    await modal(page).getByLabel('タイトル（必須）').fill('実ファイル検証・変更')
    await modal(page).getByRole('button', { name: '変更を反映', exact: true }).click()
    await saved(page)
    const names = await readdir(join(folder, 'backups'))
    let backup
    for (const name of names) {
      const data = JSON.parse(await readFile(join(folder, 'backups', name), 'utf8'))
      if (data.tasks[0]?.title === '実ファイル検証') backup = name
    }
    expect(backup).toBeTruthy()
    await page.getByRole('button', { name: 'バックアップ', exact: true }).click()
    const row = page.locator('span').filter({ hasText: backup }).locator('..')
    await confirm(page, () => row.getByRole('button', { name: '復元', exact: true }).click(), /復元/)
    await saved(page)
    expect(JSON.parse(await readFile(join(folder, 'data.json'), 'utf8')).tasks).toEqual(original.tasks)
    await page.reload()
    console.log(`再読み込み後、同じフォルダをもう一度選択してください: ${folder}`)
    await expect(storage(page).getByRole('status')).toHaveText('保存済み', { timeout: 120000 })
    await expect(storage(page)).toContainText(`保存先：${basename(folder)}`)
    await expect(page.getByRole('button', { name: '実ファイル検証', exact: true })).toBeVisible()
  } finally {
    // Only remove the uniquely created dummy folder, never a user-supplied path.
    await rm(folder, { recursive: true, force: true })
  }
})
