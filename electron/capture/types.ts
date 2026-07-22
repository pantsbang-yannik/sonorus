export interface CaptureHeader {
  sampleRate: number
  channels: number
}

export type CaptureStatus = 'running' | 'unavailable'
