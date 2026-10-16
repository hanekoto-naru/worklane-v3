import { test, expect, modal, nav, confirm, createTask, saved, selectEmpty, storage } from './fixtures.mjs'

test('A 模擬API: 初回作成・保存・再読込・バックアップ復元・破損拒否', async ({ page, disk }) => {
  await page.goto('/')
  await selectEmpty(page)
  expect(JSON.parse(disk.files.get('dummy-a/data.json')).tasks).toEqual([])
  await createTask(page, '保存検証')
  await saved(page)
  const original = disk.files.get('dummy-a/data.json')
  await page.getByRole('button', { name: '保存検証', exact: true }).click()
  await modal(page).getByLabel('タイトル（必須）').fill('保存検証・変更')
  await modal(page).getByRole('button', { name: '変更を反映', exact: true }).click()
  await saved(page)
  await page.reload()
  await page.getByRole('button', { name: '保存先フォルダを選択', exact: true }).click()
  await saved(page)
  await expect(page.getByRole('button', { name: '保存検証・変更', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'バックアップ', exact: true }).click()
  const backup = [...disk.files].find(([path, text]) => path.startsWith('dummy-a/backups/') && text === original)[0].split('/').at(-1)
  const backupPath = 'dummy-a/backups/' + backup
  const backupText = disk.files.get(backupPath)
  const currentText = disk.files.get('dummy-a/data.json')
  disk.files.set(backupPath, '{broken')
  await confirm(page, () => page.locator('span').filter({ hasText: backup }).locator('..').getByRole('button', { name: '復元', exact: true }).click(), /復元/)
  await expect(storage(page).getByRole('alert')).toContainText('JSONを読み込めません')
  expect(disk.files.get('dummy-a/data.json')).toBe(currentText)
  await expect(page.getByRole('button', { name: '保存検証・変更', exact: true })).toBeVisible()
  disk.files.set(backupPath, backupText)
  await confirm(page, () => page.locator('span').filter({ hasText: backup }).locator('..').getByRole('button', { name: '復元', exact: true }).click(), /復元/)
  await saved(page)
  expect(JSON.parse(disk.files.get('dummy-a/data.json')).tasks[0].title).toBe('保存検証')
  await expect(page.getByRole('button', { name: '保存検証', exact: true })).toBeVisible()
  disk.files.set('dummy-b/data.json', '{broken')
  disk.next = 'dummy-b'
  await page.getByRole('button', { name: '保存先を再選択', exact: true }).click()
  await expect(storage(page).getByRole('alert')).toContainText('JSONを読み込めません')
  expect(disk.files.get('dummy-b/data.json')).toBe('{broken')
  await expect(page.getByRole('button', { name: '保存検証', exact: true })).toBeVisible()
})

test('A 模擬API: 容量不足・権限失効で編集を保持し、再試行で保存', async ({ page, disk }) => {
  await page.goto('/')
  await selectEmpty(page)
  for (const fault of ['write', 'permission']) {
    const previous = disk.files.get('dummy-a/data.json')
    if (fault === 'write') disk.failWrite = true
    else disk.permission = 'denied'
    await createTask(page, '未保存-' + fault)
    await expect(storage(page).getByRole('status')).toHaveText('保存失敗')
    expect(disk.files.get('dummy-a/data.json')).toBe(previous)
    await expect(page.getByRole('button', { name: '未保存-' + fault, exact: true })).toBeVisible()
    const warning = page.waitForEvent('dialog')
    await page.evaluate(() => { setTimeout(() => window.location.reload(), 0) })
    const leave = await warning
    expect(leave.type()).toBe('beforeunload')
    await leave.dismiss()
    await expect(page.getByRole('button', { name: '未保存-' + fault, exact: true })).toBeVisible()
    disk.failWrite = false; disk.permission = 'granted'
    if (fault === 'permission') await page.getByRole('button', { name: '保存先を再選択', exact: true }).click()
    await page.getByRole('button', { name: '再試行', exact: true }).click()
    await saved(page)
    expect(JSON.parse(disk.files.get('dummy-a/data.json')).tasks.some(task => task.title === '未保存-' + fault)).toBe(true)
  }
})

test('A 模擬API: 実2タブ・Web Locksで競合停止し、未保存データを別フォルダへ退避', async ({ page, context, guard, disk }) => {
  await page.goto('/')
  await selectEmpty(page)
  guard.allowPage()
  const second = await context.newPage()
  await second.goto('/')
  await second.getByRole('button', { name: '保存先フォルダを選択', exact: true }).click()
  await saved(second)
  await createTask(page, '先行保存')
  await saved(page)
  const first = disk.files.get('dummy-a/data.json')
  await createTask(second, '競合側の編集')
  await expect(storage(second).getByRole('status')).toContainText('保存失敗')
  await expect(storage(second).getByRole('alert')).toContainText('変更を検知')
  expect(disk.files.get('dummy-a/data.json')).toBe(first)
  disk.next = 'dummy-b'
  await confirm(second, () => second.getByRole('button', { name: '画面のデータを別フォルダへ保存', exact: true }).click(), /現在の画面/)
  await saved(second)
  expect(JSON.parse(disk.files.get('dummy-b/data.json')).tasks[0].title).toBe('競合側の編集')
  expect(disk.files.get('dummy-a/data.json')).toBe(first)
  await nav(second, 'ダッシュボード')
  await expect(second.getByRole('button', { name: /自分の未完了タスク/ })).toContainText('1')
})


test('A 模擬API: 非表示の既存ラベルは編集・保存・再読込で保持する', async ({ page, disk }) => {
  disk.files.set('dummy-a/data.json', JSON.stringify({
    schemaVersion: 3, revision: 1, tasks: [], projects: [], questions: [],
    people: [{ id: 'legacy-person', name: '互換性検証担当者', labels: ['先輩', '後輩'] }],
  }))
  await page.goto('/')
  await page.getByRole('button', { name: '保存先フォルダを選択', exact: true }).click()
  await saved(page)
  await nav(page, '設定')
  const row = page.getByRole('row').filter({ hasText: '互換性検証担当者' })
  await expect(row).not.toContainText('先輩')
  await expect(row).not.toContainText('後輩')
  await page.getByRole('button', { name: '互換性検証担当者を編集', exact: true }).click()
  for (const label of ['先輩', '後輩']) await expect(page.getByRole('button', { name: label, exact: true })).toHaveCount(0)
  await modal(page).getByLabel('名前（必須）').fill('互換性検証担当者・変更')
  await modal(page).getByRole('button', { name: '営業', exact: true }).click()
  await modal(page).getByRole('button', { name: '変更を反映', exact: true }).click()
  await saved(page)
  expect(JSON.parse(disk.files.get('dummy-a/data.json')).people[0].labels).toEqual(['先輩', '後輩', '営業'])
  await page.reload()
  await page.getByRole('button', { name: '保存先フォルダを選択', exact: true }).click()
  await saved(page)
  await expect(page.getByRole('row').filter({ hasText: '互換性検証担当者・変更' })).toContainText('営業')
})
