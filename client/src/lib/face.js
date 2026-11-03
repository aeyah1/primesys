// Face checks for staff (server/utils/faceCheck.js). face-api (open source, MIT) finds the face in the camera picture
// and turns it into 128 measurements, all in this browser; only those numbers are sent, never a picture. Its models are
// served by PRimeSys itself (public/models/face, about 7 MB) and cached by the browser after the first check.

const MODELS = `${import.meta.env.BASE_URL}models/face`

let loading = null
export const loadFace = () => (loading ??= import('@vladmandic/face-api').then(async (faceapi) => {
  await faceapi.tf.ready()
  await Promise.all([faceapi.nets.tinyFaceDetector, faceapi.nets.faceLandmark68Net, faceapi.nets.faceRecognitionNet].map(n => n.loadFromUri(MODELS)))
  return faceapi
}).catch(err => { loading = null; throw Object.assign(err, { reason: 'load' }) }))

// The front camera; a failure carries its `reason`: 'denied', 'none' or 'busy'.
export async function openCamera() {
  if (!navigator.mediaDevices?.getUserMedia) throw Object.assign(new Error('No camera'), { reason: 'none' })
  try {
    return await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } }, audio: false })
  } catch (err) {
    const reason = ['NotAllowedError', 'SecurityError'].includes(err.name) ? 'denied' : ['NotFoundError', 'OverconstrainedError'].includes(err.name) ? 'none' : 'busy'
    throw Object.assign(err, { reason })
  }
}

// Where the nose tip sits along the line between the outer eye corners: about 0.5 facing the camera, further to one side
// as the head turns. A photo turned or tilted in front of the camera keeps it, since the face on it is flat (docs/face-check.md).
const turnOf = (p) => {
  const [l, r, n] = [p[36], p[45], p[30]]
  const dx = r.x - l.x, dy = r.y - l.y
  return ((n.x - l.x) * dx + (n.y - l.y) * dy) / (dx * dx + dy * dy)
}
const FACING = 0.15      // this near 0.5 is facing the camera
const TURNED = 0.15      // this far from where it started is a turned head
const BACK = 0.07        // and this near again is facing the camera once more
const LIMIT_S = 60

// Watches the camera until the person turns their head a little and back, so a printed photo or a picture on a screen
// doesn't pass, then reads the face `count` times while it faces the camera; onStatus(text) says what to do meanwhile.
// Resolves the readings, or null once `signal` aborts.
export async function captureFace(video, { count = 3, onStatus, signal }) {
  const faceapi = await loadFace()
  const options = new faceapi.TinyFaceDetectorOptions({ inputSize: 320, scoreThreshold: 0.5 })
  const until = Date.now() + LIMIT_S * 1000
  let start = null, turned = false, live = false
  const samples = []
  while (!signal.aborted) {
    if (Date.now() > until) throw Object.assign(new Error('No head turn seen'), { reason: 'timeout' })
    await new Promise(r => requestAnimationFrame(r))
    const task = faceapi.detectAllFaces(video, options).withFaceLandmarks()
    const faces = await (live ? task.withFaceDescriptors() : task)
    if (signal.aborted) break
    if (faces.length !== 1) { onStatus(faces.length ? 'Only you should be in view' : 'Look straight at the camera'); continue }
    const { detection, landmarks, descriptor } = faces[0]
    if (detection.box.width < video.videoWidth * 0.25) { onStatus('Come a little closer'); continue }
    const turn = turnOf(landmarks.positions)
    if (start === null) {
      if (Math.abs(turn - 0.5) > FACING) { onStatus('Look straight at the camera'); continue }
      start = turn
    }
    if (!live) {
      if (!turned) turned = Math.abs(turn - start) > TURNED
      else live = Math.abs(turn - start) < BACK
      onStatus(live ? 'Hold still' : turned ? 'Now face the camera again' : 'Turn your head a little to one side')
      continue
    }
    if (Math.abs(turn - start) >= BACK) { onStatus('Face the camera and hold still'); continue }
    samples.push(Array.from(descriptor, v => Math.round(v * 1e5) / 1e5))
    if (samples.length >= count) return samples
  }
  return null
}
