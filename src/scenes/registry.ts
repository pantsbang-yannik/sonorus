import type { Scene } from './types'

const factories = new Map<string, () => Scene>()

export function registerScene(name: string, factory: () => Scene): void {
  factories.set(name, factory)
}

export function createScene(name: string): Scene {
  const f = factories.get(name)
  if (!f) throw new Error(`scene not registered: ${name}`)
  return f()
}

export function sceneNames(): string[] {
  return [...factories.keys()]
}
