import { describe, it, expect } from 'vitest'
import { NebulaParticles, SETTLE } from './particles'

describe('弹性脉冲 additive uniform', () => {
  it('新增 uPulseSpace/uPulseBright，默认 0', () => {
    const p = new NebulaParticles(64)
    expect(p.uniforms.uPulseSpace.value).toBe(0)
    expect(p.uniforms.uPulseBright.value).toBe(0)
    p.dispose()
  })
})

describe('setTargets：ShapePointCloud colors 可选（Phase B1 T1）', () => {
  it('cloud 无 colors → targetColors 缓冲确定性归零（几何形状被 uTargetHasColor 门掉，但缓冲写入必须确定）', () => {
    const p = new NebulaParticles(4)
    const colArr = (Reflect.get(p, 'targetColors') as { value: { array: Float32Array } }).value.array
    colArr.fill(0.5) // 弄脏，验证会被清
    p.setTargets({ positions: new Float32Array([1, 0, 0, 0, 1, 0]) }) // 2 点、无 colors
    expect(Array.from(colArr)).toEqual(new Array(12).fill(0))
    p.dispose()
  })
  it('cloud 带 colors → 按模复制（既有封面行为不变）', () => {
    const p = new NebulaParticles(2)
    const colArr = (Reflect.get(p, 'targetColors') as { value: { array: Float32Array } }).value.array
    p.setTargets({
      positions: new Float32Array([1, 0, 0]),
      colors: new Float32Array([0.2, 0.4, 0.6]),
    })
    const expected = [0.2, 0.4, 0.6, 0.2, 0.4, 0.6]
    for (let i = 0; i < expected.length; i++) {
      expect(colArr[i]).toBeCloseTo(expected[i], 5)
    }
    p.dispose()
  })
})

describe('形状目标 uniform（Phase B1 T4）', () => {
  it('uTargetHasColor/uTargetPlanar 存在且默认 1（=封面语义，现状行为逐帧不变）', () => {
    const p = new NebulaParticles(64)
    expect(p.uniforms.uTargetHasColor.value).toBe(1)
    expect(p.uniforms.uTargetPlanar.value).toBe(1)
    p.dispose()
  })
})

describe('形状切换「碎散聚」编排 uniform（B1 亲验反馈轮③）', () => {
  it('uShatter/uGather 存在且默认 0（现状不变，非快编排路径无副作用）', () => {
    const p = new NebulaParticles(64)
    expect(p.uniforms.uShatter.value).toBe(0)
    expect(p.uniforms.uGather.value).toBe(0)
    p.dispose()
  })
})

describe('三层化信号插座（Phase C1 T3）', () => {
  it('uMid 存在且默认 0（C2 尺度分层消费；C1 仅插座、kernel 无副作用）', () => {
    const p = new NebulaParticles(64)
    expect(p.uniforms.uMid.value).toBe(0)
    p.dispose()
  })
})

describe('C2 方言 uniform（MotionProgram 名下 9 个，默认值=方言静默无副作用）', () => {
  it('幅度类默认 0，倍率/乘子类默认 1', () => {
    const p = new NebulaParticles(64)
    expect(p.uniforms.uSwellAmp.value).toBe(0)
    expect(p.uniforms.uRippleAmp.value).toBe(0)
    expect(p.uniforms.uJitterAmp.value).toBe(0)
    expect(p.uniforms.uBuildSqueeze.value).toBe(0)
    expect(p.uniforms.uFlash.value).toBe(0)
    expect(p.uniforms.uWaveSpeed.value).toBe(1)
    expect(p.uniforms.uWavefrontAmp.value).toBe(1)
    expect(p.uniforms.uNarrDim.value).toBe(1)
    expect(p.uniforms.uTwinkleAmp.value).toBe(1)
    p.dispose()
  })
})

describe('方言家族 uniform（方言期批1）', () => {
  it('方言 uniform 存在且默认值=现状等价（家族权重全 0；uPointBeat=1 点源打击照常）', () => {
    const p = new NebulaParticles(64)
    const u = p.uniforms
    expect(u.uDialContour.value).toBe(0)
    expect(u.uDialHeart.value).toBe(0)
    expect(u.uHeartPulse.value).toBe(0)
    expect(u.uPointBeat.value).toBe(1)
    expect(u.uDialCrystal.value).toBe(0)
    p.dispose()
  })
})

describe('aux 通道（方言期批1底座）', () => {
  it('cloud 无 aux → aux 缓冲确定性归零', () => {
    const p = new NebulaParticles(4)
    const auxArr = (Reflect.get(p, 'auxs') as { value: { array: Float32Array } }).value.array
    auxArr.fill(0.5) // 弄脏，验证会被清
    p.setTargets({ positions: new Float32Array([1, 0, 0, 0, 1, 0]) })
    expect(Array.from(auxArr)).toEqual(new Array(16).fill(0))
    p.dispose()
  })
  it('cloud 带 aux → 按模复制 vec4（与 positions 同一 i%n 索引对齐）', () => {
    const p = new NebulaParticles(3)
    const auxArr = (Reflect.get(p, 'auxs') as { value: { array: Float32Array } }).value.array
    p.setTargets({
      positions: new Float32Array([1, 0, 0, 0, 1, 0]), // 2 点
      aux: new Float32Array([0.1, 0.2, 0.3, 7, 0.4, 0.5, 0.6, 8]),
    })
    const expected = [0.1, 0.2, 0.3, 7, 0.4, 0.5, 0.6, 8, 0.1, 0.2, 0.3, 7] // 粒子2 取模回点0
    for (let i = 0; i < expected.length; i++) expect(auxArr[i]).toBeCloseTo(expected[i], 5)
    p.dispose()
  })
  it('setTargets(null) → aux 归零（回默认球壳无方向数据）', () => {
    const p = new NebulaParticles(2)
    const auxArr = (Reflect.get(p, 'auxs') as { value: { array: Float32Array } }).value.array
    p.setTargets({ positions: new Float32Array([1, 0, 0]), aux: new Float32Array([1, 1, 1, 1]) })
    p.setTargets(null)
    expect(Array.from(auxArr)).toEqual(new Array(8).fill(0))
    p.dispose()
  })
})

describe('主体交接乘子 uniform（线条系主体，编排层 4）', () => {
  it('uBodyDim 默认 1（不选线条卡时粒子全显，行为零回归）', () => {
    const p = new NebulaParticles(64)
    expect(p.uniforms.uBodyDim.value).toBe(1)
    p.dispose()
  })
})

describe('定格阻尼常量（形状改造②防漂移锚）', () => {
  it('到位粒子阻尼比 ζ∈[1.0,1.3]：干脆吸住略过临界，留软回弹给到站前的欠阻尼段', () => {
    const zeta = (1.2 + SETTLE.damp) / (2 * Math.sqrt(9)) // 基础阻尼1.2+定格增益，刚度9（uMorph=1 基线）
    expect(zeta).toBeGreaterThanOrEqual(1.0)
    expect(zeta).toBeLessThanOrEqual(1.3)
  })
  it('数值稳定：dt clamp 0.1 时 dt·c<2（醒态最坏 = 基础4 + gather7.8 + settle）', () => {
    expect(0.1 * (4 + 7.8 + SETTLE.damp)).toBeLessThan(2)
  })
  it('定格带正向（smoothstep 铁律 edge0<edge1）且罩不住方言大位移（far<heart 泵动幅度量级）', () => {
    expect(SETTLE.near).toBeLessThan(SETTLE.far)
    expect(SETTLE.far).toBeLessThanOrEqual(0.4)
  })
})
