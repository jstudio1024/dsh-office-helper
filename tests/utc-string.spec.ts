import { describe, expect, it } from 'vitest'
import { formatLocal } from '../src/utc-string.ts'

it('formats a fixed instant as local time', () => {
  const d = new Date('2026-08-15T03:04:05Z')
  const p = (n: number) => String(n).padStart(2, '0')
  const expected = d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate())
    + ' ' + p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds())
  expect(formatLocal(d)).toBe(expected)
})

it('pads single-digit month/day/hour/minute/second', () => {
  const d = new Date(2026, 0, 5, 7, 8, 9)
  expect(formatLocal(d)).toBe('2026-01-05 07:08:09')
})

it('uses system local time (not UTC)', () => {
  const d = new Date('2026-08-15T11:00:00+08:00')
  const p = (n: number) => String(n).padStart(2, '0')
  const expected = d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate())
    + ' ' + p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds())
  expect(formatLocal(d)).toBe(expected)
})
