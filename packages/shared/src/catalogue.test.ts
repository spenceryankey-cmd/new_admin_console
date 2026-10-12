import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  CATEGORY_LABELS,
  FEEDBACK_REASONS,
  SERVICE_CATEGORIES,
  benchmarkSchema,
  categoryByLabel,
  createRequestSchema,
  feedbackSchema,
  isCategoryLabel,
  recurringSchema,
  bandSchema,
  taskTypeBelongsTo,
  taskTypesFor,
} from './index'

const root = resolve(__dirname, '../../..')
const read = (p: string) => readFileSync(resolve(root, p), 'utf8')
const json = JSON.parse(read('catalog/categories.json')) as { categories: { label: string; tasks: string[] }[] }
const slug = (label: string) => label.toLowerCase().replace(/&/g, ' ').normalize('NFKD').replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')

describe('the catalogue', () => {
  it('is the ten categories and forty task types from the live site, nothing more', () => {
    expect(SERVICE_CATEGORIES).toHaveLength(10)
    expect(SERVICE_CATEGORIES.flatMap((c) => c.tasks)).toHaveLength(40)
    expect(SERVICE_CATEGORIES.map((c) => ({ label: c.label, tasks: c.tasks.map((t) => t.label) }))).toEqual(json.categories)
  })
  it('has no remote category and unique codes and labels', () => {
    expect(CATEGORY_LABELS.some((l) => /remote/i.test(l))).toBe(false)
    expect(new Set(SERVICE_CATEGORIES.map((c) => c.code)).size).toBe(10)
    expect(new Set(CATEGORY_LABELS).size).toBe(10)
    expect(new Set(SERVICE_CATEGORIES.flatMap((c) => c.tasks.map((t) => t.code))).size).toBe(40)
    for (const c of SERVICE_CATEGORIES) {
      expect(c.code).toBe(slug(c.label))
      for (const t of c.tasks) expect(t.code).toBe(`${c.code}.${slug(t.label)}`)
    }
  })
  it('matches both database seeds: the hetzner one and the console one', () => {
    for (const file of ['hetzner/migrations/0002_seed_catalog.sql', 'supabase/migrations/0009_catalogue.sql']) {
      const sql = read(file)
      const cats = [...sql.matchAll(/^\s+\('([a-z_]+)', '((?:[^']|'')+)', (\d+)\)/gm)].map((m) => [m[1], m[2]!.replace(/''/g, "'")])
      expect(cats, file).toEqual(SERVICE_CATEGORIES.map((c) => [c.code, c.label]))
      const tasks = [...sql.matchAll(/^\s+\('([a-z_.]+)', '([a-z_]+)', '((?:[^']|'')+)', (\d+)\)/gm)].map((m) => [m[1], m[2], m[3]!.replace(/''/g, "'")])
      expect(tasks, file).toEqual(SERVICE_CATEGORIES.flatMap((c) => c.tasks.map((t) => [t.code, c.code, t.label])))
    }
  })
  it('finds categories and task types only by their exact label and code', () => {
    expect(isCategoryLabel('Skilled Trades')).toBe(true)
    expect(isCategoryLabel('skilled trades')).toBe(false)
    expect(isCategoryLabel('Remote Support')).toBe(false)
    expect(categoryByLabel('Facility & Cleaning')?.code).toBe('facility_cleaning')
    expect(taskTypesFor('Nope')).toEqual([])
    const t = taskTypesFor('Painting & Finishing')[0]!
    expect(taskTypeBelongsTo(t.code, 'Painting & Finishing')).toBe(true)
    expect(taskTypeBelongsTo(t.code, 'Skilled Trades')).toBe(false)
  })
})

describe('category fields only accept the list', () => {
  const req = { employerName: 'Mr Adu', employerPhone: '0244000000', description: 'Tile a floor', location: 'Madina', timing: 'Monday' }
  it('requests, recurring services, benchmarks and bands', () => {
    expect(createRequestSchema.safeParse({ ...req, category: 'Skilled Trades' }).success).toBe(true)
    expect(createRequestSchema.safeParse({ ...req, category: 'Tiling' }).success).toBe(false)
    expect(recurringSchema.safeParse({ ...req, category: 'Gardening', frequency: 'weekly', nextDue: '2026-11-01' }).success).toBe(false)
    expect(recurringSchema.safeParse({ ...req, category: 'Community Services', frequency: 'weekly', nextDue: '2026-11-01' }).success).toBe(true)
    expect(benchmarkSchema.safeParse({ category: 'tiling', unit: 'per_job', amountGhs: 10, reason: 'because' }).success).toBe(false)
    expect(bandSchema.safeParse({ xpertId: 'x', category: 'Gardening', minGhs: 1, maxGhs: 2, reason: 'because' }).success).toBe(false)
  })
})

describe('structured feedback', () => {
  const base = { jobId: '11111111-1111-4111-8111-111111111111', side: 'employer' as const, rating: 5 }
  it('lists the same reasons as the database check', () => {
    const sql = read('supabase/migrations/0010_catalogue_links_feedback.sql')
    const block = sql.match(/feedback_reasons_known check \(reasons <@ array\[([^\]]+)\]/)![1]!
    expect([...block.matchAll(/'([a-z_]+)'/g)].map((m) => m[1])).toEqual([...FEEDBACK_REASONS])
  })
  it('a good rating needs no reason, a rating of 2 or lower needs one', () => {
    expect(feedbackSchema.safeParse(base).success).toBe(true)
    expect(feedbackSchema.safeParse({ ...base, rating: 2 }).success).toBe(false)
    expect(feedbackSchema.safeParse({ ...base, rating: 1, reasons: [] }).success).toBe(false)
    expect(feedbackSchema.safeParse({ ...base, rating: 2, reasons: ['poor_quality'] }).success).toBe(true)
  })
  it('accepts only known reasons, each once', () => {
    expect(feedbackSchema.safeParse({ ...base, reasons: ['made_up'] }).success).toBe(false)
    expect(feedbackSchema.safeParse({ ...base, reasons: ['quality_work', 'quality_work'] }).success).toBe(false)
    expect(feedbackSchema.parse({ ...base, reasons: ['quality_work', 'left_site_clean'] }).taskTypeCode).toBeNull()
  })
})
