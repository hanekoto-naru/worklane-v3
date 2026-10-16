// Test fixtures only; never imported by the application.
import { z } from 'zod'
import { projectSchema, taskSchema, noteSchema } from '../src/data.ts'

export const initialPeople = [
  { id: 'person1', name: '佐藤（架空）' }, { id: 'person2', name: '田中（架空）' },
  { id: 'person3', name: '鈴木（架空）' }, { id: 'person4', name: '高橋（架空）' },
]
export const projects = z.array(projectSchema).parse([
  { id: 'p1', name: 'サービス改善', description: '利用者ヒアリングと改善施策の管理。', due: '2026-10-30' },
  { id: 'p2', name: '業務フロー整備', description: '業務手順と運用マニュアルの整備。', due: '2026-11-06' },
  { id: 'p3', name: '次期リリース', description: '新機能の検証とリリース準備。', due: '2026-11-20' },
])
export const initialTasks = z.array(taskSchema).parse([
  { id: 'WL-101', title: '改善提案のたたき台をまとめる', detail: '利用者ヒアリングの結果から、優先して取り組む改善点を3つに整理する。', kind: 'mine', status: '進行中', priority: '高', due: '2026-10-15', project: 'p1', owner: '自分' },
  { id: 'WL-102', title: '運用マニュアルの構成を見直す', detail: '問い合わせが多い手順を先頭に配置し、目次を更新する。', kind: 'mine', status: '未着手', priority: '中', due: '2026-10-16', project: 'p2', owner: '自分' },
  { id: 'WL-103', title: 'リリース前の確認項目を整理する', detail: '動作確認と関係者への連絡事項を一覧にする。', kind: 'mine', status: '進行中', priority: '高', due: '2026-10-19', project: 'p3', owner: '自分' },
  { id: 'WL-104', title: '定例ミーティングの議事録を共有する', detail: '決定事項と次のアクションを整理する。', kind: 'mine', status: '完了', priority: '低', due: '2026-10-14', project: 'p2', owner: '自分' },
  { id: 'WL-105', title: '画面遷移のレビューを行う', detail: '主要な操作が迷わず完了できるかを確認する。', kind: 'mine', status: '未着手', priority: '中', due: '2026-10-21', project: 'p1', owner: '自分' },
  { id: 'WL-201', title: '問い合わせ内容を分類する', detail: '直近のサンプルを分類し、頻出する質問を整理する。', kind: 'delegated', status: 'レビュー待ち', priority: '高', due: '2026-10-15', project: 'p1', owner: 'person1', nextCheck: '2026-10-15' },
  { id: 'WL-202', title: 'チェックリストの初稿を作成する', detail: '現行の手順をもとに、抜け漏れを確認できるリストを作る。', kind: 'delegated', status: '対応中', priority: '中', due: '2026-10-19', project: 'p2', owner: 'person2', nextCheck: '2026-10-16' },
  { id: 'WL-203', title: '検証結果をレポートにまとめる', detail: '確認済みの項目と残っている課題を分けて記載する。', kind: 'delegated', status: '依頼済み', priority: '中', due: '2026-10-22', project: 'p3', owner: 'person1', nextCheck: '2026-10-19' },
])
export const initialNotes = z.array(noteSchema).parse([
  { id: 'n1', title: '改善施策の優先順位を相談する', detail: '使いやすさの改善と新機能の追加、今期はどちらを優先するか。', person: 'person3', project: 'p1', checked: false },
  { id: 'n2', title: '運用フローの承認範囲を確認する', detail: 'チーム内で判断できる変更と、事前承認が必要な変更を明確にする。', person: 'person4', project: 'p2', checked: false },
  { id: 'n3', title: 'リリース日程の前提を確認する', detail: '関係部署の確認期間を含めたスケジュールを確認済み。', person: 'person3', project: 'p3', checked: true },
])

export const initialState = { tasks: initialTasks, notes: initialNotes, projects, people: initialPeople }
