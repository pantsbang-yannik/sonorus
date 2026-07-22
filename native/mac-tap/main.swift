// sonorus-tap: macOS system-audio capture sidecar (Core Audio Process Tap, macOS 14.2+)
// Protocol: stderr line 1 = {"sampleRate":<num>,"channels":<num>}, then stdout = interleaved Float32 LE PCM.
// Exits on SIGTERM/SIGINT.

import Foundation
import CoreAudio
import AudioToolbox

func fail(_ msg: String, _ status: OSStatus) -> Never {
  FileHandle.standardError.write("{\"error\":\"\(msg)\",\"status\":\(status)}\n".data(using: .utf8)!)
  exit(1)
}

// 1) Global system-mix tap (exclude no processes; we emit no audio, so no feedback loop)
let tapDesc = CATapDescription(stereoGlobalTapButExcludeProcesses: [])
tapDesc.uuid = UUID()
tapDesc.muteBehavior = .unmuted
tapDesc.isPrivate = true
tapDesc.name = "SonorusTap"

var tapID = AudioObjectID(kAudioObjectUnknown)
var status = AudioHardwareCreateProcessTap(tapDesc, &tapID)
if status != noErr { fail("create_tap", status) }

// 2) Read default output device UID (AudioCap uses it as the aggregate's main sub-device)
func readDefaultOutputUID() -> String {
  var devAddr = AudioObjectPropertyAddress(
    mSelector: kAudioHardwarePropertyDefaultSystemOutputDevice,
    mScope: kAudioObjectPropertyScopeGlobal,
    mElement: kAudioObjectPropertyElementMain)
  var devID = AudioObjectID(kAudioObjectUnknown)
  var devSize = UInt32(MemoryLayout<AudioObjectID>.size)
  var st = AudioObjectGetPropertyData(AudioObjectID(kAudioObjectSystemObject), &devAddr, 0, nil, &devSize, &devID)
  if st != noErr { fail("default_output_device", st) }
  var uidAddr = AudioObjectPropertyAddress(
    mSelector: kAudioDevicePropertyDeviceUID,
    mScope: kAudioObjectPropertyScopeGlobal,
    mElement: kAudioObjectPropertyElementMain)
  var uid: CFString = "" as CFString
  var uidSize = UInt32(MemoryLayout<CFString>.size)
  st = withUnsafeMutablePointer(to: &uid) { ptr in
    AudioObjectGetPropertyData(devID, &uidAddr, 0, nil, &uidSize, ptr)
  }
  if st != noErr { fail("output_device_uid", st) }
  return uid as String
}
let outputUID = readDefaultOutputUID()

// 3) Private aggregate device containing the default output as sub-device + the tap
let aggDict: [String: Any] = [
  kAudioAggregateDeviceNameKey: "SonorusTap",
  kAudioAggregateDeviceUIDKey: UUID().uuidString,
  kAudioAggregateDeviceMainSubDeviceKey: outputUID,
  kAudioAggregateDeviceIsPrivateKey: true,
  kAudioAggregateDeviceIsStackedKey: false,
  kAudioAggregateDeviceTapAutoStartKey: true,
  kAudioAggregateDeviceSubDeviceListKey: [
    [kAudioSubDeviceUIDKey: outputUID]
  ],
  kAudioAggregateDeviceTapListKey: [
    [
      kAudioSubTapDriftCompensationKey: true,
      kAudioSubTapUIDKey: tapDesc.uuid.uuidString,
    ]
  ],
]
var aggID = AudioObjectID(kAudioObjectUnknown)
status = AudioHardwareCreateAggregateDevice(aggDict as CFDictionary, &aggID)
if status != noErr { fail("create_aggregate", status) }

// 3) Read tap output format, emit stderr header
var addr = AudioObjectPropertyAddress(
  mSelector: kAudioTapPropertyFormat,
  mScope: kAudioObjectPropertyScopeGlobal,
  mElement: kAudioObjectPropertyElementMain)
var asbd = AudioStreamBasicDescription()
var size = UInt32(MemoryLayout<AudioStreamBasicDescription>.size)
status = AudioObjectGetPropertyData(tapID, &addr, 0, nil, &size, &asbd)
if status != noErr { fail("tap_format", status) }
FileHandle.standardError.write(
  "{\"sampleRate\":\(Int(asbd.mSampleRate)),\"channels\":\(asbd.mChannelsPerFrame)}\n".data(using: .utf8)!)

// 4) IO callback: copy buffers on the audio thread, write to stdout on a separate queue
let writeQueue = DispatchQueue(label: "sonorus.tap.write")
var ioProcID: AudioDeviceIOProcID?
status = AudioDeviceCreateIOProcIDWithBlock(&ioProcID, aggID, nil) { _, inData, _, _, _ in
  let abl = UnsafeMutableAudioBufferListPointer(UnsafeMutablePointer(mutating: inData))
  for buf in abl {
    guard let ptr = buf.mData, buf.mDataByteSize > 0 else { continue }
    let data = Data(bytes: ptr, count: Int(buf.mDataByteSize))
    writeQueue.async { FileHandle.standardOutput.write(data) }
  }
}
if status != noErr { fail("ioproc", status) }
status = AudioDeviceStart(aggID, ioProcID)
if status != noErr { fail("start", status) }

signal(SIGTERM) { _ in exit(0) }
signal(SIGINT) { _ in exit(0) }
RunLoop.main.run()
