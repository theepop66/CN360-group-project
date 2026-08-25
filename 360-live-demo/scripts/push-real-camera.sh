#!/usr/bin/env bash
# ------------------------------------------------------------------
# Example: feed a real 360 camera into the mock server's live source.
#
# This grabs one frame every second from a camera source (RTSP, RTMP,
# a local USB webcam, or an HTTP MJPEG endpoint -- anything ffmpeg can
# read) and POSTs it to /api/camera/push. As soon as the server
# receives a real frame, it stops overwriting the source with the
# simulator and starts serving your camera's frames through the same
# /api/frame/full.png, /hemisphere.png, /viewport.png endpoints.
#
# IMPORTANT: the frame must be an equirectangular (2:1) image. Most
# 360 cameras (Insta360, Ricoh Theta, Kandao, etc.) can output this
# directly via their stitching software/SDK, or via their RTMP live
# stream in "equirectangular" mode.
#
# Usage:
#   ./push-real-camera.sh rtsp://192.168.1.50:554/live http://localhost:3000
#   ./push-real-camera.sh /dev/video0 http://localhost:3000        # local USB cam (for testing, not equirect)
# ------------------------------------------------------------------

set -euo pipefail

SOURCE="${1:?usage: push-real-camera.sh <ffmpeg input url> [server url]}"
SERVER="${2:-http://localhost:3000}"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

echo "Pulling frames from: $SOURCE"
echo "Pushing to:          $SERVER/api/camera/push"
echo "Press Ctrl+C to stop."
echo

while true; do
  FRAME="$TMP/frame.jpg"
  # Grab a single current frame from the live source.
  ffmpeg -y -loglevel error -i "$SOURCE" -frames:v 1 -q:v 2 "$FRAME" || {
    echo "frame grab failed, retrying..."; sleep 2; continue;
  }
  curl -s -o /dev/null -w "pushed frame -> %{http_code}\n" \
    -F "frame=@${FRAME};type=image/jpeg" \
    "$SERVER/api/camera/push"
  sleep 1
done
