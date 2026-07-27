import { describe, expect, it } from 'vitest'
import { experienceSqlDirectAlignsWithQuestion } from './experience_sql_direct_guard'

describe('experienceSqlDirectAlignsWithQuestion', () => {
  it('allows near-identical questions', () => {
    expect(
      experienceSqlDirectAlignsWithQuestion(
        '查询张三2025年1月的足底压力统计',
        '查张三2025年1月足底压力统计'
      )
    ).toBe(true)
  })

  it('rejects similar topic but different time range', () => {
    expect(
      experienceSqlDirectAlignsWithQuestion(
        '查询张三2024年足底压力统计',
        '查询张三2025年足底压力统计'
      )
    ).toBe(false)
  })

  it('rejects low lexical overlap despite same domain words', () => {
    expect(
      experienceSqlDirectAlignsWithQuestion(
        '月度销售汇总按区域',
        '查询用户李四最近三次体检记录'
      )
    ).toBe(false)
  })
})
