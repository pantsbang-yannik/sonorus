#!/bin/bash
set -e
cd "$(dirname "$0")"
# Embed Info.plist (NSAudioCaptureUsageDescription) so macOS can attribute the
# system-audio-recording TCC prompt to this binary.
swiftc main.swift -o audelyra-tap \
  -framework CoreAudio -framework AudioToolbox -O \
  -Xlinker -sectcreate -Xlinker __TEXT -Xlinker __info_plist -Xlinker Info.plist

# Re-sign ad-hoc so the embedded plist is covered by the signature.
codesign --force --sign - audelyra-tap
echo "built: $(pwd)/audelyra-tap"
